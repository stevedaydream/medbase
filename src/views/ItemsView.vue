<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, type Ref } from "vue";
import { refDebounced } from "@vueuse/core";
import { getDb } from "@/db";
import { touchTable, markDeletedById, onTableSynced } from "@/composables/useTableSync";
import CloudSyncButtons from "@/components/CloudSyncButtons.vue";

/**
 * 自費品項查詢。
 * 左側篩選欄：科別／用途／手術術式／醫師套組四個區塊，同區塊內勾選為「或」、區塊之間為「且」；
 * 每個選項的筆數以「其他區塊條件＋搜尋」計算，勾下去前就知道會剩幾筆。
 * 搜尋：空白分隔的多個關鍵字須全部符合，比對品名、院內碼、用途、科別、廠商、單位、備註，以及含此品項的套組名稱與醫師。
 * 結果：兩行式清單，窄寬度也能看到所有欄位。
 */

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
interface SetEntry { setId: number; setName: string; doctorName: string; codes: Set<string> }

const PURPOSE_LIST = [
  "止血劑", "Mesh人工網膜", "骨板", "骨釘", "骨水泥",
  "關節假體", "傷口敷料", "引流耗材", "縫合材料", "內視鏡耗材", "其他",
];
const DEPT_LIST = ["骨科", "一般外科", "胸腔外科", "泌尿科", "乳房外科", "其他科"];
const NO_DOCTOR = "未指定醫師";

const items     = ref<Item[]>([]);
const searchRaw = ref("");
const search    = refDebounced(searchRaw, 200);
const loading   = ref(true);
const errMsg    = ref("");
const copiedCode = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

// ── 篩選狀態 ─────────────────────────────────────────────────────
const activeDepts     = ref(new Set<string>());
const activePurposes  = ref(new Set<string>());
const activeSurgeries = ref(new Set<number>());
const activeSets      = ref(new Set<number>());

// ── 手術術式／套組資料 ───────────────────────────────────────────
const surgeryTypes       = ref<SurgeryType[]>([]);
const surgeryTypeItemMap = ref(new Map<number, Set<string>>());
const setEntries         = ref<SetEntry[]>([]);

onUnmounted(() => { if (copiedTimer) clearTimeout(copiedTimer); });

