<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";

interface Physician { id: number; name: string; department: string; title: string; ext: string; his_account: string; his_password: string; phs_account: string; phs_password: string; notes: string; }

const physicians = ref<Physician[]>([]);
const search = ref("");
const deptFilter = ref("");
const vsOnly = ref(false);
const selected = ref<Physician | null>(null);
const toast = ref("");
const syncing = ref(false);
const cloud = useCloudSettings();
const pullTitleFilter = ref("主治醫師"); // 預設只拉主治醫師
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const departments = computed(() => {
  const seen = new Set<string>();
  physicians.value.forEach(p => { if (p.department && p.title === "主治醫師") seen.add(p.department); });
  return Array.from(seen).sort();
});

onMounted(async () => {
  await cloud.load();
  await load();
});

async function load() {
  const db = await getDb();
  physicians.value = await db.select<Physician[]>("SELECT * FROM physicians ORDER BY department, name");
}

const filtered = () => physicians.value.filter((p) => {
  const dept = p.department ?? "";
  if (deptFilter.value && dept !== deptFilter.value) return false;
  if (vsOnly.value && (p.title ?? "") !== "主治醫師") return false;
  if (!search.value) return true;
  return p.name.includes(search.value) || dept.includes(search.value);
});

function copy(text: string) {
  navigator.clipboard.writeText(text);
  showToast(`已複製：${text}`);
}

