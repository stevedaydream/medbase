/**
 * 數值判讀卡：數值 → 級距比對與編輯檢查（ADR-017）。純函式，桌機與手機共用。
 */
import type { EmSpec, EmTier, EmCard } from "./types";
import { FORMULAS, type Formula } from "../handbook/formulas";

/** 比對用的數值：main＝卡片的主要數值；公式可另外提供其他數值（例如血壓卡的 sbp） */
export type MeasureValues = Record<string, number>;

/** 由公式計算數值的卡片（例如 SBP／DBP → MAP）用的公式 */
export function measureFormula(spec: EmSpec): Formula | null {
  const id = spec.measure?.formula;
  return id ? FORMULAS.find(f => f.id === id) ?? null : null;
}

/** 使用者輸入 → 比對用的數值；inputs 為公式各欄位（沒有公式時用 key "value"）；沒有主要數值時回傳 null */
export function measureValues(spec: EmSpec, inputs: Record<string, string>): MeasureValues | null {
  const f = measureFormula(spec);
  if (!f) {
    const t = (inputs.value ?? "").trim();
    return t === "" || !Number.isFinite(Number(t)) ? null : { main: Number(t) };
  }
  const nums = Object.fromEntries(Object.entries(inputs).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]));
  const r = f.compute(nums);
  return r ? { ...(r.extra ?? {}), main: r.value } : null;
}

/** 只取主要數值 */
export function measureValue(spec: EmSpec, inputs: Record<string, string>): number | null {
  return measureValues(spec, inputs)?.main ?? null;
}

export interface MatchResult {
  /** 符合數值與條件的級距 */
  matched: EmTier[];
  /** 數值落在範圍內、但要先回答這些是非題才知道適不適用 */
  needAnswers: string[];
  /** 同一組條件下，符合級距的上一級與下一級（參考） */
  neighbors: { below: EmTier | null; above: EmTier | null };
  /** 數值沒有對到任何級距 */
  uncovered: boolean;
}

const within = (v: number | undefined, min: number | null, max: number | null) =>
  v !== undefined && Number.isFinite(v) && (min === null || v >= min) && (max === null || v <= max);
/** 數值是否落在級距範圍（不看是非題） */
const inTier = (t: EmTier, vals: MeasureValues) =>
  within(vals[t.on ?? "main"], t.min, t.max) && (t.and ?? []).every(a => within(vals[a.on], a.min, a.max));
/** 級距分組：同一組條件、同一個比對數值 */
const sig = (t: EmTier) => JSON.stringify([t.on ?? "main", t.and ?? [], Object.entries(t.when).sort(([a], [b]) => a.localeCompare(b))]);
const lo = (t: EmTier) => t.min ?? -Infinity;
const asValues = (v: MeasureValues | number | null): MeasureValues | null =>
  v === null ? null : typeof v === "number" ? (Number.isFinite(v) ? { main: v } : null) : v;

export function matchTiers(spec: EmSpec, value: MeasureValues | number | null, answers: Record<string, boolean | undefined>): MatchResult {
  const out: MatchResult = { matched: [], needAnswers: [], neighbors: { below: null, above: null }, uncovered: false };
  const vals = asValues(value);
  if (spec.kind !== "graded" || !vals) return out;
  const need = new Set<string>();
  for (const t of spec.tiers) {
    if (!inTier(t, vals)) continue;
    const unknown = Object.keys(t.when).filter(k => answers[k] === undefined);
    if (unknown.length) { unknown.forEach(k => need.add(k)); continue; }
    if (Object.entries(t.when).every(([k, want]) => answers[k] === want)) out.matched.push(t);
  }
  out.needAnswers = spec.conditions.map(c => c.id).filter(id => need.has(id));
  out.uncovered = !out.matched.length && !out.needAnswers.length;
  const first = out.matched[0];
  if (first) {
    const same = spec.tiers.filter(t => sig(t) === sig(first)).sort((a, b) => lo(a) - lo(b));
    const i = same.indexOf(first);
    out.neighbors = { below: same[i - 1] ?? null, above: same[i + 1] ?? null };
  }
  return out;
}

/** 目前數值下才需要回答的是非題（沒有數值時為空） */
export function relevantConditions(spec: EmSpec, value: MeasureValues | number | null): string[] {
  const vals = asValues(value);
  if (!vals) return [];
  const ids = new Set(spec.tiers.filter(t => inTier(t, vals)).flatMap(t => Object.keys(t.when)));
  return spec.conditions.map(c => c.id).filter(id => ids.has(id));
}

