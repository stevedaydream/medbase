<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { refDebounced } from "@vueuse/core";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";

interface Item {
  hospital_code: string;
  name_en: string | null;
  name_zh: string | null;
  purpose: string | null;
  unit: string | null;
  price: number | null;
  supplier: string | null;
  notes: string | null;
  depts: string[];
}
interface SurgeryType { id: number; name: string; dept: string | null; notes: string | null }
interface DoctorWithSets { id: number; name: string; sets: { id: number; name: string }[] }
interface SetSearchEntry { setId: number; setName: string; doctorName: string; codes: string[] }

const PURPOSE_LIST = [
  "止血劑", "Mesh人工網膜", "骨板", "骨釘", "骨水泥",
  "關節假體", "傷口敷料", "引流耗材", "縫合材料", "內視鏡耗材", "其他",
];
const DEPT_LIST = ["骨科", "一般外科", "胸腔外科", "泌尿科", "乳房外科", "其他科"];

const items     = ref<Item[]>([]);
const searchRaw = ref("");
const search    = refDebounced(searchRaw, 300);
const loading   = ref(true);
const errMsg    = ref("");
const copiedCode = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

// ── 篩選狀態（多選，三維度同時生效）────────────────────────────
type FilterMode = "dept" | "purpose" | "surgery";
const filterMode      = ref<FilterMode>("dept");
const activeDepts     = ref(new Set<string>());
const activePurposes  = ref(new Set<string>());
const activeSurgeries = ref(new Set<number>());

// ── 手術術式資料 ─────────────────────────────────────────────────
const surgeryTypes       = ref<SurgeryType[]>([]);
const surgeryTypeItemMap = ref(new Map<number, Set<string>>());

// ── 醫師 / 套組快捷 ──────────────────────────────────────────────
const doctorsWithSets = ref<DoctorWithSets[]>([]);
const activeDoctorId  = ref<number | null>(null);
const activeSetId     = ref<number | null>(null);
const activeSetCodes  = ref<Set<string>>(new Set());
const setSearchIndex  = ref<SetSearchEntry[]>([]);

const activeDoctorSets = computed(() =>
  doctorsWithSets.value.find(d => d.id === activeDoctorId.value)?.sets ?? []
);

onUnmounted(() => { if (copiedTimer) clearTimeout(copiedTimer); });

onMounted(async () => {
  try {
    await loadItems();
    await loadDoctorsAndSets();
    await loadSurgeryTypes();
  } catch (e) { errMsg.value = `載入失敗：${(e as Error).message}`; }
  finally { loading.value = false; }
});

async function loadItems() {
  const db = await getDb();
  const raw = await db.select<Omit<Item, "depts">[]>("SELECT * FROM items ORDER BY name_zh");
  const deptRows = await db.select<{ hospital_code: string; dept: string }[]>(
    "SELECT hospital_code, dept FROM item_depts"
  );
  const deptMap = new Map<string, string[]>();
  for (const r of deptRows) {
    if (!deptMap.has(r.hospital_code)) deptMap.set(r.hospital_code, []);
    deptMap.get(r.hospital_code)!.push(r.dept);
  }
  items.value = raw.map(it => ({ ...it, depts: deptMap.get(it.hospital_code) ?? [] }));
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
  } catch { /* 套組資料載入失敗不影響主要品項功能 */ }
}

async function loadSurgeryTypes() {
  try {
    const db = await getDb();
    surgeryTypes.value = await db.select<SurgeryType[]>(
      "SELECT * FROM surgery_types ORDER BY dept, name"
    );
    const rows = await db.select<{ surgery_type_id: number; hospital_code: string }[]>(
      "SELECT surgery_type_id, hospital_code FROM surgery_type_items"
    );
    const map = new Map<number, Set<string>>();
    for (const r of rows) {
      if (!map.has(r.surgery_type_id)) map.set(r.surgery_type_id, new Set());
      map.get(r.surgery_type_id)!.add(r.hospital_code);
    }
    surgeryTypeItemMap.value = map;
  } catch { /* table not yet initialised */ }
}

