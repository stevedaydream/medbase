/**
 * 自費品項的搜尋與篩選邏輯，桌機 ItemsView 與手機共用（ADR-013）。
 * - 搜尋：空白分隔的多個關鍵字須全部符合；比對品名、院內碼、用途、科別、廠商、單位、備註與所屬套組／醫師
 * - 篩選：科別／用途／手術術式／醫師套組；同區塊「或」、區塊間「且」
 * - 筆數：以「其他區塊條件＋搜尋」計算（facet）
 */

export interface ItemRec {
  hospital_code: string;
  name_zh: string | null;
  name_en: string | null;
  purpose: string | null;
  unit: string | null;
  price: number | null;
  supplier: string | null;
  notes: string | null;
  depts: string[];
}
export type Key = string | number;
export interface SetRec { setId: Key; setName: string; doctorName: string; codes: Set<string> }
export interface SurgeryTypeRec { id: Key; name: string; dept: string | null }

export type Dim = "dept" | "purpose" | "surgery" | "set";
export interface Filters { dept: Set<string>; purpose: Set<string>; surgery: Set<Key>; set: Set<Key> }
export interface Option<K> { key: K; label: string; sub?: string; count: number }

export const PURPOSE_LIST = [
  "止血劑", "Mesh人工網膜", "骨板", "骨釘", "骨水泥",
  "關節假體", "傷口敷料", "引流耗材", "縫合材料", "內視鏡耗材", "其他",
];
export const DEPT_LIST = ["骨科", "一般外科", "胸腔外科", "泌尿科", "乳房外科", "其他科"];
export const NO_DOCTOR = "未指定醫師";

export const purposeOf = (m: ItemRec) => m.purpose || "其他";

export function emptyFilters(): Filters {
  return { dept: new Set(), purpose: new Set(), surgery: new Set(), set: new Set() };
}

export function filterCount(f: Filters): number {
  return f.dept.size + f.purpose.size + f.surgery.size + f.set.size;
}

/** 每個品項的搜尋字串（含所屬套組名稱與醫師） */
export function buildHaystacks(items: ItemRec[], sets: SetRec[]): Map<string, string> {
  const setText = new Map<string, string[]>();
  for (const e of sets) for (const c of e.codes) {
    if (!setText.has(c)) setText.set(c, []);
    setText.get(c)!.push(e.setName, e.doctorName);
  }
  const map = new Map<string, string>();
  for (const m of items) {
    map.set(m.hospital_code, [
      m.hospital_code, m.name_zh, m.name_en, m.purpose, m.supplier, m.unit, m.notes,
      ...m.depts, ...(setText.get(m.hospital_code) ?? []),
    ].filter(Boolean).join(" ").toLowerCase());
  }
  return map;
}

export function searchItems(items: ItemRec[], haystacks: Map<string, string>, query: string): ItemRec[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items.filter(m => {
    const h = haystacks.get(m.hospital_code) ?? "";
    return terms.every(t => h.includes(t));
  });
}

export interface FilterContext {
  filters: Filters;
  surgeryItems: Map<Key, Set<string>>;
  sets: SetRec[];
}

function unionCodes(ids: Set<Key>, lookup: (id: Key) => Set<string> | undefined): Set<string> | null {
  if (!ids.size) return null;
  const out = new Set<string>();
  for (const id of ids) lookup(id)?.forEach(c => out.add(c));
  return out;
}

/** 建立比對函式：passes(item, skip) ＝ 除了 skip 區塊外其他條件都符合 */
export function makeMatcher(ctx: FilterContext) {
  const f = ctx.filters;
  const surgeryCodes = unionCodes(f.surgery, id => ctx.surgeryItems.get(id));
  const setById = new Map(ctx.sets.map(e => [e.setId, e]));
  const setCodes = unionCodes(f.set, id => setById.get(id)?.codes);
  return (m: ItemRec, skip?: Dim): boolean => {
    if (skip !== "dept" && f.dept.size && !m.depts.some(d => f.dept.has(d))) return false;
    if (skip !== "purpose" && f.purpose.size && !f.purpose.has(purposeOf(m))) return false;
    if (skip !== "surgery" && surgeryCodes && !surgeryCodes.has(m.hospital_code)) return false;
    if (skip !== "set" && setCodes && !setCodes.has(m.hospital_code)) return false;
    return true;
  };
}

function orderByPreset(keys: string[], preset: string[]) {
  return [...preset.filter(k => keys.includes(k)), ...keys.filter(k => !preset.includes(k)).sort((a, b) => a.localeCompare(b, "zh-TW"))];
}