/** 一張卡要顯示的文字（搜尋用） */
export function searchText(c: EmCard): string {
  return [c.name, c.spec.category, ...c.spec.keywords, c.spec.measure?.label ?? ""].join(" ").toLowerCase();
}

export function searchCards(cards: EmCard[], q: string): EmCard[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return cards;
  return cards.filter(c => { const t = searchText(c); return words.every(w => t.includes(w)); });
}

/** 使用畫面只顯示文獻版與院內審核版 */
export const visibleCards = (cards: EmCard[]) => cards.filter(c => c.spec.status !== "draft");

export interface CheckIssue { level: "error" | "warn"; message: string }

/** 編輯檢查：error 不可儲存為非草稿；warn 只提示 */
export function checkSpec(name: string, spec: EmSpec): CheckIssue[] {
  const out: CheckIssue[] = [];
  const err = (m: string) => out.push({ level: "error", message: m });
  const warn = (m: string) => out.push({ level: "warn", message: m });
  if (!name.trim()) err("請填名稱");
  if (spec.kind === "graded") {
    if (!spec.measure?.label || !spec.measure.unit) err("分級卡要填數值名稱與單位");
    if (!spec.tiers.length) err("分級卡至少要有一個級距");
    const step = spec.measure?.step && spec.measure.step > 0 ? spec.measure.step : 1;
    const conds = new Set(spec.conditions.map(c => c.id));
    const groups = new Map<string, EmTier[]>();
    for (const t of spec.tiers) {
      const label = t.title || "（未命名級距）";
      if (t.min !== null && t.max !== null && t.min > t.max) err(`「${label}」下限大於上限`);
      if (t.level !== "normal" && !t.actions.length && !t.meds.length) warn(`「${label}」沒有處置或藥物`);
      for (const k of Object.keys(t.when)) if (!conds.has(k)) err(`「${label}」用到已刪除的是非題`);
      const g = groups.get(sig(t)) ?? [];
      g.push(t);
      groups.set(sig(t), g);
    }
    for (const g of groups.values()) {
      const s = [...g].sort((a, b) => lo(a) - lo(b));
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1], b = s[i];
        const aMax = a.max ?? Infinity, bMin = b.min ?? -Infinity;
        if (bMin <= aMax) err(`「${a.title}」與「${b.title}」的範圍重疊`);
        else if (bMin - aMax > step + 1e-9) warn(`「${a.title}」與「${b.title}」之間有空白（${fmt(aMax)}～${fmt(bMin)}）`);
      }
    }
  } else if (!spec.general.actions.length && !spec.general.meds.length) {
    err("一般卡至少要有一項處置或藥物");
  }
  if (spec.status === "literature" && !spec.refs.length) err("文獻版要附參考文獻");
  if (spec.status === "published") {
    if (!spec.source.trim()) err("院內審核版要填依據（院內規範名稱與版本）");
    if (!spec.reviewer.trim()) err("院內審核版要填審核人");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.effective)) err("院內審核版要填生效日");
  }
  return out;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 級距依據的參考文獻（未指定時用整張卡的全部文獻） */
export function tierRefs(spec: EmSpec, t: EmTier): EmSpec["refs"] {
  const idx = t.refs?.length ? t.refs : spec.refs.map((_, i) => i);
  return idx.map(i => spec.refs[i]).filter(Boolean);
}

/** 級距範圍的顯示文字 */
export function rangeText(t: { min: number | null; max: number | null }, unit = ""): string {
  const u = unit ? ` ${unit}` : "";
  if (t.min === null && t.max === null) return "不限";
  if (t.min === null) return `≤ ${fmt(t.max!)}${u}`;
  if (t.max === null) return `≥ ${fmt(t.min)}${u}`;
  return `${fmt(t.min)}–${fmt(t.max)}${u}`;
}

/** 級距範圍（比對的不是主要數值時加上名稱，例如「收縮壓 ≥ 180 mmHg」） */
export function tierRangeText(spec: EmSpec, t: EmTier): string {
  const f = measureFormula(spec);
  const named = !!t.on || !!t.and?.length;
  const meta = (key: string) => key === "main"
    ? { label: spec.measure?.label ?? "", unit: spec.measure?.unit ?? "" }
    : f?.extraLabels?.[key] ?? (() => { const i = f?.inputs.find(x => x.key === key); return { label: i?.label ?? key, unit: i?.unit ?? "" }; })();
  const parts = [{ on: t.on ?? "main", min: t.min, max: t.max }, ...(t.and ?? [])]
    .filter(p => p.min !== null || p.max !== null)
    .map(p => { const m = meta(p.on); return `${named ? m.label + " " : ""}${rangeText(p, m.unit)}`; });
  return parts.join("、") || "不限";
}