// ── 重置所有維度篩選 ─────────────────────────────────────────────
function resetAllFilters() {
  activeDepts.value     = new Set();
  activePurposes.value  = new Set();
  activeSurgeries.value = new Set();
}

function selectDoctor(id: number) {
  if (activeDoctorId.value === id) {
    activeDoctorId.value = null;
    activeSetId.value    = null;
    activeSetCodes.value = new Set();
  } else {
    activeDoctorId.value = id;
    activeSetId.value    = null;
    activeSetCodes.value = new Set();
    resetAllFilters();
  }
}

async function selectSet(setId: number) {
  if (activeSetId.value === setId) {
    activeSetId.value    = null;
    activeSetCodes.value = new Set();
    resetAllFilters();
    return;
  }
  activeSetId.value = setId;
  resetAllFilters();
  const db = await getDb();
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

// ── 套組篩選層（基底）────────────────────────────────────────────
const setFiltered = computed(() => {
  if (activeSetId.value && activeSetCodes.value.size > 0)
    return items.value.filter(m => activeSetCodes.value.has(m.hospital_code));
  return items.value;
});

// ── 各維度標籤（計數以 setFiltered 為底，不受其他維度影響）──────
const deptTagList = computed(() => {
  const base = setFiltered.value;
  const counts = new Map<string, number>();
  for (const it of base)
    for (const d of it.depts) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [
    { key: "__all__", label: "全部", count: base.length, sub: "" },
    ...DEPT_LIST.filter(d => counts.has(d)).map(d => ({ key: d, label: d, count: counts.get(d)!, sub: "" })),
    ...[...counts.entries()].filter(([k]) => !DEPT_LIST.includes(k))
      .sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: key, count, sub: "" })),
  ];
});

const purposeTagList = computed(() => {
  const base = setFiltered.value;
  const counts = new Map<string, number>();
  for (const it of base) {
    const key = it.purpose ?? "其他";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    { key: "__all__", label: "全部", count: base.length, sub: "" },
    ...PURPOSE_LIST.filter(p => counts.has(p)).map(p => ({ key: p, label: p, count: counts.get(p) ?? 0, sub: "" })),
    ...[...counts.entries()].filter(([k]) => !PURPOSE_LIST.includes(k))
      .sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: key, count, sub: "" })),
  ];
});

const surgeryTagList = computed(() => {
  const baseCodes = new Set(setFiltered.value.map(m => m.hospital_code));
  return surgeryTypes.value.map(st => {
    const linked = surgeryTypeItemMap.value.get(st.id) ?? new Set<string>();
    const count  = [...linked].filter(c => baseCodes.has(c)).length;
    return { key: st.id as string | number, label: st.name, count, sub: st.dept ?? "" };
  }).filter(t => t.count > 0);
});

const currentTags = computed(() => {
  if (filterMode.value === "dept")    return deptTagList.value;
  if (filterMode.value === "purpose") return purposeTagList.value;
  return surgeryTagList.value;
});

// 目前模式下「全部」是否等同未選任何值
const isAllActive = computed(() => {
  if (filterMode.value === "dept")    return activeDepts.value.size === 0;
  if (filterMode.value === "purpose") return activePurposes.value.size === 0;
  return activeSurgeries.value.size === 0;
});

const tagActiveClass = computed(() => {
  if (filterMode.value === "dept")    return "bg-cyan-600 text-white shadow shadow-cyan-900/60";
  if (filterMode.value === "purpose") return "bg-teal-600 text-white shadow shadow-teal-900/60";
  return "bg-violet-600 text-white shadow shadow-violet-900/60";
});

function isActiveFilter(key: string | number): boolean {
  if (filterMode.value === "dept")    return activeDepts.value.has(key as string);
  if (filterMode.value === "purpose") return activePurposes.value.has(key as string);
  return activeSurgeries.value.has(key as number);
}