onMounted(async () => {
  try {
    await loadItems();
    await loadSets();
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

async function loadSets() {
  try {
    const db = await getDb();
    const rows = await db.select<{ set_id: number; set_name: string; doctor_name: string; hospital_code: string | null }[]>(`
      SELECT si.set_id, s.name AS set_name, COALESCE(p.name,'') AS doctor_name, si.hospital_code
      FROM set_items si
      JOIN sets s ON s.id = si.set_id
      LEFT JOIN physicians p ON p.id = s.physician_id
    `);
    const map = new Map<number, SetEntry>();
    for (const r of rows) {
      if (!map.has(r.set_id))
        map.set(r.set_id, { setId: r.set_id, setName: r.set_name, doctorName: r.doctor_name || NO_DOCTOR, codes: new Set() });
      if (r.hospital_code) map.get(r.set_id)!.codes.add(r.hospital_code);
    }
    setEntries.value = [...map.values()].sort((a, b) =>
      a.doctorName.localeCompare(b.doctorName, "zh-TW") || a.setName.localeCompare(b.setName, "zh-TW"));
    // 已不存在的套組從篩選中移除
    const alive = new Set(setEntries.value.map(e => e.setId));
    if ([...activeSets.value].some(id => !alive.has(id)))
      activeSets.value = new Set([...activeSets.value].filter(id => alive.has(id)));
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

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    copiedCode.value = code;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedCode.value = null; }, 1500);
  } catch { /* clipboard denied */ }
}

// ── 比對 ─────────────────────────────────────────────────────────
type Dim = "dept" | "purpose" | "surgery" | "set";

// 每個品項的搜尋字串（含所屬套組名稱與醫師）
const haystacks = computed(() => {
  const setText = new Map<string, string[]>();
  for (const e of setEntries.value)
    for (const c of e.codes) {
      if (!setText.has(c)) setText.set(c, []);
      setText.get(c)!.push(e.setName, e.doctorName);
    }
  const map = new Map<string, string>();
  for (const m of items.value) {
    map.set(m.hospital_code, [
      m.hospital_code, m.name_zh, m.name_en, m.purpose, m.supplier, m.unit, m.notes,
      ...m.depts, ...(setText.get(m.hospital_code) ?? []),
    ].filter(Boolean).join(" ").toLowerCase());
  }
  return map;
});

const terms = computed(() => search.value.toLowerCase().split(/\s+/).filter(Boolean));

const searched = computed(() => {
  if (!terms.value.length) return items.value;
  return items.value.filter(m => {
    const h = haystacks.value.get(m.hospital_code) ?? "";
    return terms.value.every(t => h.includes(t));
  });
});

const surgeryCodes = computed(() => {
  if (!activeSurgeries.value.size) return null;
  const codes = new Set<string>();
  for (const id of activeSurgeries.value) surgeryTypeItemMap.value.get(id)?.forEach(c => codes.add(c));
  return codes;
});

const setCodes = computed(() => {
  if (!activeSets.value.size) return null;
  const codes = new Set<string>();
  for (const e of setEntries.value) if (activeSets.value.has(e.setId)) e.codes.forEach(c => codes.add(c));
  return codes;
});

const purposeOf = (m: Item) => m.purpose || "其他";

/** 除了 skip 這個區塊以外，其他區塊條件都符合 */
function passes(m: Item, skip?: Dim): boolean {
  if (skip !== "dept" && activeDepts.value.size && !m.depts.some(d => activeDepts.value.has(d))) return false;
  if (skip !== "purpose" && activePurposes.value.size && !activePurposes.value.has(purposeOf(m))) return false;
  if (skip !== "surgery" && surgeryCodes.value && !surgeryCodes.value.has(m.hospital_code)) return false;
  if (skip !== "set" && setCodes.value && !setCodes.value.has(m.hospital_code)) return false;
  return true;
}

const filtered = computed(() => searched.value.filter(m => passes(m)));

/**
 * 結果分段：有勾套組時依「醫師・套組」分段，同一品項屬於多個已勾套組會在各段出現；
 * 沒勾套組時為單一清單（title 為 null）。
 */
const sections = computed(() => {
  if (!activeSets.value.size) return [{ key: "all", title: null as string | null, items: filtered.value }];
  return setEntries.value
    .filter(e => activeSets.value.has(e.setId))
    .map(e => ({
      key: `set-${e.setId}`,
      title: `${e.doctorName}・${e.setName}` as string | null,
      items: filtered.value.filter(m => e.codes.has(m.hospital_code)),
    }))
    .filter(sec => sec.items.length);
});

function baseFor(dim: Dim) {
  return searched.value.filter(m => passes(m, dim));
}

// ── 各區塊選項與筆數 ─────────────────────────────────────────────
interface Option<K> { key: K; label: string; sub?: string; count: number }

function orderByPreset(keys: string[], preset: string[]) {
  return [...preset.filter(k => keys.includes(k)), ...keys.filter(k => !preset.includes(k)).sort((a, b) => a.localeCompare(b, "zh-TW"))];
}

const deptOptions = computed<Option<string>[]>(() => {
  const all = new Set(items.value.flatMap(m => m.depts));
  const counts = new Map<string, number>();
  for (const m of baseFor("dept")) for (const d of m.depts) counts.set(d, (counts.get(d) ?? 0) + 1);
  return orderByPreset([...all], DEPT_LIST).map(d => ({ key: d, label: d, count: counts.get(d) ?? 0 }));
});

const purposeOptions = computed<Option<string>[]>(() => {
  const all = new Set(items.value.map(purposeOf));
  const counts = new Map<string, number>();
  for (const m of baseFor("purpose")) counts.set(purposeOf(m), (counts.get(purposeOf(m)) ?? 0) + 1);
  return orderByPreset([...all], PURPOSE_LIST).map(p => ({ key: p, label: p, count: counts.get(p) ?? 0 }));
});

const surgeryOptions = computed<Option<number>[]>(() => {
  const base = new Set(baseFor("surgery").map(m => m.hospital_code));
  return surgeryTypes.value.map(st => {
    const linked = surgeryTypeItemMap.value.get(st.id) ?? new Set<string>();
    return { key: st.id, label: st.name, sub: st.dept ?? "", count: [...linked].filter(c => base.has(c)).length };
  });
});

const setGroups = computed(() => {
  const base = new Set(baseFor("set").map(m => m.hospital_code));
  const groups = new Map<string, { options: Option<number>[]; codes: Set<string> }>();
  for (const e of setEntries.value) {
    if (!groups.has(e.doctorName)) groups.set(e.doctorName, { options: [], codes: new Set() });
    const g = groups.get(e.doctorName)!;
    g.options.push({ key: e.setId, label: e.setName, count: [...e.codes].filter(c => base.has(c)).length });
    e.codes.forEach(c => g.codes.add(c));
  }
  // 醫師的筆數＝其所有套組品項的聯集（同一品項在多個套組只算一次）
  return [...groups.entries()].map(([doctor, g]) => ({
    doctor,
    options: g.options,
    setIds: g.options.map(o => o.key),
    count: [...g.codes].filter(c => base.has(c)).length,
  }));
});

/** 醫師勾選狀態：全部套組已勾／部分已勾／未勾 */
function doctorState(setIds: number[]): "all" | "some" | "none" {
  const n = setIds.filter(id => activeSets.value.has(id)).length;
  return n === 0 ? "none" : n === setIds.length ? "all" : "some";
}

/** 勾醫師＝勾他所有套組；已全勾時再按一次則全部取消 */
function toggleDoctor(setIds: number[]) {
  const next = new Set(activeSets.value);
  if (doctorState(setIds) === "all") setIds.forEach(id => next.delete(id));
  else setIds.forEach(id => next.add(id));
  activeSets.value = next;
}

// ── 區塊內搜尋（術式、套組選項多時）────────────────────────────
const surgeryQuery = ref("");
const setQuery     = ref("");
const visibleSurgeryOptions = computed(() => {
  const q = surgeryQuery.value.trim().toLowerCase();
  if (!q) return surgeryOptions.value;
  return surgeryOptions.value.filter(o =>
    o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q) || activeSurgeries.value.has(o.key));
});
const visibleSetGroups = computed(() => {
  const q = setQuery.value.trim().toLowerCase();
  if (!q) return setGroups.value;
  return setGroups.value
    .map(g => ({
      ...g,
      options: g.doctor.toLowerCase().includes(q)
        ? g.options
        : g.options.filter(o => o.label.toLowerCase().includes(q) || activeSets.value.has(o.key)),
    }))
    .filter(g => g.options.length);
});

