<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  listTrash, restoreTrash, removeTrash, clearTrash, daysLeft, trashTableLabel, TrashConflictError, TRASH_KEEP_DAYS,
  type TrashItem,
} from "@/composables/useTrash";

/** 資料垃圾桶（ADR-028）：刪除的資料保留 30 天，可還原到所有電腦 */
const emit = defineEmits<{ toast: [type: "success" | "error", msg: string]; changed: [] }>();

const items = ref<TrashItem[]>([]);
const cloudError = ref("");
const loading = ref(false);
const busy = ref("");
const filterTable = ref("");
const search = ref("");

async function load() {
  loading.value = true;
  try {
    const r = await listTrash();
    items.value = r.items;
    cloudError.value = r.cloudError;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const tables = computed(() => [...new Set(items.value.map(i => i.table))].sort((a, b) => trashTableLabel(a).localeCompare(trashTableLabel(b), "zh-TW")));
const shown = computed(() => items.value.filter(i =>
  (!filterTable.value || i.table === filterTable.value)
  && (!search.value.trim() || `${i.label} ${i.key}`.toLowerCase().includes(search.value.trim().toLowerCase()))));

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ── 還原（同名時確認是否覆蓋）──────────────────────────────────
const conflict = ref<{ item: TrashItem; message: string } | null>(null);
async function restore(item: TrashItem, overwrite = false) {
  busy.value = item.id;
  conflict.value = null;
  try {
    await restoreTrash(item, overwrite);
    items.value = items.value.filter(i => i.id !== item.id);
    emit("toast", "success", `已還原${trashTableLabel(item.table)}「${item.label}」，其他電腦同步後也會回來`);
    emit("changed");
  } catch (e) {
    if (e instanceof TrashConflictError) conflict.value = { item, message: e.message };
    else emit("toast", "error", `還原失敗：${(e as Error).message}`);
  } finally {
    busy.value = "";
  }
}

// ── 永久刪除、清空 ───────────────────────────────────────────
const confirmRemove = ref<TrashItem | null>(null);
async function remove(item: TrashItem) {
  busy.value = item.id;
  confirmRemove.value = null;
  try {
    await removeTrash([item.id]);
    items.value = items.value.filter(i => i.id !== item.id);
    emit("toast", "success", `已永久刪除「${item.label}」`);
  } finally {
    busy.value = "";
  }
}
const showClear = ref(false);
const clearText = ref("");
async function clearAll() {
  if (clearText.value !== "清空") return;
  busy.value = "all";
  try {
    await clearTrash();
    items.value = [];
    showClear.value = false;
    clearText.value = "";
    emit("toast", "success", "已清空垃圾桶");
  } catch (e) {
    emit("toast", "error", `清空失敗：${(e as Error).message}`);
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto px-8 py-6 space-y-4 select-text">
    <div class="flex items-center gap-3">
      <h2 class="text-base font-bold text-fg">垃圾桶</h2>
      <span class="text-xs text-muted">刪除的資料保留 {{ TRASH_KEEP_DAYS }} 天，所有電腦共用；還原後其他電腦同步也會回來</span>
      <button class="ml-auto text-xs px-3 py-1.5 rounded-lg border border-hairline hover:bg-elevated disabled:opacity-40" :disabled="loading" @click="load">
        {{ loading ? "讀取中…" : "↻ 重新整理" }}
      </button>
      <button class="text-xs px-3 py-1.5 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-40"
        :disabled="!items.length" @click="showClear = true">清空垃圾桶</button>
    </div>

    <div v-if="cloudError" class="text-xs text-warning">無法讀取雲端垃圾桶（{{ cloudError }}），只顯示這台電腦還沒上傳的項目</div>

    <div class="flex items-center gap-2">
      <select v-model="filterTable" class="text-xs px-2 py-1.5 rounded-lg bg-surface border border-hairline">
        <option value="">全部類別（{{ items.length }}）</option>
        <option v-for="t in tables" :key="t" :value="t">{{ trashTableLabel(t) }}（{{ items.filter(i => i.table === t).length }}）</option>
      </select>
      <input v-model="search" placeholder="搜尋名稱" class="text-xs px-3 py-1.5 rounded-lg bg-surface border border-hairline w-56 outline-none focus:border-accent/50" />
    </div>

    <p v-if="!loading && !shown.length" class="py-16 text-center text-sm text-muted">{{ items.length ? "沒有符合的項目" : "垃圾桶是空的" }}</p>
    <table v-else class="w-full text-xs">
      <thead class="text-muted text-left">
        <tr><th class="py-2 px-2 w-28">類別</th><th class="px-2">名稱</th><th class="px-2 w-28">刪除時間</th><th class="px-2 w-32">電腦</th><th class="px-2 w-20">保留</th><th class="w-40"></th></tr>
      </thead>
      <tbody>
        <tr v-for="i in shown" :key="i.id" class="border-t border-hairline">
          <td class="py-2 px-2 text-fg-secondary">{{ trashTableLabel(i.table) }}</td>
          <td class="px-2">
            <span class="font-bold text-fg">{{ i.label }}</span>
            <span v-if="i.label !== i.key" class="ml-2 text-muted font-mono">{{ i.key.length > 24 ? "" : i.key }}</span>
            <span v-if="i.pending" class="ml-2 text-2xs text-warning">尚未上傳</span>
          </td>
          <td class="px-2 text-muted">{{ fmt(i.deleted_at) }}</td>
          <td class="px-2 text-muted truncate" :title="i.machine">{{ i.machine || "—" }}</td>
          <td class="px-2" :class="daysLeft(i) <= 3 ? 'text-danger font-bold' : 'text-muted'">剩 {{ daysLeft(i) }} 天</td>
          <td class="px-2 text-right whitespace-nowrap">
            <button class="px-2.5 py-1 rounded-lg bg-accent text-white font-bold disabled:opacity-40" :disabled="!!busy" @click="restore(i)">還原</button>
            <button class="ml-1 px-2.5 py-1 rounded-lg text-muted hover:text-danger disabled:opacity-40" :disabled="!!busy" @click="confirmRemove = i">永久刪除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 同名衝突 -->
    <div v-if="conflict" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60" @click.self="conflict = null">
      <div class="w-[420px] bg-surface border border-hairline rounded-2xl p-6 space-y-4 text-sm">
        <p class="font-bold text-fg">{{ conflict.message }}</p>
        <p class="text-fg-secondary">還原會用垃圾桶裡的內容覆蓋現有的資料。</p>
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded-xl border border-hairline" @click="conflict = null">取消</button>
          <button class="px-4 py-2 rounded-xl bg-danger text-white font-bold" @click="restore(conflict.item, true)">覆蓋現有的</button>
        </div>
      </div>
    </div>

    <!-- 永久刪除確認 -->
    <div v-if="confirmRemove" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60" @click.self="confirmRemove = null">
      <div class="w-[420px] bg-surface border border-hairline rounded-2xl p-6 space-y-4 text-sm">
        <p class="font-bold text-fg">永久刪除「{{ confirmRemove.label }}」？</p>
        <p class="text-fg-secondary">從垃圾桶移除後就無法再還原（所有電腦）。</p>
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded-xl border border-hairline" @click="confirmRemove = null">取消</button>
          <button class="px-4 py-2 rounded-xl bg-danger text-white font-bold" @click="remove(confirmRemove)">永久刪除</button>
        </div>
      </div>
    </div>

    <!-- 清空確認 -->
    <div v-if="showClear" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60" @click.self="showClear = false">
      <div class="w-[420px] bg-surface border border-hairline rounded-2xl p-6 space-y-4 text-sm">
        <p class="font-bold text-fg">清空垃圾桶（{{ items.length }} 項）？</p>
        <p class="text-fg-secondary">所有電腦的垃圾桶都會清空，之後無法還原。請輸入「清空」確認。</p>
        <input v-model="clearText" class="w-full px-3 py-2 rounded-xl bg-sunken border border-hairline outline-none" />
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded-xl border border-hairline" @click="showClear = false; clearText = ''">取消</button>
          <button class="px-4 py-2 rounded-xl bg-danger text-white font-bold disabled:opacity-40" :disabled="clearText !== '清空' || busy === 'all'" @click="clearAll">清空</button>
        </div>
      </div>
    </div>
  </div>
</template>