function toggleFilter(key: string | number) {
  if (key === "__all__") { resetAllFilters(); return; }
  if (filterMode.value === "dept") {
    const s = new Set(activeDepts.value);
    s.has(key as string) ? s.delete(key as string) : s.add(key as string);
    activeDepts.value = s;
  } else if (filterMode.value === "purpose") {
    const s = new Set(activePurposes.value);
    s.has(key as string) ? s.delete(key as string) : s.add(key as string);
    activePurposes.value = s;
  } else {
    const s = new Set(activeSurgeries.value);
    s.has(key as number) ? s.delete(key as number) : s.add(key as number);
    activeSurgeries.value = s;
  }
}

// ── 已選篩選 Chips ────────────────────────────────────────────────
const activeFilterChips = computed(() => {
  const chips: { label: string; typeLabel: string; mode: FilterMode; key: string | number }[] = [];
  for (const d of activeDepts.value)
    chips.push({ label: d, typeLabel: "科", mode: "dept", key: d });
  for (const p of activePurposes.value)
    chips.push({ label: p, typeLabel: "途", mode: "purpose", key: p });
  for (const sid of activeSurgeries.value) {
    const st = surgeryTypes.value.find(s => s.id === sid);
    if (st) chips.push({ label: st.name, typeLabel: "術", mode: "surgery", key: sid });
  }
  return chips;
});

function removeChip(chip: typeof activeFilterChips.value[0]) {
  if (chip.mode === "dept") {
    const s = new Set(activeDepts.value); s.delete(chip.key as string); activeDepts.value = s;
  } else if (chip.mode === "purpose") {
    const s = new Set(activePurposes.value); s.delete(chip.key as string); activePurposes.value = s;
  } else {
    const s = new Set(activeSurgeries.value); s.delete(chip.key as number); activeSurgeries.value = s;
  }
}

// ── 最終篩選 ─────────────────────────────────────────────────────
const filtered = computed(() => {
  let list = setFiltered.value;

  if (activeDepts.value.size > 0)
    list = list.filter(m => m.depts.some(d => activeDepts.value.has(d)));

  if (activePurposes.value.size > 0)
    list = list.filter(m => activePurposes.value.has(m.purpose ?? "其他"));

  if (activeSurgeries.value.size > 0) {
    const codes = new Set<string>();
    for (const sid of activeSurgeries.value)
      surgeryTypeItemMap.value.get(sid)?.forEach(c => codes.add(c));
    list = list.filter(m => codes.has(m.hospital_code));
  }

  const q = search.value.toLowerCase().trim();
  if (q) {
    const setMatchCodes = new Set<string>();
    for (const entry of setSearchIndex.value) {
      if (entry.setName.toLowerCase().includes(q) || entry.doctorName.toLowerCase().includes(q))
        entry.codes.forEach(c => setMatchCodes.add(c));
    }
    list = list.filter(m =>
      m.name_zh?.toLowerCase().includes(q) ||
      m.name_en?.toLowerCase().includes(q) ||
      m.hospital_code?.toLowerCase().includes(q) ||
      m.purpose?.toLowerCase().includes(q) ||
      m.supplier?.toLowerCase().includes(q) ||
      m.depts.some(d => d.toLowerCase().includes(q)) ||
      setMatchCodes.has(m.hospital_code)
    );
  }
  return list;
});

// ── 雲端同步 ─────────────────────────────────────────────────────
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
  isSyncing.value = true; setGlobalSyncing("items", true);
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
  } finally { isSyncing.value = false; setGlobalSyncing("items", false); }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { showSyncToast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("items", true);
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
  } finally { isSyncing.value = false; setGlobalSyncing("items", false); }
}

// ── 手術術式 CRUD ─────────────────────────────────────────────────
const showSurgeryMgmt  = ref(false);
const mgmtSelId        = ref<number | null>(null);
const mgmtSelCodes     = ref(new Set<string>());
const mgmtItemSearch   = ref("");
const mgmtOnlyLinked   = ref(false);
const mgmtShowForm     = ref(false);
const mgmtEditId       = ref<number | null>(null);
const mgmtFormName     = ref("");
const mgmtFormDept     = ref("");