// ── 勾選 ─────────────────────────────────────────────────────────
const TARGETS: Record<Dim, Ref<Set<string>> | Ref<Set<number>>> = {
  dept: activeDepts, purpose: activePurposes, surgery: activeSurgeries, set: activeSets,
};

function toggle(dim: Dim, key: string | number) {
  const target = TARGETS[dim] as Ref<Set<string | number>>;
  const next = new Set(target.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  target.value = next;
}

function resetAllFilters() {
  activeDepts.value     = new Set();
  activePurposes.value  = new Set();
  activeSurgeries.value = new Set();
  activeSets.value      = new Set();
}

const activeChips = computed(() => {
  const chips: { dim: Dim; key: string | number; label: string; type: string; setIds?: number[] }[] = [];
  for (const d of activeDepts.value) chips.push({ dim: "dept", key: d, label: d, type: "科別" });
  for (const p of activePurposes.value) chips.push({ dim: "purpose", key: p, label: p, type: "用途" });
  for (const id of activeSurgeries.value) {
    const st = surgeryTypes.value.find(s => s.id === id);
    if (st) chips.push({ dim: "surgery", key: id, label: st.name, type: "術式" });
  }
  // 醫師的套組全勾時合併成一個標籤，避免套組多時擠滿整列
  for (const g of setGroups.value) {
    const state = doctorState(g.setIds);
    if (state === "all" && g.setIds.length > 1) {
      chips.push({ dim: "set", key: `doctor:${g.doctor}`, label: `${g.doctor}（全部套組）`, type: "套組", setIds: g.setIds });
      continue;
    }
    if (state === "none") continue;
    for (const o of g.options)
      if (activeSets.value.has(o.key)) chips.push({ dim: "set", key: o.key, label: `${g.doctor}・${o.label}`, type: "套組" });
  }
  return chips;
});

function removeChip(c: { dim: Dim; key: string | number; setIds?: number[] }) {
  if (c.setIds) toggleDoctor(c.setIds);
  else toggle(c.dim, c.key);
}

function clearAll() {
  searchRaw.value = "";
  resetAllFilters();
}

// ── 篩選欄：收合狀態（記在本機）────────────────────────────────
const PANEL_KEY = "items-filter-panel";
const panelOpen = ref(true);
const sectionOpen = ref<Record<Dim, boolean>>({ dept: true, purpose: true, surgery: false, set: false });
try {
  const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "null");
  if (saved) {
    panelOpen.value = saved.panelOpen ?? true;
    sectionOpen.value = { ...sectionOpen.value, ...(saved.sectionOpen ?? {}) };
  }
} catch { /* 無法讀取時用預設 */ }
watch([panelOpen, sectionOpen], () => {
  try { localStorage.setItem(PANEL_KEY, JSON.stringify({ panelOpen: panelOpen.value, sectionOpen: sectionOpen.value })); } catch { /* 忽略 */ }
}, { deep: true });

