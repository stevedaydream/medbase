<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { refDebounced } from "@vueuse/core";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";

interface Item {
  hospital_code: string;
  name_en: string | null;
  name_zh: string | null;
  purpose: string | null;   // 產品用途（止血劑/Mesh/骨板…）
  unit: string | null;
  price: number | null;
  supplier: string | null;
  notes: string | null;
  depts: string[];          // 來自 item_depts（前端合併）
}

// 固定用途清單（L1 標籤）
const PURPOSE_LIST = [
  "止血劑", "Mesh人工網膜", "骨板", "骨釘", "骨水泥",
  "關節假體", "傷口敷料", "引流耗材", "縫合材料", "內視鏡耗材", "其他",
];

const DEPT_LIST = ["骨科", "一般外科", "胸腔外科", "泌尿科", "乳房外科", "其他科"];

interface DoctorWithSets {
  id: number; name: string;
  sets: { id: number; name: string }[];
}
interface SetSearchEntry {
  setId: number; setName: string; doctorName: string; codes: string[];
}

const items      = ref<Item[]>([]);
const searchRaw  = ref("");
const search     = refDebounced(searchRaw, 300);
const loading    = ref(true);
const activePurpose = ref("__all__");
const activeDept    = ref("__all__");
const copiedCode    = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

// ── Sets / Doctor shortcuts ──────────────────────────────────────
const doctorsWithSets  = ref<DoctorWithSets[]>([]);
const activeDoctorId   = ref<number | null>(null);
const activeSetId      = ref<number | null>(null);
const activeSetCodes   = ref<Set<string>>(new Set());
const setSearchIndex   = ref<SetSearchEntry[]>([]);

const activeDoctorSets = computed(() =>
  doctorsWithSets.value.find(d => d.id === activeDoctorId.value)?.sets ?? []
);

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});

const errMsg = ref("");

onMounted(async () => {
  try {
    await loadItems();
    await loadDoctorsAndSets();
  } catch (e) { errMsg.value = `載入失敗：${(e as Error).message}`; }
  finally { loading.value = false; }
});

async function loadItems() {
  const db = await getDb();
  const raw = await db.select<Omit<Item, "depts">[]>(
    "SELECT * FROM items ORDER BY name_zh"
  );
  const deptRows = await db.select<{ hospital_code: string; dept: string }[]>(
    "SELECT hospital_code, dept FROM item_depts"
  );
  const deptMap = new Map<string, string[]>();
  for (const r of deptRows) {
    if (!deptMap.has(r.hospital_code)) deptMap.set(r.hospital_code, []);
    deptMap.get(r.hospital_code)!.push(r.dept);
  }
  items.value = raw.map((it) => ({
    ...it,
    depts: deptMap.get(it.hospital_code) ?? [],
  }));
}

async function loadDoctorsAndSets() {
  try {
    const db = await getDb();
    const docs = await db.select<{ id: number; name: string }[]>(
      `SELECT DISTINCT p.id, p.name FROM physicians p
       JOIN sets s ON s.physician_id = p.id ORDER BY p.name`
    );
    const setsData = await db.select<{ id: number; name: string; physician_id: number }[]>(
      "SELECT id, name, physician_id FROM sets ORDER BY name"
    );
    doctorsWithSets.value = docs.map(d => ({
      ...d, sets: setsData.filter(s => s.physician_id === d.id),
    }));

    // Build search index: set_id → {names, codes}
    const rows = await db.select<{ set_id: number; set_name: string; doctor_name: string; hospital_code: string }[]>(`
      SELECT si.set_id, s.name AS set_name, COALESCE(p.name,'') AS doctor_name, si.hospital_code
      FROM set_items si
      JOIN sets s ON s.id = si.set_id
      LEFT JOIN physicians p ON p.id = s.physician_id
    `);
    const map = new Map<number, SetSearchEntry>();
    for (const r of rows) {
      if (!map.has(r.set_id))
        map.set(r.set_id, { setId: r.set_id, setName: r.set_name, doctorName: r.doctor_name, codes: [] });
      map.get(r.set_id)!.codes.push(r.hospital_code);
    }
    setSearchIndex.value = [...map.values()];
  } catch {
    // 套組資料載入失敗不影響主要品項功能
  }
}

function selectDoctor(id: number) {
  if (activeDoctorId.value === id) {
    activeDoctorId.value = null;
    activeSetId.value     = null;
    activeSetCodes.value  = new Set();
  } else {
    activeDoctorId.value = id;
    activeSetId.value    = null;
    activeSetCodes.value = new Set();
    activePurpose.value  = "__all__";
    activeDept.value     = "__all__";
  }
}