const mgmtSelected = computed(() => surgeryTypes.value.find(s => s.id === mgmtSelId.value) ?? null);

const mgmtFilteredItems = computed(() => {
  const base = mgmtOnlyLinked.value
    ? items.value.filter(m => mgmtSelCodes.value.has(m.hospital_code))
    : items.value;
  const q = mgmtItemSearch.value.toLowerCase().trim();
  if (!q) return base;
  return base.filter(m =>
    m.name_zh?.toLowerCase().includes(q) ||
    m.name_en?.toLowerCase().includes(q) ||
    m.hospital_code?.toLowerCase().includes(q) ||
    m.purpose?.toLowerCase().includes(q)
  );
});

async function mgmtSelectSurgery(id: number) {
  mgmtSelId.value      = id;
  mgmtSelCodes.value   = new Set(surgeryTypeItemMap.value.get(id) ?? []);
  mgmtItemSearch.value = "";
  mgmtOnlyLinked.value = false;
}

function mgmtStartAdd() {
  mgmtEditId.value   = null;
  mgmtFormName.value = "";
  mgmtFormDept.value = "";
  mgmtShowForm.value = true;
}

function mgmtStartEdit(st: SurgeryType) {
  mgmtEditId.value   = st.id;
  mgmtFormName.value = st.name;
  mgmtFormDept.value = st.dept ?? "";
  mgmtShowForm.value = true;
}

async function mgmtSaveForm() {
  const name = mgmtFormName.value.trim();
  if (!name) return;
  const db = await getDb();
  if (mgmtEditId.value === null) {
    await db.execute("INSERT INTO surgery_types (name, dept) VALUES (?,?)",
      [name, mgmtFormDept.value.trim() || null]);
  } else {
    await db.execute("UPDATE surgery_types SET name=?, dept=? WHERE id=?",
      [name, mgmtFormDept.value.trim() || null, mgmtEditId.value]);
  }
  mgmtShowForm.value = false;
  await loadSurgeryTypes();
}

async function mgmtDeleteSurgery(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM surgery_types WHERE id=?", [id]);
  if (mgmtSelId.value === id) { mgmtSelId.value = null; mgmtSelCodes.value = new Set(); }
  const s = new Set(activeSurgeries.value); s.delete(id); activeSurgeries.value = s;
  await loadSurgeryTypes();
}

async function mgmtToggleItem(code: string) {
  if (!mgmtSelId.value) return;
  const db  = await getDb();
  const next = new Set(mgmtSelCodes.value);
  if (next.has(code)) {
    next.delete(code);
    await db.execute("DELETE FROM surgery_type_items WHERE surgery_type_id=? AND hospital_code=?",
      [mgmtSelId.value, code]);
  } else {
    next.add(code);
    await db.execute("INSERT OR IGNORE INTO surgery_type_items (surgery_type_id, hospital_code) VALUES (?,?)",
      [mgmtSelId.value, code]);
  }
  mgmtSelCodes.value = next;
  const newMap = new Map(surgeryTypeItemMap.value);
  newMap.set(mgmtSelId.value, next);
  surgeryTypeItemMap.value = newMap;
}

// ── 手術術式 雲端同步 ─────────────────────────────────────────────
const isSurgSyncing  = ref(false);
const surgSyncToast  = ref("");
let surgSyncTimer: ReturnType<typeof setTimeout> | null = null;
function showSurgToast(msg: string) {
  surgSyncToast.value = msg;
  if (surgSyncTimer) clearTimeout(surgSyncTimer);
  surgSyncTimer = setTimeout(() => { surgSyncToast.value = ""; }, 3000);
}