// ── 雲端同步 ─────────────────────────────────────────────────────
const syncToast = ref("");
let syncToastTimer: ReturnType<typeof setTimeout> | null = null;
function showSyncToast(msg: string) {
  syncToast.value = msg;
  if (syncToastTimer) clearTimeout(syncToastTimer);
  syncToastTimer = setTimeout(() => { syncToast.value = ""; }, 3000);
}
onTableSynced("items", loadItems);
onTableSynced("sets", loadSets);
onTableSynced("surgeryTypes", loadSurgeryTypes);

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
  await touchTable("surgeryTypes");
}

async function mgmtDeleteSurgery(id: number) {
  const db = await getDb();
  await markDeletedById("surgeryTypes", id);
  await db.execute("DELETE FROM surgery_type_items WHERE surgery_type_id=?", [id]);
  await db.execute("DELETE FROM surgery_types WHERE id=?", [id]);
  if (mgmtSelId.value === id) { mgmtSelId.value = null; mgmtSelCodes.value = new Set(); }
  const s = new Set(activeSurgeries.value); s.delete(id); activeSurgeries.value = s;
  await loadSurgeryTypes();
  await touchTable("surgeryTypes");
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
  await touchTable("surgeryTypes");
}

// ── 手術術式 雲端同步 ─────────────────────────────────────────────
const surgSyncToast  = ref("");
let surgSyncTimer: ReturnType<typeof setTimeout> | null = null;
function showSurgToast(msg: string) {
  surgSyncToast.value = msg;
  if (surgSyncTimer) clearTimeout(surgSyncTimer);
  surgSyncTimer = setTimeout(() => { surgSyncToast.value = ""; }, 3000);
}
</script>

