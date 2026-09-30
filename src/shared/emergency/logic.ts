/**
 * 危急處置卡：數值 → 級距比對與編輯檢查（ADR-017）。純函式，桌機與手機共用。
 */
import type { EmSpec, EmTier, EmCard } from "./types";

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

const inRange = (t: EmTier, v: number) => (t.min === null || v >= t.min) && (t.max === null || v <= t.max);
const sig = (t: EmTier) => JSON.stringify(Object.entries(t.when).sort(([a], [b]) => a.localeCompare(b)));
const lo = (t: EmTier) => t.min ?? -Infinity;

export function matchTiers(spec: EmSpec, value: number | null, answers: Record<string, boolean | undefined>): MatchResult {
  const out: MatchResult = { matched: [], needAnswers: [], neighbors: { below: null, above: null }, uncovered: false };
  if (spec.kind !== "graded" || value === null || !Number.isFinite(value)) return out;
  const need = new Set<string>();
  for (const t of spec.tiers) {
    if (!inRange(t, value)) continue;
    const unknown = Object.keys(t.when).filter(k => answers[k] === undefined);
    if (unknown.length) { unknown.forEach(k => need.add(k)); continue; }
    if (Object.entries(t.when).every(([k, want]) => answers[k] === want)) out.matched.push(t);
  }
  out.needAnswers = spec.conditions.map(c => c.id).filter(id => need.has(id));
  out.uncovered = !out.matched.length && !out.needAnswers.length;
  // 參考：以第一個符合的級距所在的條件組，找相鄰級距
  const first = out.matched[0];
  if (first) {
    const same = spec.tiers.filter(t => sig(t) === sig(first)).sort((a, b) => lo(a) - lo(b));
    const i = same.indexOf(first);
    out.neighbors = { below: same[i - 1] ?? null, above: same[i + 1] ?? null };
  }
  return out;
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
      if (!t.actions.length && !t.meds.length) warn(`「${label}」沒有處置或藥物`);
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
export function rangeText(t: EmTier, unit = ""): string {
  const u = unit ? ` ${unit}` : "";
  if (t.min === null && t.max === null) return "不限";
  if (t.min === null) return `≤ ${fmt(t.max!)}${u}`;
  if (t.max === null) return `≥ ${fmt(t.min)}${u}`;
  return `${fmt(t.min)}–${fmt(t.max)}${u}`;
}