async function pushSurgeryTypesToCloud() {
  if (!cloud.gasUrl) { showSurgToast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSurgSyncing.value = true;
  try {
    const db = await getDb();
    const surgTypes = await db.select<{ id: number; name: string; dept: string | null; notes: string | null }[]>(
      "SELECT id, name, dept, notes FROM surgery_types ORDER BY id"
    );
    const surgTypeItems = await db.select<{ surgery_type_id: number; hospital_code: string }[]>(
      "SELECT surgery_type_id, hospital_code FROM surgery_type_items"
    );
    await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveSurgeryTypes", surgeryTypes: surgTypes, surgeryTypeItems: surgTypeItems }),
      mode: "no-cors",
    });
    showSurgToast(`已上傳 ${surgTypes.length} 個手術術式至雲端`);
  } catch (e) {
    showSurgToast(`上傳失敗：${(e as Error).message}`);
  } finally { isSurgSyncing.value = false; }
}

async function pullSurgeryTypesFromCloud() {
  if (!cloud.gasUrl) { showSurgToast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSurgSyncing.value = true;
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getSurgeryTypes" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const cloudTypes: { id: number; name: string; dept: string; notes: string }[] = json.surgeryTypes ?? [];
    const cloudItems: { surgery_type_id: number; hospital_code: string }[] = json.surgeryTypeItems ?? [];
    if (!cloudTypes.length) { showSurgToast("雲端無手術術式資料"); return; }

    const db = await getDb();
    // 以雲端為主：先清空再重建
    await db.execute("DELETE FROM surgery_type_items");
    await db.execute("DELETE FROM surgery_types");
    for (const t of cloudTypes) {
      await db.execute(
        "INSERT INTO surgery_types (id, name, dept, notes) VALUES (?,?,?,?)",
        [t.id, t.name, t.dept || null, t.notes || null]
      );
    }
    for (const si of cloudItems) {
      await db.execute(
        "INSERT OR IGNORE INTO surgery_type_items (surgery_type_id, hospital_code) VALUES (?,?)",
        [si.surgery_type_id, si.hospital_code]
      );
    }
    await loadSurgeryTypes();
    showSurgToast(`已從雲端同步 ${cloudTypes.length} 個手術術式`);
  } catch (e) {
    showSurgToast(`同步失敗：${(e as Error).message}`);
  } finally { isSurgSyncing.value = false; }
}
</script>

