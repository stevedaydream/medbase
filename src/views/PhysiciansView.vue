<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import * as XLSX from "xlsx";
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
    const rows: Omit<Physician, "id">[] = json.data;
    if (!rows.length) { showToast("雲端無資料"); return; }
    const db = await getDb();
    for (const r of rows) {
      await db.execute(
        `INSERT OR REPLACE INTO physicians (name, department, title, ext, his_account, his_password, phs_account, phs_password, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [r.name, r.department, r.title, r.ext, r.his_account, r.his_password, r.phs_account, r.phs_password, r.notes]
      );
    }
    await load();
    showToast(`已從雲端拉取 ${rows.length} 筆`);
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

// 批次匯入 XLSX（對應 parse-data.cjs 輸出格式）
async function importXlsx(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
    const db = await getDb();
    let count = 0;
    for (const row of rows) {
      const name = (row["name"] ?? row["姓名"] ?? "").trim();
      if (!name) continue;
      await db.execute(
        `INSERT OR REPLACE INTO physicians (name, department, title, ext, his_account, his_password, phs_account, phs_password, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          name,
          (row["department"] ?? row["科別"] ?? "").trim(),
          (row["title"] ?? row["職稱"] ?? "主治醫師").trim(),
          (row["ext"] ?? row["分機"] ?? "").trim(),
          (row["his_account"] ?? row["HIS帳號"] ?? "").trim(),
          (row["his_password"] ?? row["HIS密碼"] ?? "").trim(),
          (row["phs_account"] ?? "").trim(),
          (row["phs_password"] ?? "").trim(),
          (row["notes"] ?? row["備註"] ?? "").trim(),
        ]
      );
      count++;
    }
    (e.target as HTMLInputElement).value = "";
    await load();
    alert(`✓ 已匯入 ${count} 位醫師`);
  } catch (err) {
    alert(`匯入失敗：${(err as Error).message}`);
    (e.target as HTMLInputElement).value = "";
  }
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

      <!-- Import button -->
      <label class="mb-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-800 text-green-100 text-xs cursor-pointer hover:bg-green-700 transition-colors">
        📥 批次匯入 XLSX
        <input type="file" accept=".xlsx,.xls" class="hidden" @change="importXlsx" />
      </label>

      <!-- Cloud sync buttons -->
      <div class="mb-3 flex gap-1">
        <button @click="pushToCloud" :disabled="syncing"
          class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-800 text-blue-100 text-xs hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer">
          {{ syncing ? '…' : '☁️↑' }} 推送
        </button>
        <button @click="pullFromCloud" :disabled="syncing"
          class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-indigo-800 text-indigo-100 text-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer">
          {{ syncing ? '…' : '☁️↓' }} 拉取
        </button>
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
        <p class="text-sm">選擇醫師，或點「批次匯入 XLSX」載入 physicians_parsed.xlsx</p>
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