<template>
  <div class="accent-violet flex h-full gap-3 text-fg bg-sunken">

    <!-- ── 左側篩選欄 ──────────────────────────────────────── -->
    <aside v-if="panelOpen"
      class="w-60 shrink-0 flex flex-col bg-surface border border-hairline rounded-2xl overflow-hidden">
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-hairline shrink-0">
        <span class="text-xs font-bold text-fg-secondary">篩選</span>
        <div class="flex items-center gap-2">
          <button v-if="activeChips.length" @click="resetAllFilters"
            class="text-xs text-muted hover:text-accent cursor-pointer">清除</button>
          <button @click="panelOpen = false" title="收起篩選欄"
            class="text-muted hover:text-fg text-sm leading-none cursor-pointer">⟨</button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar py-1">
        <!-- 科別 -->
        <section class="border-b border-hairline">
          <button @click="sectionOpen.dept = !sectionOpen.dept" class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-fg-secondary hover:text-fg cursor-pointer">
            <span class="w-3 text-muted">{{ sectionOpen.dept ? '▾' : '▸' }}</span>
            科別
            <span v-if="activeDepts.size" class="rounded-full bg-accent/15 text-accent px-1.5 text-2xs tabular-nums">{{ activeDepts.size }}</span>
          </button>
          <div v-if="sectionOpen.dept" class="pb-2">
            <label v-for="o in deptOptions" :key="o.key" class="flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-overlay/5"
              :class="o.count === 0 && !activeDepts.has(o.key) ? 'opacity-40' : ''">
              <input type="checkbox" class="accent-[var(--color-accent)]" :checked="activeDepts.has(o.key)" @change="toggle('dept', o.key)" />
              <span class="flex-1 min-w-0" :class="activeDepts.has(o.key) ? 'text-accent font-bold' : 'text-fg'">{{ o.label }}</span>
              <span class="text-2xs tabular-nums text-muted">{{ o.count }}</span>
            </label>
          </div>
        </section>

        <!-- 用途 -->
        <section class="border-b border-hairline">
          <button @click="sectionOpen.purpose = !sectionOpen.purpose" class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-fg-secondary hover:text-fg cursor-pointer">
            <span class="w-3 text-muted">{{ sectionOpen.purpose ? '▾' : '▸' }}</span>
            用途
            <span v-if="activePurposes.size" class="rounded-full bg-accent/15 text-accent px-1.5 text-2xs tabular-nums">{{ activePurposes.size }}</span>
          </button>
          <div v-if="sectionOpen.purpose" class="pb-2">
            <label v-for="o in purposeOptions" :key="o.key" class="flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-overlay/5"
              :class="o.count === 0 && !activePurposes.has(o.key) ? 'opacity-40' : ''">
              <input type="checkbox" class="accent-[var(--color-accent)]" :checked="activePurposes.has(o.key)" @change="toggle('purpose', o.key)" />
              <span class="flex-1 min-w-0" :class="activePurposes.has(o.key) ? 'text-accent font-bold' : 'text-fg'">{{ o.label }}</span>
              <span class="text-2xs tabular-nums text-muted">{{ o.count }}</span>
            </label>
          </div>
        </section>

        <!-- 手術術式 -->
        <section class="border-b border-hairline">
          <div class="flex items-center">
            <button @click="sectionOpen.surgery = !sectionOpen.surgery" class="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-fg-secondary hover:text-fg cursor-pointer flex-1">
              <span class="w-3 text-muted">{{ sectionOpen.surgery ? '▾' : '▸' }}</span>
              手術術式
              <span class="text-2xs text-muted font-normal">{{ surgeryTypes.length }}</span>
              <span v-if="activeSurgeries.size" class="rounded-full bg-accent/15 text-accent px-1.5 text-2xs tabular-nums">{{ activeSurgeries.size }}</span>
            </button>
            <button @click="showSurgeryMgmt = true" title="管理手術術式"
              class="px-3 text-xs text-muted hover:text-accent cursor-pointer">⚙</button>
          </div>
          <div v-if="sectionOpen.surgery" class="pb-2">
            <input v-if="surgeryOptions.length > 8" v-model="surgeryQuery" placeholder="篩選術式…" class="mx-3 mb-1 w-[calc(100%-1.5rem)] px-2 py-1 rounded-lg bg-sunken border border-hairline text-xs text-fg outline-none focus:border-accent/50" />
            <p v-if="!surgeryOptions.length" class="px-3 py-1 text-xs text-muted">尚無術式，按 ⚙ 新增</p>
            <label v-for="o in visibleSurgeryOptions" :key="o.key" class="flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-overlay/5"
              :class="o.count === 0 && !activeSurgeries.has(o.key) ? 'opacity-40' : ''">
              <input type="checkbox" class="accent-[var(--color-accent)]" :checked="activeSurgeries.has(o.key)" @change="toggle('surgery', o.key)" />
              <span class="flex-1 min-w-0" :class="activeSurgeries.has(o.key) ? 'text-accent font-bold' : 'text-fg'">
                {{ o.label }}<span v-if="o.sub" class="ml-1 text-2xs text-muted font-normal">{{ o.sub }}</span>
              </span>
              <span class="text-2xs tabular-nums text-muted">{{ o.count }}</span>
            </label>
          </div>
        </section>

        <!-- 醫師套組 -->
        <section>
          <button @click="sectionOpen.set = !sectionOpen.set" class="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-fg-secondary hover:text-fg cursor-pointer">
            <span class="w-3 text-muted">{{ sectionOpen.set ? '▾' : '▸' }}</span>
            醫師套組
            <span class="text-2xs text-muted font-normal">{{ setEntries.length }}</span>
            <span v-if="activeSets.size" class="rounded-full bg-accent/15 text-accent px-1.5 text-2xs tabular-nums">{{ activeSets.size }}</span>
          </button>
          <div v-if="sectionOpen.set" class="pb-2">
            <input v-if="setEntries.length > 8" v-model="setQuery" placeholder="篩選醫師或套組…" class="mx-3 mb-1 w-[calc(100%-1.5rem)] px-2 py-1 rounded-lg bg-sunken border border-hairline text-xs text-fg outline-none focus:border-accent/50" />
            <p v-if="!setEntries.length" class="px-3 py-1 text-xs text-muted">尚無套組</p>
            <div v-for="g in visibleSetGroups" :key="g.doctor">
              <label class="flex items-center gap-2 px-3 pt-1.5 pb-0.5 text-xs cursor-pointer hover:bg-overlay/5"
                :class="g.count === 0 && doctorState(g.setIds) === 'none' ? 'opacity-40' : ''"
                :title="`勾選 ${g.doctor} 的全部套組`">
                <input type="checkbox" class="accent-[var(--color-accent)]"
                  :checked="doctorState(g.setIds) === 'all'"
                  :indeterminate="doctorState(g.setIds) === 'some'"
                  @change="toggleDoctor(g.setIds)" />
                <span class="flex-1 min-w-0 text-sm font-bold" :class="doctorState(g.setIds) === 'none' ? 'text-fg' : 'text-accent'">{{ g.doctor }}</span>
                <span class="text-2xs tabular-nums text-muted">{{ g.count }}</span>
              </label>
              <label v-for="o in g.options" :key="o.key" class="flex items-center gap-2 pl-5 pr-3 py-1 text-xs cursor-pointer hover:bg-overlay/5"
                :class="o.count === 0 && !activeSets.has(o.key) ? 'opacity-40' : ''">
                <input type="checkbox" class="accent-[var(--color-accent)]" :checked="activeSets.has(o.key)" @change="toggle('set', o.key)" />
                <span class="flex-1 min-w-0" :class="activeSets.has(o.key) ? 'text-accent font-bold' : 'text-fg'">{{ o.label }}</span>
                <span class="text-2xs tabular-nums text-muted">{{ o.count }}</span>
              </label>
            </div>
          </div>
        </section>
      </div>
    </aside>

    <!-- ── 右側：搜尋與結果 ────────────────────────────────── -->
    <div class="flex-1 min-w-0 flex flex-col gap-3">
      <div class="shrink-0 flex flex-col gap-2 bg-surface border border-hairline rounded-2xl px-4 py-3">
        <div class="flex items-center gap-3 flex-wrap">
          <button v-if="!panelOpen" @click="panelOpen = true"
            class="shrink-0 px-2.5 py-1.5 rounded-xl bg-sunken border border-hairline text-xs font-bold text-fg-secondary hover:text-fg cursor-pointer">
            ⟩ 篩選<span v-if="activeChips.length" class="ml-1 text-accent">{{ activeChips.length }}</span>
          </button>
          <div class="relative flex-1 min-w-[12rem]">
            <span class="absolute left-3 top-2 text-muted text-sm">🔍</span>
            <input v-model="searchRaw" @keydown.esc="searchRaw = ''"
              placeholder="搜尋品名、院內碼、用途、科別、廠商、醫師、套組…（空白分隔多個關鍵字）"
              class="w-full pl-9 pr-8 py-2 rounded-xl bg-sunken border border-hairline text-fg text-sm placeholder-muted outline-none focus:border-accent/50" />
            <button v-if="searchRaw" @click="searchRaw = ''"
              class="absolute right-2.5 top-1.5 text-muted hover:text-fg-secondary text-lg leading-none cursor-pointer" title="清除">×</button>
          </div>
          <span class="shrink-0 text-xs text-muted tabular-nums">{{ filtered.length }} / {{ items.length }} 筆</span>
          <CloudSyncButtons table="items" class="shrink-0" @synced="loadItems" @message="showSyncToast" />
        </div>

        <div v-if="activeChips.length" class="flex flex-wrap items-center gap-1.5">
          <span v-for="c in activeChips" :key="`${c.dim}-${c.key}`"
            class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs bg-accent/10 text-accent">
            <span class="text-2xs opacity-70">{{ c.type }}</span>
            {{ c.label }}
            <button @click="removeChip(c)" class="px-1 opacity-60 hover:opacity-100 cursor-pointer" :title="`移除 ${c.label}`">×</button>
          </span>
          <button @click="resetAllFilters" class="text-xs text-muted hover:text-accent cursor-pointer ml-1">清除全部</button>
        </div>
      </div>

      <!-- 結果清單 -->
      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-surface border border-hairline rounded-2xl">
        <p v-if="errMsg" class="py-16 text-center text-danger text-sm font-bold">{{ errMsg }}</p>
        <p v-else-if="loading" class="py-16 text-center text-muted text-sm">載入中…</p>
        <div v-else-if="!filtered.length" class="py-16 text-center text-sm text-muted space-y-2">
          <p>找不到符合條件的品項</p>
          <button v-if="searchRaw || activeChips.length" @click="clearAll"
            class="text-xs text-accent hover:underline cursor-pointer">清除搜尋與篩選</button>
        </div>

        <template v-else>
          <section v-for="sec in sections" :key="sec.key">
          <!-- 套組標題字級＝品項名稱（text-sm）的 1.5 倍 -->
          <h3 v-if="sec.title"
            class="sticky top-0 z-10 flex items-baseline gap-2 px-4 py-2 border-b border-hairline bg-sunken text-[calc(var(--text-sm)*1.5)] font-bold text-fg">
            {{ sec.title }}
            <span class="text-xs font-normal text-muted tabular-nums">{{ sec.items.length }} 筆</span>
          </h3>
          <div v-for="m in sec.items" :key="m.hospital_code"
            class="px-4 py-2.5 border-b border-hairline hover:bg-overlay/5 transition-colors">
            <div class="flex items-baseline gap-3">
              <button @click="copyCode(m.hospital_code)" :title="`複製 ${m.hospital_code}`"
                class="shrink-0 font-mono text-xs font-bold cursor-pointer transition-colors"
                :class="copiedCode === m.hospital_code ? 'text-success' : 'text-accent hover:underline'">
                {{ copiedCode === m.hospital_code ? '✓ 已複製' : m.hospital_code }}
              </button>
              <span class="flex-1 min-w-0 text-sm font-bold text-fg">{{ m.name_zh || m.name_en || '—' }}</span>
              <span class="shrink-0 font-mono text-sm font-bold text-success tabular-nums">
                {{ m.price != null ? `$${m.price.toLocaleString()}` : '—' }}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-secondary">
              <span v-if="m.name_zh && m.name_en">{{ m.name_en }}</span>
              <span v-if="m.purpose" class="rounded-full bg-accent/10 text-accent px-2 py-px text-2xs font-bold">{{ m.purpose }}</span>
              <span v-for="d in m.depts" :key="d" class="rounded-full bg-sunken border border-hairline px-2 py-px text-2xs">{{ d }}</span>
              <span v-if="m.unit" class="text-muted">單位 {{ m.unit }}</span>
              <span v-if="m.supplier" class="text-muted">{{ m.supplier }}</span>
              <span v-if="m.notes" class="text-muted">{{ m.notes }}</span>
            </div>
          </div>
          </section>
        </template>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="syncToast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-surface/90 border border-hairline text-fg text-xs font-bold rounded-2xl shadow-2xl z-50 pointer-events-none backdrop-blur-md">
        {{ syncToast }}
      </div>
    </Transition>
  </div>

  <!-- ── 手術術式管理 Modal ──────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="showSurgeryMgmt"
      class="fixed inset-0 z-[9000] flex items-center justify-center bg-sunken/60 backdrop-blur-sm"
      @click.self="showSurgeryMgmt = false">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-[820px] max-w-[95vw] h-[640px] max-h-[90vh] flex flex-col overflow-hidden text-fg">

        <!-- Modal Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0 bg-sunken">
          <div class="flex items-center gap-3">
            <h3 class="text-xs font-black text-fg">管理手術術式</h3>
            <div class="flex items-center gap-1.5">
              <CloudSyncButtons table="surgeryTypes" @synced="loadSurgeryTypes" @message="showSurgToast" />
              <span v-if="surgSyncToast" class="text-2xs text-muted font-bold font-mono ml-2">{{ surgSyncToast }}</span>
            </div>
          </div>
          <button @click="showSurgeryMgmt = false" class="text-muted hover:text-fg text-xl leading-none transition-colors cursor-pointer shrink-0">×</button>
        </div>

        <!-- Modal Body -->
        <div class="flex flex-1 min-h-0 bg-sunken">

          <!-- 左欄：術式清單 -->
          <div class="w-64 border-r border-hairline flex flex-col shrink-0">
            <div class="p-3 border-b border-hairline shrink-0 bg-sunken">
              <button @click="mgmtStartAdd"
                class="w-full text-xs px-3 py-2 rounded-xl bg-accent hover:bg-accent border border-accent/30 text-white transition-all font-bold cursor-pointer">
                ＋ 新增術式
              </button>
            </div>

            <!-- 新增 / 編輯表單 -->
            <Transition name="slide-down">
              <div v-if="mgmtShowForm" class="p-4 space-y-2 border-b border-hairline bg-surface shrink-0">
                <input v-model="mgmtFormName" placeholder="術式名稱 *" maxlength="40"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-sunken border border-hairline text-fg focus:outline-none focus:border-accent/50 placeholder-muted font-bold" />
                <input v-model="mgmtFormDept" placeholder="科別（選填）" maxlength="20"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-sunken border border-hairline text-fg focus:outline-none focus:border-accent/50 placeholder-muted font-bold" />
                <div class="flex gap-2">
                  <button @click="mgmtSaveForm" :disabled="!mgmtFormName.trim()"
                    class="flex-1 text-xs py-1.5 rounded-lg bg-accent border border-accent/30 hover:bg-accent disabled:opacity-40 text-white font-bold cursor-pointer">
                    {{ mgmtEditId === null ? "新增" : "儲存" }}
                  </button>
                  <button @click="mgmtShowForm = false"
                    class="text-xs px-3 py-1.5 rounded-lg bg-elevated text-fg-secondary hover:text-fg cursor-pointer">
                    取消
                  </button>
                </div>
              </div>
            </Transition>

            <!-- 術式列表 -->
            <div class="flex-1 overflow-y-auto custom-scrollbar">
              <div v-if="surgeryTypes.length === 0" class="text-center text-muted text-xs py-10 italic">
                尚無術式，點上方新增
              </div>
              <button
                v-for="st in surgeryTypes" :key="st.id"
                @click="mgmtSelectSurgery(st.id)"
                class="w-full text-left px-4 py-3.5 border-b border-hairline flex items-start justify-between gap-1 transition-all group cursor-pointer"
                :class="mgmtSelId === st.id
                  ? 'bg-accent/10 border-l-2 border-accent/30 pl-3.5'
                  : 'hover:bg-surface/40'"
              >
                <div class="min-w-0 flex-1">
                  <div class="text-xs text-fg font-bold truncate">{{ st.name }}</div>
                  <div v-if="st.dept" class="text-2xs font-mono text-accent font-bold mt-1">{{ st.dept }}</div>
                </div>
                <div class="flex items-center gap-1 shrink-0 mt-0.5">
                  <span class="text-2xs font-mono text-muted bg-sunken px-1.5 py-0.5 rounded font-bold">
                    {{ surgeryTypeItemMap.get(st.id)?.size ?? 0 }}
                  </span>
                  <button @click.stop="mgmtStartEdit(st)"
                    class="text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity px-1 text-[0.6875rem] cursor-pointer">
                    ✎
                  </button>
                  <button @click.stop="mgmtDeleteSurgery(st.id)"
                    class="text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity px-1 text-[0.6875rem] cursor-pointer">
                    ✕
                  </button>
                </div>
              </button>
            </div>
          </div>

          <!-- 右欄：品項關聯 -->
          <div class="flex-1 flex flex-col min-w-0">
            <div v-if="!mgmtSelId" class="flex-1 flex items-center justify-center text-muted text-xs italic py-12">
              選擇左側術式以管理關聯品項
            </div>
            <template v-else>
              <!-- 右欄 Header -->
              <div class="px-5 py-3.5 border-b border-hairline flex items-center gap-3 shrink-0 flex-wrap bg-sunken">
                <span class="text-xs text-fg font-black tracking-wider truncate">{{ mgmtSelected?.name }}</span>
                <span v-if="mgmtSelected?.dept" class="text-2xs font-mono bg-accent/10 border border-accent/30 text-accent px-2 py-0.5 rounded-full font-bold">{{ mgmtSelected.dept }}</span>
                <span class="text-2xs font-bold text-muted bg-sunken px-2 py-0.5 rounded border border-hairline">已關聯 {{ mgmtSelCodes.size }} 品項</span>
                
                <label class="ml-auto flex items-center gap-1.5 text-xs text-fg-secondary cursor-pointer select-none font-bold">
                  <input type="checkbox" v-model="mgmtOnlyLinked" class="accent-accent w-3.5 h-3.5 rounded" />
                  只顯示已關聯
                </label>
              </div>
              
              <!-- 搜尋 -->
              <div class="px-5 py-2.5 border-b border-hairline shrink-0 bg-sunken">
                <input v-model="mgmtItemSearch" placeholder="搜尋品名 / 院內碼 / 用途…"
                  class="w-full px-3 py-2 text-xs rounded-xl bg-sunken border border-hairline text-fg focus:outline-none focus:border-accent/50 placeholder-muted font-bold" />
              </div>
              
              <!-- 品項清單 -->
              <div class="flex-1 overflow-y-auto custom-scrollbar">
                <div v-if="mgmtFilteredItems.length === 0" class="text-center text-muted text-xs py-12 italic">
                  {{ mgmtItemSearch ? "找不到符合的品項" : (mgmtOnlyLinked ? "尚無關聯品項" : "無品項資料") }}
                </div>
                <div
                  v-for="m in mgmtFilteredItems" :key="m.hospital_code"
                  class="flex items-center gap-3 px-5 py-3 border-b border-hairline hover:bg-surface/40 cursor-pointer transition-colors select-none group"
                  @click="mgmtToggleItem(m.hospital_code)"
                >
                  <div class="shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors"
                    :class="mgmtSelCodes.has(m.hospital_code)
                      ? 'bg-accent border-accent/30 shadow-[0_0_8px_rgba(139,92,246,0.3)]'
                      : 'border-hairline bg-sunken'">
                    <span v-if="mgmtSelCodes.has(m.hospital_code)" class="text-fg text-2xs leading-none font-bold">✓</span>
                  </div>
                  <span class="text-xs font-mono text-fg-secondary shrink-0 w-24 group-hover:text-accent transition-colors">{{ m.hospital_code }}</span>
                  <span class="text-xs text-fg font-bold flex-1 truncate">{{ m.name_zh || m.name_en || "—" }}</span>
                  <span v-if="m.purpose" class="text-2xs font-bold bg-accent/10 border border-accent/20 text-accent px-2 py-0.5 rounded-full shrink-0 truncate max-w-[90px]">{{ m.purpose }}</span>
                  <span v-if="m.depts.length" class="text-2xs font-bold bg-accent/10 border border-accent/20 text-accent px-2 py-0.5 rounded-full shrink-0">{{ m.depts[0] }}</span>
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

/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