async function pushToCloud() {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS Web App URL"); return; }
  syncing.value = true;
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "savePhysicians", data: physicians.value }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    showToast(`已推送 ${physicians.value.length} 筆到雲端`);
  } catch (err) {
    showToast(`推送失敗：${(err as Error).message}`);
  } finally {
    syncing.value = false;
  }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS Web App URL"); return; }
  syncing.value = true;
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getPhysicians" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    let rows: Omit<Physician, "id">[] = json.data;
    if (!rows.length) { showToast("雲端無資料"); return; }

    // 依職稱篩選
    if (pullTitleFilter.value) {
      rows = rows.filter(r => r.title === pullTitleFilter.value);
      if (!rows.length) { showToast(`雲端無「${pullTitleFilter.value}」資料`); return; }
    }

    const db = await getDb();
    let inserted = 0, updated = 0;
    for (const r of rows) {
      const existing = await db.select<{ id: number }[]>(
        "SELECT id FROM physicians WHERE name = ?", [r.name]
      );
      if (existing.length) {
        await db.execute(
          `UPDATE physicians SET department=?, title=?, ext=?, his_account=?, his_password=?, phs_account=?, phs_password=?, notes=? WHERE id=?`,
          [r.department, r.title, r.ext ?? null, r.his_account, r.his_password, r.phs_account, r.phs_password, r.notes, existing[0].id]
        );
        updated++;
      } else {
        await db.execute(
          `INSERT INTO physicians (name, department, title, ext, his_account, his_password, phs_account, phs_password, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
          [r.name, r.department, r.title, r.ext ?? null, r.his_account, r.his_password, r.phs_account, r.phs_password, r.notes]
        );
        inserted++;
      }
    }
    await load();
    const filterLabel = pullTitleFilter.value ? `（${pullTitleFilter.value}）` : "";
    showToast(`拉取完成${filterLabel}：新增 ${inserted} 筆，更新 ${updated} 筆`);
  } catch (err) {
    showToast(`拉取失敗：${(err as Error).message}`);
  } finally {
    syncing.value = false;
  }
}

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

</script>

<template>
  <Transition name="toast">
    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-gray-700 text-white text-sm shadow-lg pointer-events-none">
      ✓ {{ toast }}
    </div>
  </Transition>

  <div class="flex gap-4 h-full">
    <!-- Left panel -->
    <div class="flex flex-col w-72 shrink-0">
      <input v-model="search" placeholder="搜尋姓名 / 科別…" class="mb-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" />

      <!-- Department filter tags -->
      <div v-if="departments.length" class="flex flex-wrap gap-1 mb-2">
        <button
          @click="deptFilter = ''"
          class="px-2 py-0.5 rounded-full text-xs transition-colors cursor-pointer"
          :class="deptFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'"
        >全部</button>
        <button
          v-for="dept in departments"
          :key="dept"
          @click="deptFilter = deptFilter === dept ? '' : dept"
          class="px-2 py-0.5 rounded-full text-xs transition-colors cursor-pointer"
          :class="deptFilter === dept ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'"
        >{{ dept }}</button>
        <button
          @click="vsOnly = !vsOnly"
          class="px-2 py-0.5 rounded-full text-xs transition-colors cursor-pointer"
          :class="vsOnly ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'"
        >主治醫師</button>
      </div>

      <!-- Cloud sync buttons -->
      <div class="mb-1 flex gap-1">
        <button @click="pushToCloud" :disabled="syncing"
          class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-800 text-blue-100 text-xs hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer">
          {{ syncing ? '…' : '☁️↑' }} 推送
        </button>
        <button @click="pullFromCloud" :disabled="syncing"
          class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-indigo-800 text-indigo-100 text-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer">
          {{ syncing ? '…' : '☁️↓' }} 拉取
        </button>
      </div>
      <!-- 拉取職稱篩選 -->
      <div class="mb-3 flex items-center gap-1.5">
        <span class="text-[10px] text-gray-600 shrink-0">拉取篩選</span>
        <select v-model="pullTitleFilter"
          class="flex-1 px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-xs focus:outline-none focus:border-indigo-500">
          <option value="">全部職稱</option>
          <option value="主治醫師">主治醫師</option>
          <option value="住院醫師">住院醫師</option>
          <option value="護理師">護理師</option>
        </select>
      </div>

      <p class="text-gray-600 text-xs mb-2">共 {{ filtered().length }} 人</p>

      <div class="flex-1 overflow-y-auto space-y-1">
        <div v-if="filtered().length === 0" class="text-gray-500 text-sm text-center py-8">{{ physicians.length === 0 ? '尚無資料' : '無符合結果' }}</div>
        <button v-for="p in filtered()" :key="p.id" @click="selected = p"
          class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors"
          :class="selected?.id === p.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'">
          <div class="font-medium">{{ p.name }}</div>
          <div class="text-xs opacity-60 mt-0.5">{{ p.department }} · {{ p.title }}</div>
        </button>
      </div>
    </div>

    <!-- Detail panel -->
    <div class="flex-1 rounded-xl bg-gray-900 border border-gray-800 p-5 overflow-y-auto">
      <div v-if="!selected" class="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
        <span class="text-4xl">👨‍⚕️</span>
        <p class="text-sm">選擇醫師查看詳細資料</p>
      </div>
      <div v-else>
        <div class="flex items-start justify-between mb-5">
          <div>
            <h2 class="text-xl font-semibold text-white">{{ selected.name }}</h2>
            <p class="text-gray-400 text-sm mt-0.5">{{ selected.department }} · {{ selected.title }}</p>
          </div>
        </div>

        <div v-if="selected.ext" class="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-800">
          <span class="text-gray-400 text-sm w-8 shrink-0">分機</span>
          <span class="text-white font-mono font-bold text-xl">{{ selected.ext }}</span>
        </div>

        <div class="mb-3 rounded-lg bg-gray-800 overflow-hidden">
          <p class="text-gray-500 text-xs font-semibold uppercase px-4 pt-3 pb-1">HIS 帳密</p>
          <button v-if="selected.his_account" @click="copy(selected.his_account)"
            class="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 active:bg-gray-600 transition-colors cursor-pointer text-left">
            <span class="text-gray-400 text-sm w-8 shrink-0">帳號</span>
            <span class="text-gray-100 font-mono text-base flex-1">{{ selected.his_account }}</span>
            <span class="text-gray-500 text-sm">📋</span>
          </button>
          <div v-else class="flex items-center gap-3 px-4 py-3">
            <span class="text-gray-400 text-sm w-8 shrink-0">帳號</span>
            <span class="text-gray-600 text-base">—</span>
          </div>
          <button v-if="selected.his_password" @click="copy(selected.his_password)"
            class="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 active:bg-gray-600 transition-colors cursor-pointer text-left border-t border-gray-700">
            <span class="text-gray-400 text-sm w-8 shrink-0">密碼</span>
            <span class="text-gray-100 font-mono text-base flex-1">{{ selected.his_password }}</span>
            <span class="text-gray-500 text-sm">📋</span>
          </button>
          <div v-else class="flex items-center gap-3 px-4 py-3 border-t border-gray-700">
            <span class="text-gray-400 text-sm w-8 shrink-0">密碼</span>
            <span class="text-gray-600 text-base">—</span>
          </div>
        </div>

        <div v-if="selected.phs_account || selected.phs_password" class="rounded-lg bg-gray-800 overflow-hidden">
          <p class="text-gray-500 text-xs font-semibold uppercase px-4 pt-3 pb-1">PHS 帳密</p>
          <button v-if="selected.phs_account" @click="copy(selected.phs_account)"
            class="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 active:bg-gray-600 transition-colors cursor-pointer text-left">
            <span class="text-gray-400 text-sm w-8 shrink-0">帳號</span>
            <span class="text-gray-100 font-mono text-base flex-1">{{ selected.phs_account }}</span>
            <span class="text-gray-500 text-sm">📋</span>
          </button>
          <div v-else class="flex items-center gap-3 px-4 py-3">
            <span class="text-gray-400 text-sm w-8 shrink-0">帳號</span>
            <span class="text-gray-600 text-base">—</span>
          </div>
          <button v-if="selected.phs_password" @click="copy(selected.phs_password)"
            class="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 active:bg-gray-600 transition-colors cursor-pointer text-left border-t border-gray-700">
            <span class="text-gray-400 text-sm w-8 shrink-0">密碼</span>
            <span class="text-gray-100 font-mono text-base flex-1">{{ selected.phs_password }}</span>
            <span class="text-gray-500 text-sm">📋</span>
          </button>
          <div v-else class="flex items-center gap-3 px-4 py-3 border-t border-gray-700">
            <span class="text-gray-400 text-sm w-8 shrink-0">密碼</span>
            <span class="text-gray-600 text-base">—</span>
          </div>
        </div>

        <div v-if="selected.notes" class="mt-3 p-3 rounded-lg bg-gray-800">
          <p class="text-gray-500 text-xs mb-1">備註</p>
          <p class="text-gray-300 text-sm">{{ selected.notes }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