async function selectSet(setId: number) {
  if (activeSetId.value === setId) {
    activeSetId.value    = null;
    activeSetCodes.value = new Set();
    activePurpose.value  = "__all__";
    return;
  }
  activeSetId.value   = setId;
  activePurpose.value = "__all__";
  activeDept.value    = "__all__";
  const db   = await getDb();
  const rows = await db.select<{ hospital_code: string }[]>(
    "SELECT hospital_code FROM set_items WHERE set_id = ?", [setId]
  );
  activeSetCodes.value = new Set(rows.map(r => r.hospital_code));
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    copiedCode.value = code;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedCode.value = null; }, 1500);
  } catch { /* clipboard denied */ }
}

// ── L1：用途標籤（固定清單 + 計數）────────────────────────────────
const purposeTags = computed(() => {
  const counts = new Map<string, number>();
  for (const it of items.value) {
    const key = it.purpose ?? "其他";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    { key: "__all__", label: "全部", count: items.value.length },
    ...PURPOSE_LIST
      .filter((p) => counts.has(p))
      .map((p) => ({ key: p, label: p, count: counts.get(p) ?? 0 })),
    // 不在固定清單中的用途也顯示
    ...[...counts.entries()]
      .filter(([k]) => !PURPOSE_LIST.includes(k))
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: key, count })),
  ];
});

function selectPurpose(key: string) {
  activePurpose.value = key;
  activeDept.value = "__all__";
}

// ── L2：科別子標籤（只在選定用途時，且有 item_depts 資料時顯示）───
const deptTags = computed(() => {
  if (activePurpose.value === "__all__") return [];
  const slice = purposeFiltered.value;
  const counts = new Map<string, number>();
  for (const it of slice) {
    for (const d of it.depts) {
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return [];
  return [
    { key: "__all__", label: "全部科別", count: slice.length },
    ...DEPT_LIST
      .filter((d) => counts.has(d))
      .map((d) => ({ key: d, label: d, count: counts.get(d)! })),
    ...[...counts.entries()]
      .filter(([k]) => !DEPT_LIST.includes(k))
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: key, count })),
  ];
});

// 套組篩選層
const setFiltered = computed(() => {
  if (activeSetId.value && activeSetCodes.value.size > 0)
    return items.value.filter(m => activeSetCodes.value.has(m.hospital_code));
  return items.value;
});

// 套組啟用時的用途快捷標籤（聯集）
const setDerivedPurposeTags = computed(() => {
  if (!activeSetId.value || activeSetCodes.value.size === 0) return null;
  const counts = new Map<string, number>();
  for (const it of setFiltered.value) {
    const key = it.purpose ?? "其他";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size <= 1) return null; // 只有一種用途時不必顯示
  return [
    { key: "__all__", label: "全部", count: setFiltered.value.length },
    ...([...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: key, count }))),
  ];
});

const displayPurposeTags = computed(() =>
  setDerivedPurposeTags.value ?? purposeTags.value
);

// 中間層：purpose 過濾（套組模式以 setFiltered 為底）
const purposeFiltered = computed(() => {
  const base = setFiltered.value;
  if (activePurpose.value === "__all__") return base;
  return base.filter((m) => (m.purpose ?? "其他") === activePurpose.value);
});

// ── 雲端同步 ──────────────────────────────────────────────────────
const cloud = useCloudSettings();
onMounted(() => cloud.load());
const isSyncing = ref(false);
const syncToast = ref("");
let syncToastTimer: ReturnType<typeof setTimeout> | null = null;
function showSyncToast(msg: string) {
  syncToast.value = msg;
  if (syncToastTimer) clearTimeout(syncToastTimer);
  syncToastTimer = setTimeout(() => { syncToast.value = ""; }, 3000);
}

