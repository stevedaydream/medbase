/**
 * 換班對配額目標的調整，與跨月欠班帳（schedular.md §9）。
 */
import type { MonthDoc, QuotaItem, DebtRec } from "../types";
import { newId } from "../types";
import { dowOf } from "../calendar";

function inItem(it: QuotaItem, code: string, ym: string, day: number): number {
  if (!code || !it.countShifts.includes(code)) return 0;
  if (it.dow && !it.dow.includes(dowOf(ym, day))) return 0;
  return 1;
}

/** personId → 項目 → 目標調整量（換班後 a 拿到 b 的班、b 拿到 a 的班） */
export function swapAdjust(m: MonthDoc, items: QuotaItem[]): Record<string, Record<string, number>> {
  const adj: Record<string, Record<string, number>> = {};
  const add = (id: string, k: string, v: number) => {
    if (!v) return;
    adj[id] ??= {};
    adj[id][k] = (adj[id][k] ?? 0) + v;
  };
  for (const s of m.swaps ?? []) {
    for (const it of items) {
      const d = inItem(it, s.bCode, m.ym, s.day) - inItem(it, s.aCode, m.ym, s.day);
      add(s.a, it.id, d);
      add(s.b, it.id, -d);
    }
  }
  return adj;
}

/** 配額＋換班調整 */
export function targetsWithSwaps(
  quotas: Record<string, Record<string, number>>, m: MonthDoc, items: QuotaItem[],
): Record<string, Record<string, number>> {
  const adj = swapAdjust(m, items);
  const out: Record<string, Record<string, number>> = {};
  for (const [id, q] of Object.entries(quotas)) {
    out[id] = { ...q };
    for (const [k, v] of Object.entries(adj[id] ?? {})) out[id][k] = (out[id][k] ?? 0) + v;
  }
  return out;
}

/**
 * 發布時結算：本月每一對人員在各項目的淨差額，先抵銷既有的反向欠班，剩下的成為新欠班。
 * 甲的調整量為負（甲少上、乙多上）→ 甲欠乙。
 */
export function settleDebts(debts: DebtRec[], m: MonthDoc, items: QuotaItem[]): DebtRec[] {
  const out = debts.map(d => ({ ...d }));
  const pair = new Map<string, number>(); // `${from}|${to}|${item}` → 數量（from 欠 to）
  for (const s of m.swaps ?? []) {
    for (const it of items) {
      const dA = inItem(it, s.bCode, m.ym, s.day) - inItem(it, s.aCode, m.ym, s.day);
      if (!dA) continue;
      const [from, to] = dA < 0 ? [s.a, s.b] : [s.b, s.a];
      const k = `${from}|${to}|${it.id}`, rk = `${to}|${from}|${it.id}`;
      const rev = pair.get(rk) ?? 0;
      const n = Math.abs(dA);
      if (rev >= n) pair.set(rk, rev - n);
      else { pair.delete(rk); pair.set(k, (pair.get(k) ?? 0) + n - rev); }
    }
  }
  for (const [k, qty0] of pair) {
    let qty = qty0;
    if (!qty) continue;
    const [from, to, item] = k.split("|");
    // 先還舊帳：既有 to 欠 from 的同項目
    for (const d of out) {
      if (!qty) break;
      if (d.settledAt || d.from !== to || d.to !== from || d.item !== item) continue;
      const use = Math.min(d.qty, qty);
      d.qty -= use;
      qty -= use;
      if (d.qty === 0) { d.settledAt = new Date().toISOString(); d.note = `${d.note ? d.note + "；" : ""}${m.ym} 換班抵銷`; }
    }
    if (qty) out.push({ id: newId(), from, to, item, qty, ym: m.ym, settledAt: null, note: "" });
  }
  return out;
}