<template>
  <div class="flex flex-col h-full gap-3">

    <!-- ── 搜尋列 ──────────────────────────────────────────── -->
    <div class="flex items-center gap-3">
      <input
        v-model="searchRaw"
        placeholder="搜尋品名 / 院內碼 / 用途 / 科別 / 廠商 / 醫師 / 套組名…"
        class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500"
      />
      <span class="text-xs text-gray-500 shrink-0">{{ filtered.length }} / {{ items.length }} 筆</span>
      <button @click="pullFromCloud" :disabled="isSyncing"
        class="text-xs px-3 py-1.5 bg-blue-800/60 hover:bg-blue-700 disabled:opacity-40 text-blue-200 rounded whitespace-nowrap">
        {{ isSyncing ? "…" : "↓ 雲端同步" }}
      </button>
      <button @click="pushToCloud" :disabled="isSyncing"
        class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 rounded whitespace-nowrap">
        {{ isSyncing ? "…" : "↑ 上傳雲端" }}
      </button>
    </div>
    <Transition name="toast">
      <div v-if="syncToast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-50 pointer-events-none">
        {{ syncToast }}
      </div>
    </Transition>

    <!-- ── 醫師快捷 ─────────────────────────────────────────── -->
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

    <!-- ── 套組子按鈕 ───────────────────────────────────────── -->
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

    <!-- ── 篩選維度 (L1) ─────────────────────────────────────── -->
    <div class="space-y-2">
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          v-for="mode in ([
            { key: 'dept',    label: '科別' },
            { key: 'purpose', label: '用途' },
            { key: 'surgery', label: '手術術式' },
          ] as const)"
          :key="mode.key"
          @click="filterMode = mode.key"
          class="px-3 py-1 rounded-md text-xs font-medium transition-colors"
          :class="filterMode === mode.key
            ? 'bg-gray-600 text-white'
            : 'bg-gray-800/60 text-gray-500 hover:text-gray-300 border border-gray-700/50'"
        >
          {{ mode.label }}
          <span v-if="mode.key === 'surgery' && surgeryTypes.length > 0"
            class="ml-1 text-[10px] opacity-60">{{ surgeryTypes.length }}</span>
        </button>
        <button v-if="filterMode === 'surgery'"
          @click="showSurgeryMgmt = true"
          class="ml-1 text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-400 transition-colors">
          ⚙ 管理
        </button>
      </div>

      <!-- L2：目前維度的標籤 ──────────────────────────────── -->
      <div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
        <button
          v-for="tag in currentTags" :key="tag.key"
          @click="toggleFilter(tag.key)"
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
          :class="tag.key === '__all__'
            ? (isAllActive
                ? 'bg-gray-600 text-white'
                : 'bg-gray-800 text-gray-500 hover:bg-gray-700 border border-gray-700')
            : (isActiveFilter(tag.key)
                ? tagActiveClass
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-gray-700')"
        >
          {{ tag.label }}
          <span v-if="tag.sub" class="text-[9px] opacity-60 ml-0.5">{{ tag.sub }}</span>
          <span class="rounded-full px-1 text-[10px] font-mono ml-0.5"
            :class="(tag.key !== '__all__' && isActiveFilter(tag.key)) ? 'bg-white/20' : 'bg-gray-700 text-gray-500'">
            {{ tag.count }}
          </span>
        </button>
      </div>

      <!-- 已選篩選 Chips ──────────────────────────────────── -->
      <Transition name="slide-down">
        <div v-if="activeFilterChips.length > 0" class="flex flex-wrap gap-1 items-center">
          <span class="text-[10px] text-gray-600 shrink-0">篩選：</span>
          <span
            v-for="chip in activeFilterChips" :key="`${chip.mode}-${chip.key}`"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border"
            :class="{
              'bg-cyan-900/40 border-cyan-800/60 text-cyan-300':   chip.mode === 'dept',
              'bg-teal-900/40 border-teal-800/60 text-teal-300':   chip.mode === 'purpose',
              'bg-violet-900/40 border-violet-800/60 text-violet-300': chip.mode === 'surgery',
            }"
          >
            <span class="text-[9px] opacity-50">{{ chip.typeLabel }}</span>
            {{ chip.label }}
            <button @click="removeChip(chip)" class="opacity-50 hover:opacity-100 leading-none ml-0.5">×</button>
          </span>
          <button @click="resetAllFilters" class="text-[10px] text-gray-600 hover:text-gray-400 ml-1">
            清除全部
          </button>
        </div>
      </Transition>
    </div>

    <!-- ── 表格 ─────────────────────────────────────────────── -->
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
              {{ search ? "找不到符合的品項" : "此條件無資料" }}
            </td>
          </tr>
          <tr
            v-for="m in filtered" :key="m.hospital_code"
            class="border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors"
          >
            <td
              class="px-4 py-2.5 font-mono text-xs cursor-pointer select-none transition-colors"
              :class="copiedCode === m.hospital_code ? 'text-green-400' : 'text-gray-400 hover:text-teal-400'"
              :title="'複製 ' + m.hospital_code"
              @click="copyCode(m.hospital_code)"
            >
              {{ copiedCode === m.hospital_code ? "✓ 已複製" : m.hospital_code }}
            </td>
            <td class="px-4 py-2.5 text-gray-200 font-medium">{{ m.name_zh || "—" }}</td>
            <td class="px-4 py-2.5 text-gray-400 text-xs">{{ m.name_en || "—" }}</td>
            <td class="px-4 py-2.5">
              <span v-if="m.purpose" class="text-xs bg-teal-900/40 text-teal-300 px-2 py-0.5 rounded-full">
                {{ m.purpose }}
              </span>
              <span v-else class="text-gray-600 text-xs">—</span>
            </td>
            <td class="px-4 py-2.5">
              <div class="flex flex-wrap gap-1">
                <span v-for="d in m.depts" :key="d"
                  class="text-xs bg-cyan-900/30 text-cyan-400 px-1.5 py-0.5 rounded">{{ d }}</span>
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

  <!-- ── 手術術式管理 Modal ──────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="showSurgeryMgmt"
      class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="showSurgeryMgmt = false">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[780px] max-w-[95vw] h-[600px] max-h-[90vh] flex flex-col">

        <!-- Modal Header -->
        <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-700 shrink-0">
          <h3 class="text-white font-semibold text-sm shrink-0">管理手術術式</h3>
          <div class="flex items-center gap-1.5 flex-1">
            <button @click="pullSurgeryTypesFromCloud" :disabled="isSurgSyncing"
              class="text-xs px-2.5 py-1 rounded bg-blue-800/60 hover:bg-blue-700 disabled:opacity-40 text-blue-200 transition-colors whitespace-nowrap">
              {{ isSurgSyncing ? '…' : '↓ 雲端同步' }}
            </button>
            <button @click="pushSurgeryTypesToCloud" :disabled="isSurgSyncing"
              class="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 transition-colors whitespace-nowrap">
              {{ isSurgSyncing ? '…' : '↑ 上傳雲端' }}
            </button>
            <span v-if="surgSyncToast" class="text-xs text-gray-400 ml-1">{{ surgSyncToast }}</span>
          </div>
          <button @click="showSurgeryMgmt = false" class="text-gray-500 hover:text-white text-xl leading-none transition-colors shrink-0">×</button>
        </div>

        <!-- Modal Body -->
        <div class="flex flex-1 min-h-0">

          <!-- 左欄：術式清單 -->
          <div class="w-56 border-r border-gray-700 flex flex-col shrink-0">
            <div class="p-3 border-b border-gray-700/50 shrink-0">
              <button @click="mgmtStartAdd"
                class="w-full text-xs px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white transition-colors font-medium">
                ＋ 新增術式
              </button>
            </div>

            <!-- 新增 / 編輯表單 -->
            <Transition name="slide-down">
              <div v-if="mgmtShowForm" class="p-3 space-y-2 border-b border-gray-700/50 bg-gray-800/50 shrink-0">
                <input v-model="mgmtFormName" placeholder="術式名稱 *" maxlength="40"
                  class="w-full px-2.5 py-1.5 text-xs rounded bg-gray-700 border border-gray-600 text-gray-100 focus:outline-none focus:border-violet-500 placeholder-gray-500" />
                <input v-model="mgmtFormDept" placeholder="科別（選填）" maxlength="20"
                  class="w-full px-2.5 py-1.5 text-xs rounded bg-gray-700 border border-gray-600 text-gray-100 focus:outline-none focus:border-violet-500 placeholder-gray-500" />
                <div class="flex gap-2">
                  <button @click="mgmtSaveForm" :disabled="!mgmtFormName.trim()"
                    class="flex-1 text-xs py-1 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition-colors">
                    {{ mgmtEditId === null ? "新增" : "儲存" }}
                  </button>
                  <button @click="mgmtShowForm = false"
                    class="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                    取消
                  </button>
                </div>
              </div>
            </Transition>

            <!-- 術式列表 -->
            <div class="flex-1 overflow-y-auto">
              <div v-if="surgeryTypes.length === 0" class="text-center text-gray-600 text-xs py-10">
                尚無術式，點上方新增
              </div>
              <button
                v-for="st in surgeryTypes" :key="st.id"
                @click="mgmtSelectSurgery(st.id)"
                class="w-full text-left px-3 py-2.5 border-b border-gray-800/50 flex items-start justify-between gap-1 transition-colors group"
                :class="mgmtSelId === st.id
                  ? 'bg-violet-900/40 border-l-2 border-l-violet-500 pl-2.5'
                  : 'hover:bg-gray-800/60'"
              >
                <div class="min-w-0 flex-1">
                  <div class="text-xs text-gray-200 truncate">{{ st.name }}</div>
                  <div v-if="st.dept" class="text-[10px] text-violet-400 mt-0.5">{{ st.dept }}</div>
                </div>
                <div class="flex items-center gap-0.5 shrink-0 mt-0.5">
                  <span class="text-[10px] font-mono text-gray-600 min-w-[20px] text-right">
                    {{ surgeryTypeItemMap.get(st.id)?.size ?? 0 }}
                  </span>
                  <button @click.stop="mgmtStartEdit(st)"
                    class="text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity px-1 text-[11px]">
                    ✎
                  </button>
                  <button @click.stop="mgmtDeleteSurgery(st.id)"
                    class="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-1 text-[11px]">
                    ✕
                  </button>
                </div>
              </button>
            </div>
          </div>

          <!-- 右欄：品項關聯 -->
          <div class="flex-1 flex flex-col min-w-0">
            <div v-if="!mgmtSelId" class="flex-1 flex items-center justify-center text-gray-600 text-sm">
              選擇左側術式以管理關聯品項
            </div>
            <template v-else>
              <!-- 右欄 Header -->
              <div class="px-4 py-2.5 border-b border-gray-700/50 flex items-center gap-3 shrink-0 flex-wrap gap-y-1.5">
                <span class="text-sm text-white font-medium">{{ mgmtSelected?.name }}</span>
                <span v-if="mgmtSelected?.dept" class="text-xs text-violet-400">{{ mgmtSelected.dept }}</span>
                <span class="text-xs text-gray-500">已關聯 {{ mgmtSelCodes.size }} 筆</span>
                <label class="ml-auto flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                  <input type="checkbox" v-model="mgmtOnlyLinked" class="accent-violet-500" />
                  只顯示已關聯
                </label>
              </div>
              <!-- 搜尋 -->
              <div class="px-4 py-2 border-b border-gray-700/30 shrink-0">
                <input v-model="mgmtItemSearch" placeholder="搜尋品名 / 院內碼 / 用途…"
                  class="w-full px-3 py-1.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-violet-500 placeholder-gray-500" />
              </div>
              <!-- 品項清單 -->
              <div class="flex-1 overflow-y-auto">
                <div v-if="mgmtFilteredItems.length === 0" class="text-center text-gray-600 text-xs py-10">
                  {{ mgmtItemSearch ? "找不到符合的品項" : (mgmtOnlyLinked ? "尚無關聯品項" : "無品項資料") }}
                </div>
                <div
                  v-for="m in mgmtFilteredItems" :key="m.hospital_code"
                  class="flex items-center gap-3 px-4 py-2 border-b border-gray-700/20 hover:bg-gray-800/50 cursor-pointer transition-colors select-none"
                  @click="mgmtToggleItem(m.hospital_code)"
                >
                  <div class="shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors"
                    :class="mgmtSelCodes.has(m.hospital_code)
                      ? 'bg-violet-600 border-violet-500'
                      : 'border-gray-600'">
                    <span v-if="mgmtSelCodes.has(m.hospital_code)" class="text-white text-[10px] leading-none">✓</span>
                  </div>
                  <span class="text-[10px] font-mono text-gray-500 shrink-0 w-22">{{ m.hospital_code }}</span>
                  <span class="text-xs text-gray-200 flex-1 truncate">{{ m.name_zh || m.name_en || "—" }}</span>
                  <span v-if="m.purpose" class="text-[10px] text-teal-400 shrink-0 truncate max-w-[80px]">{{ m.purpose }}</span>
                  <span v-if="m.depts.length" class="text-[10px] text-cyan-500 shrink-0">{{ m.depts[0] }}</span>
                </div>
              </div>
            </template>
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active { transition: all 0.2s ease; }
.slide-down-enter-from,
.slide-down-leave-to { opacity: 0; transform: translateY(-6px); }
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
