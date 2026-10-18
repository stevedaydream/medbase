<script setup lang="ts">
import { ref, computed } from "vue";
import { useSchedStore } from "@/composables/useSchedStore";
import { createSnapshot, deleteSnapshot } from "@/composables/useSchedFlow";
import { snapsOf, snapshotDiff } from "@/shared/sched/snapshots";
import { SNAP_SLOTS, type SnapshotDoc } from "@/shared/sched/types";

/**
 * 存檔點：建立、還原、刪除（整月排班層＋預班層）。
 * restoreBlocked：目前不能還原的原因（已發布、沒有排班鎖）；空字串＝可以還原。
 */
const props = defineProps<{ ym: string; restoreBlocked: string }>();
const emit = defineEmits<{ close: []; toast: [msg: string]; restore: [snap: SnapshotDoc] }>();
const store = useSchedStore();

const list = computed(() => snapsOf(store.snaps, props.ym));
const name = ref("");
const busy = ref(false);
const AUTO_LABEL = { start: "開始排班", publish: "發布前" } as const;
const STATUS_LABEL = { open: "開放預班", scheduling: "排班中", published: "已發布" } as const;

async function create() {
  busy.value = true;
  try {
    const full = list.value.length >= SNAP_SLOTS;
    await createSnapshot(props.ym, name.value || `存檔點 ${new Date().toLocaleString()}`);
    name.value = "";
    emit("toast", full ? `已建立存檔點（已滿 ${SNAP_SLOTS} 個，覆蓋最舊的一個）` : "已建立存檔點");
  } catch (e) {
    emit("toast", `建立失敗：${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}

/** 確認還原：先顯示會改動幾格 */
const confirming = ref<SnapshotDoc | null>(null);
const preview = computed(() => {
  const s = confirming.value, m = store.months[props.ym];
  if (!s || !m) return null;
  const d = snapshotDiff(s, m, store.prebooks[props.ym]);
  const emp = d.pre.filter(c => (c.before?.src ?? c.after?.src) === "emp").length;
  return { sched: d.sched.length, pre: d.pre.length, emp };
});

async function remove(s: SnapshotDoc) {
  if (!window.confirm(`刪除存檔點「${s.name}」？`)) return;
  await deleteSnapshot(s);
}
const fmt = (iso: string) => new Date(iso).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm text-xs" @click.self="emit('close')">
    <div class="bg-surface border border-hairline rounded-xl shadow-2xl p-5 w-[34rem] max-h-[80vh] flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-fg">{{ ym }} 存檔點</h3>
        <span class="text-muted">{{ list.length }}／{{ SNAP_SLOTS }}</span>
        <button class="ml-auto text-muted hover:text-fg" @click="emit('close')">✕</button>
      </div>
      <p class="text-fg-secondary leading-relaxed">
        存下整月的排班層與預班層，隨時可以回到這個狀態。開始排班、發布前會自動存一份；滿 {{ SNAP_SLOTS }} 個時先覆蓋最舊的自動存檔點。
        還原算一步操作，還原後按「復原」可以撤銷。
      </p>
      <div class="flex items-center gap-2">
        <input v-model="name" placeholder="名稱，例如：排完 N 班" class="sched-input flex-1 py-1.5" maxlength="40" @keydown.enter="create" />
        <button class="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-40" :disabled="busy" @click="create">＋ 建立存檔點</button>
      </div>
      <div v-if="restoreBlocked" class="px-2 py-1.5 rounded bg-warning/10 text-warning">{{ restoreBlocked }}</div>

      <div class="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
        <div v-if="!list.length" class="py-6 text-center text-muted">還沒有存檔點</div>
        <div v-for="s in list" :key="s.slot" class="flex items-center gap-2 px-2 py-1.5 rounded border border-hairline hover:bg-elevated">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-fg truncate">{{ s.name }}</span>
              <span v-if="s.auto" class="text-2xs px-1.5 rounded bg-accent/10 text-accent">自動・{{ AUTO_LABEL[s.auto] }}</span>
            </div>
            <div class="text-muted">{{ fmt(s.at) }}・{{ s.by }}・建立時{{ STATUS_LABEL[s.status] }}</div>
          </div>
          <button class="px-2.5 py-1 border border-hairline rounded hover:bg-surface disabled:opacity-40" :disabled="!!restoreBlocked"
            :title="restoreBlocked" @click="confirming = s">還原</button>
          <button class="px-1.5 py-1 text-muted hover:text-danger" title="刪除" @click="remove(s)">🗑</button>
        </div>
      </div>

      <div v-if="confirming && preview" class="border border-warning/50 rounded p-3 bg-warning/5 space-y-2">
        <div class="font-semibold text-fg">還原到「{{ confirming.name }}」？</div>
        <div v-if="!preview.sched && !preview.pre" class="text-fg-secondary">目前與這個存檔點相同，沒有需要還原的格子。</div>
        <div v-else class="text-fg-secondary">
          會改動排班層 {{ preview.sched }} 格、預班層 {{ preview.pre }} 格<span v-if="preview.emp">（其中 {{ preview.emp }} 格是員工登記的預班，會通知本人）</span>。
        </div>
        <div class="flex justify-end gap-2">
          <button class="px-3 py-1 text-muted" @click="confirming = null">取消</button>
          <button class="px-3 py-1 bg-warning text-white rounded disabled:opacity-40" :disabled="!preview.sched && !preview.pre"
            @click="emit('restore', confirming); confirming = null">確認還原</button>
        </div>
      </div>
    </div>
  </div>
</template>