async function pushToCloud() {
  if (!cloud.gasUrl) { showSyncToast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true;
  try {
    const db = await getDb();
    const raw = await db.select<Omit<Item, "depts">[]>("SELECT * FROM items ORDER BY name_zh");
    const deptRows = await db.select<{ hospital_code: string; dept: string }[]>("SELECT hospital_code, dept FROM item_depts");
    const deptMap = new Map<string, string[]>();
    for (const r of deptRows) {
      if (!deptMap.has(r.hospital_code)) deptMap.set(r.hospital_code, []);
      deptMap.get(r.hospital_code)!.push(r.dept);
    }
    const data = raw.map(it => ({ ...it, depts: deptMap.get(it.hospital_code) ?? [] }));
    await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveItems", data }),
      mode: "no-cors",
    });
    showSyncToast(`已上傳 ${data.length} 筆品項至雲端`);
  } catch (e) {
    showSyncToast(`上傳失敗：${(e as Error).message}`);
  } finally { isSyncing.value = false; }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { showSyncToast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true;
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getItems" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const data: (Omit<Item, "depts"> & { depts: string[] })[] = json.data;
    if (!data.length) { showSyncToast("雲端無品項資料"); return; }
    const db = await getDb();
    // Upsert items
    for (const it of data) {
      await db.execute(
        `INSERT OR REPLACE INTO items (hospital_code, name_en, name_zh, purpose, unit, price, supplier, notes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [it.hospital_code, it.name_en||null, it.name_zh||null, it.purpose||null,
         it.unit||null, it.price ?? null, it.supplier||null, it.notes||null]
      );
      await db.execute("DELETE FROM item_depts WHERE hospital_code = ?", [it.hospital_code]);
      for (const d of (it.depts ?? [])) {
        await db.execute("INSERT OR IGNORE INTO item_depts (hospital_code, dept) VALUES (?,?)", [it.hospital_code, d]);
      }
    }
    await loadItems();
    showSyncToast(`已從雲端同步 ${data.length} 筆品項`);
  } catch (e) {
    showSyncToast(`下載失敗：${(e as Error).message}`);
  } finally { isSyncing.value = false; }
}

// ── 最終過濾 ─────────────────────────────────────────────────────
const filtered = computed(() => {
  let list = purposeFiltered.value;

  // L2 科別
  if (activeDept.value !== "__all__") {
    list = list.filter((m) => m.depts.includes(activeDept.value));
  }

  // 關鍵字（含套組醫師名 / 套組名）
  const q = search.value.toLowerCase().trim();
  if (q) {
    const setMatchCodes = new Set<string>();
    for (const entry of setSearchIndex.value) {
      if (entry.setName.toLowerCase().includes(q) || entry.doctorName.toLowerCase().includes(q))
        entry.codes.forEach(c => setMatchCodes.add(c));
    }
    list = list.filter((m) =>
      m.name_zh?.toLowerCase().includes(q) ||
      m.name_en?.toLowerCase().includes(q) ||
      m.hospital_code?.toLowerCase().includes(q) ||
      m.purpose?.toLowerCase().includes(q) ||
      m.supplier?.toLowerCase().includes(q) ||
      m.depts.some((d) => d.toLowerCase().includes(q)) ||
      setMatchCodes.has(m.hospital_code)
    );
  }
  return list;
});
</script>

<template>
  <div class="flex flex-col h-full gap-3">

    <!-- ── 搜尋列 ─────────────────────────────────── -->
    <div class="flex items-center gap-3">
      <input
        v-model="searchRaw"
        placeholder="搜尋品名 / 院內碼 / 用途 / 科別 / 廠商 / 醫師 / 套組名…"
        class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500"
      />
      <span class="text-xs text-gray-500 shrink-0">{{ filtered.length }} / {{ items.length }} 筆</span>
      <button @click="pullFromCloud" :disabled="isSyncing"
        class="text-xs px-3 py-1.5 bg-blue-800/60 hover:bg-blue-700 disabled:opacity-40 text-blue-200 rounded whitespace-nowrap">
        {{ isSyncing ? '…' : '↓ 雲端同步' }}
      </button>
      <button @click="pushToCloud" :disabled="isSyncing"
        class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 rounded whitespace-nowrap">
        {{ isSyncing ? '…' : '↑ 上傳雲端' }}
      </button>
    </div>
    <Transition name="toast">
      <div v-if="syncToast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-50 pointer-events-none">
        {{ syncToast }}
      </div>
    </Transition>

    <!-- ── 醫師快捷按鈕 ──────────────────────────────── -->
    <div v-if="doctorsWithSets.length > 0" class="flex flex-wrap gap-1.5">
      <button
        v-for="doc in doctorsWithSets" :key="doc.id"
        @click="selectDoctor(doc.id)"
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
        :class="activeDoctorId === doc.id
          ? 'bg-indigo-700 text-white shadow shadow-indigo-900'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700'"
      >
        <span class="text-[11px]">👨‍⚕️</span>
        {{ doc.name }}
        <span class="rounded-full px-1.5 py-0.5 text-[10px] font-mono"
          :class="activeDoctorId === doc.id ? 'bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500'">
          {{ doc.sets.length }}
        </span>
      </button>
    </div>

    <!-- ── 醫師的套組子按鈕 ─────────────────────────── -->
    <Transition name="slide-down">
      <div v-if="activeDoctorId !== null && activeDoctorSets.length > 0"
        class="flex flex-wrap gap-1.5 pl-2 border-l-2 border-indigo-700">
        <button
          v-for="s in activeDoctorSets" :key="s.id"
          @click="selectSet(s.id)"
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
          :class="activeSetId === s.id
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-800/80 text-gray-400 hover:bg-indigo-950 hover:text-indigo-300 border border-gray-700'"
        >
          {{ s.name }}
          <span v-if="activeSetId === s.id && activeSetCodes.size > 0"
            class="bg-indigo-500 text-white rounded-full px-1.5 py-0.5 text-[10px] font-mono">
            {{ activeSetCodes.size }}
          </span>
        </button>
      </div>
    </Transition>

    <!-- ── L1 用途標籤 ─────────────────────────────── -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="tag in displayPurposeTags" :key="tag.key"
        @click="selectPurpose(tag.key)"
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
        :class="activePurpose === tag.key
          ? 'bg-teal-600 text-white shadow shadow-teal-900'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700'"
      >
        {{ tag.label }}
        <span
          class="rounded-full px-1.5 py-0.5 text-[10px] font-mono"
          :class="activePurpose === tag.key ? 'bg-teal-500 text-white' : 'bg-gray-700 text-gray-400'"
        >{{ tag.count }}</span>
      </button>
    </div>

    <!-- ── L2 科別子標籤（有才顯示） ─────────────────── -->
    <Transition name="slide-down">
      <div
        v-if="deptTags.length > 0"
        class="flex flex-wrap gap-1.5 pl-2 border-l-2 border-teal-700"
      >
        <button
          v-for="tag in deptTags" :key="tag.key"
          @click="activeDept = tag.key"
          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-all"
          :class="activeDept === tag.key
            ? 'bg-cyan-500 text-white'
            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-cyan-300 border border-gray-700'"
        >
          {{ tag.label }}
          <span
            class="rounded-full px-1 text-[10px] font-mono"
            :class="activeDept === tag.key ? 'bg-cyan-400 text-white' : 'bg-gray-700 text-gray-500'"
          >{{ tag.count }}</span>
        </button>
      </div>
    </Transition>

    <!-- ── 表格 ───────────────────────────────────── -->
    <div class="flex-1 rounded-xl bg-gray-900 border border-gray-800 overflow-auto min-h-0">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-gray-900 z-10">
          <tr class="border-b border-gray-800 text-gray-500 text-xs">
            <th class="text-left px-4 py-3 font-medium">院內碼</th>
            <th class="text-left px-4 py-3 font-medium">中文品名</th>
            <th class="text-left px-4 py-3 font-medium">英文品名</th>
            <th class="text-left px-4 py-3 font-medium">用途</th>
            <th class="text-left px-4 py-3 font-medium">適用科別</th>
            <th class="text-right px-4 py-3 font-medium">自費金額</th>
            <th class="text-left px-4 py-3 font-medium">單位</th>
            <th class="text-left px-4 py-3 font-medium">廠商</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="errMsg">
            <td colspan="8" class="text-center text-red-400 py-12">{{ errMsg }}</td>
          </tr>
          <tr v-else-if="loading">
            <td colspan="8" class="text-center text-gray-500 py-12">載入中…</td>
          </tr>
          <tr v-else-if="filtered.length === 0">
            <td colspan="8" class="text-center text-gray-600 py-12">
              {{ search ? "找不到符合的品項" : "此分類無資料" }}
            </td>
          </tr>
          <tr
            v-for="m in filtered" :key="m.hospital_code"
            class="border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors"
          >
            <td
              class="px-4 py-2.5 font-mono text-xs cursor-pointer select-none transition-colors"
              :class="copiedCode === m.hospital_code
                ? 'text-green-400'
                : 'text-gray-400 hover:text-teal-400'"
              :title="'複製 ' + m.hospital_code"
              @click="copyCode(m.hospital_code)"
            >
              {{ copiedCode === m.hospital_code ? "✓ 已複製" : m.hospital_code }}
            </td>
            <td class="px-4 py-2.5 text-gray-200 font-medium">{{ m.name_zh || "—" }}</td>
            <td class="px-4 py-2.5 text-gray-400 text-xs">{{ m.name_en || "—" }}</td>
            <td class="px-4 py-2.5">
              <span v-if="m.purpose"
                class="text-xs bg-teal-900/40 text-teal-300 px-2 py-0.5 rounded-full">
                {{ m.purpose }}
              </span>
              <span v-else class="text-gray-600 text-xs">—</span>
            </td>
            <td class="px-4 py-2.5">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="d in m.depts" :key="d"
                  class="text-xs bg-cyan-900/30 text-cyan-400 px-1.5 py-0.5 rounded"
                >{{ d }}</span>
                <span v-if="m.depts.length === 0" class="text-gray-600 text-xs">—</span>
              </div>
            </td>
            <td class="px-4 py-2.5 text-right text-green-400 font-mono">
              {{ m.price ? `$${m.price.toLocaleString()}` : "—" }}
            </td>
            <td class="px-4 py-2.5 text-gray-400 text-xs">{{ m.unit || "—" }}</td>
            <td class="px-4 py-2.5 text-gray-500 text-xs">{{ m.supplier || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active { transition: all 0.2s ease; }
.slide-down-enter-from,
.slide-down-leave-to { opacity: 0; transform: translateY(-6px); }
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