/** 四個區塊的選項與筆數 */
export function facetOptions(all: ItemRec[], searched: ItemRec[], ctx: FilterContext, surgeryTypes: SurgeryTypeRec[]) {
  const passes = makeMatcher(ctx);
  const base = (dim: Dim) => searched.filter(m => passes(m, dim));

  const deptCounts = new Map<string, number>();
  for (const m of base("dept")) for (const d of m.depts) deptCounts.set(d, (deptCounts.get(d) ?? 0) + 1);
  const dept: Option<string>[] = orderByPreset([...new Set(all.flatMap(m => m.depts))], DEPT_LIST)
    .map(d => ({ key: d, label: d, count: deptCounts.get(d) ?? 0 }));

  const purposeCounts = new Map<string, number>();
  for (const m of base("purpose")) purposeCounts.set(purposeOf(m), (purposeCounts.get(purposeOf(m)) ?? 0) + 1);
  const purpose: Option<string>[] = orderByPreset([...new Set(all.map(purposeOf))], PURPOSE_LIST)
    .map(p => ({ key: p, label: p, count: purposeCounts.get(p) ?? 0 }));

  const surgeryBase = new Set(base("surgery").map(m => m.hospital_code));
  const surgery: Option<Key>[] = surgeryTypes.map(st => {
    const linked = ctx.surgeryItems.get(st.id) ?? new Set<string>();
    return { key: st.id, label: st.name, sub: st.dept ?? "", count: [...linked].filter(c => surgeryBase.has(c)).length };
  });

  const setBase = new Set(base("set").map(m => m.hospital_code));
  const groups = new Map<string, { options: Option<Key>[]; codes: Set<string> }>();
  for (const e of ctx.sets) {
    if (!groups.has(e.doctorName)) groups.set(e.doctorName, { options: [], codes: new Set() });
    const g = groups.get(e.doctorName)!;
    g.options.push({ key: e.setId, label: e.setName, count: [...e.codes].filter(c => setBase.has(c)).length });
    e.codes.forEach(c => g.codes.add(c));
  }
  // 醫師的筆數＝其所有套組品項的聯集（同一品項在多個套組只算一次）
  const setGroups = [...groups.entries()].map(([doctor, g]) => ({
    doctor, options: g.options, setIds: g.options.map(o => o.key),
    count: [...g.codes].filter(c => setBase.has(c)).length,
  }));

  return { dept, purpose, surgery, setGroups };
}

export type SetGroup = ReturnType<typeof facetOptions>["setGroups"][number];

/** 醫師勾選狀態：全部套組已勾／部分已勾／未勾 */
export function doctorState(selected: Set<Key>, setIds: Key[]): "all" | "some" | "none" {
  const n = setIds.filter(id => selected.has(id)).length;
  return n === 0 ? "none" : n === setIds.length ? "all" : "some";
}

/** 勾醫師＝勾他所有套組；已全勾時再按一次則全部取消。回傳新的 Set */
export function toggleDoctor(selected: Set<Key>, setIds: Key[]): Set<Key> {
  const next = new Set(selected);
  if (doctorState(selected, setIds) === "all") setIds.forEach(id => next.delete(id));
  else setIds.forEach(id => next.add(id));
  return next;
}

/** 結果分段：有勾套組時依「醫師・套組」分段（同一品項可出現在多段），否則單一清單 */
export function sectionize(filtered: ItemRec[], sets: SetRec[], selectedSets: Set<Key>) {
  if (!selectedSets.size) return [{ key: "all", title: null as string | null, items: filtered }];
  return sets
    .filter(e => selectedSets.has(e.setId))
    .map(e => ({ key: `set-${e.setId}`, title: `${e.doctorName}・${e.setName}` as string | null, items: filtered.filter(m => e.codes.has(m.hospital_code)) }))
    .filter(sec => sec.items.length);
}

/** 已選條件標籤；醫師的套組全勾時合併成一個 */
export function activeChips(f: Filters, surgeryTypes: SurgeryTypeRec[], groups: SetGroup[]) {
  const chips: { dim: Dim; key: Key; label: string; type: string; setIds?: Key[] }[] = [];
  for (const d of f.dept) chips.push({ dim: "dept", key: d, label: d, type: "科別" });
  for (const p of f.purpose) chips.push({ dim: "purpose", key: p, label: p, type: "用途" });
  for (const id of f.surgery) {
    const st = surgeryTypes.find(s => s.id === id);
    if (st) chips.push({ dim: "surgery", key: id, label: st.name, type: "術式" });
  }
  for (const g of groups) {
    const state = doctorState(f.set, g.setIds);
    if (state === "all" && g.setIds.length > 1) {
      chips.push({ dim: "set", key: `doctor:${g.doctor}`, label: `${g.doctor}（全部套組）`, type: "套組", setIds: g.setIds });
      continue;
    }
    if (state === "none") continue;
    for (const o of g.options) if (f.set.has(o.key)) chips.push({ dim: "set", key: o.key, label: `${g.doctor}・${o.label}`, type: "套組" });
  }
  return chips;
}

/** 子字串篩選清單（術式、套組選項多時的區塊內搜尋）；已勾選的一律保留 */
export function filterSurgeryOptions(options: Option<Key>[], q: string, selected: Set<Key>) {
  const s = q.trim().toLowerCase();
  if (!s) return options;
  return options.filter(o => o.label.toLowerCase().includes(s) || (o.sub ?? "").toLowerCase().includes(s) || selected.has(o.key));
}

export function filterSetGroups(groups: SetGroup[], q: string, selected: Set<Key>) {
  const s = q.trim().toLowerCase();
  if (!s) return groups;
  return groups
    .map(g => ({ ...g, options: g.doctor.toLowerCase().includes(s) ? g.options : g.options.filter(o => o.label.toLowerCase().includes(s) || selected.has(o.key)) }))
    .filter(g => g.options.length);
}
