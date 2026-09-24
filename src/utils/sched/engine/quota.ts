/**
 * 月配額引擎：移植 Excel VBA `FillQuotas` / `DistributeQuota` / `TransferNightQuota` /
 * `NoDutyOffQuota` / `PerformHandover`（ADR-014）。
 */
import type { MonthDoc, HolidayDoc, ShiftDef, QuotaItem, Flags, RosterEntry } from "../types";
import { daysIn, dowOf, isRestDay } from "../calendar";
import { needOf, allOffSlots, type CellFn } from "./staffing";

export interface QuotaResult {
  totals: Record<string, number>;                         // 項目 → 總數（固定 OFF 扣除前）
  quotas: Record<string, Record<string, number>>;         // personId → 項目 → 配額
  markers: Record<string, { v: string | null; x: string | null }>;
  offSlots: number[];                                     // 每日可休
  fixedOff: number;                                       // OFF 固定＝假日數 的天數
}

export interface DistResult { values: Record<string, number>; x: string | null }

/**
 * DistributeQuota：每人 ⌊總數/人數⌋，餘數從 V 起依序各 +1，最後一人為 X；
 * 整除時 X＝V 的前一位（下月交接後 V 回到原位）。V 不在名單中時從第一位開始。
 */
export function distribute(eligible: string[], dividend: number, v: string | null): DistResult {
  const values: Record<string, number> = {};
  const n = eligible.length;
  if (!n) return { values, x: null };
  const start = v && eligible.includes(v) ? eligible.indexOf(v) : 0;
  const base = Math.floor(dividend / n);
  const rem = dividend - base * n;
  for (const id of eligible) values[id] = base;
  let xi: number;
  if (rem > 0) {
    for (let j = 0; j < rem; j++) values[eligible[(start + j) % n]] += 1;
    xi = (start + rem - 1) % n;
  } else {
    xi = (start - 1 + n) % n;
  }
  return { values, x: eligible[xi] };
}

/**
 * TransferNightQuota：夜班配額轉出者的 N 額度，從 X 的下一位起沿 N 名單交給
 * 「非轉出、且還有 D 可還」的人；收受者 N+1、D−1，轉出者 D+1；X 移到最後收受者。
 */
export function transferNight(
  nEligible: string[], transfer: Set<string>,
  nVals: Record<string, number>, dVals: Record<string, number>, x: string | null,
): string | null {
  const n = nEligible.length;
  if (!n) return x;
  let xIndex = x && nEligible.includes(x) ? nEligible.indexOf(x) : n - 1;
  let last: string | null = null;
  for (const src of nEligible) {
    if (!transfer.has(src)) continue;
    let qty = nVals[src] ?? 0;
    if (qty <= 0) continue;
    nVals[src] = 0;
    let cursor = xIndex, guard = 0;
    while (qty > 0 && guard < n * 3) {
      guard++;
      cursor = (cursor + 1) % n;
      const tgt = nEligible[cursor];
      if (tgt !== src && !transfer.has(tgt) && (dVals[tgt] ?? 0) >= 1) {
        nVals[tgt] = (nVals[tgt] ?? 0) + 1;
        dVals[tgt] -= 1;
        dVals[src] = (dVals[src] ?? 0) + 1;
        qty--;
        last = tgt;
        xIndex = cursor;
      }
    }
  }
  return last ?? x;
}

/** 假日數：週六＋週日＋國定假日，同日不重複（補班日不算） */
export function holidayCount(ym: string, h: HolidayDoc): number {
  let c = 0;
  for (let d = 1; d <= daysIn(ym); d++) if (isRestDay(ym, d, h)) c++;
  return c;
}

export function isEligible(item: QuotaItem, f: Flags): boolean {
  return f.active && !item.exclude.some(k => f[k]);
}

export interface QuotaInput {
  month: MonthDoc;
  holidays: HolidayDoc;
  shifts: ShiftDef[];
  items: QuotaItem[];
  cell: CellFn;                      // 用來算 8-4（離開單位）人數
  cnyDuty?: (day: number) => number;
}

export function computeQuotas(inp: QuotaInput): QuotaResult {
  const { month: m, holidays: h } = inp;
  const nd = daysIn(m.ym);
  const offSlots = allOffSlots(m, h, inp.shifts, inp.cell, inp.cnyDuty);
  const fixedOff = holidayCount(m.ym, h);
  const quotas: Record<string, Record<string, number>> = {};
  for (const r of m.roster) quotas[r.personId] = {};
  const totals: Record<string, number> = {};
  const markers: QuotaResult["markers"] = {};
  const dist: Record<string, DistResult & { eligible: string[]; v: string | null }> = {};

  const inDow = (it: QuotaItem, d: number) => !it.dow || it.dow.includes(dowOf(m.ym, d));
  function totalOf(it: QuotaItem): number {
    let t = 0;
    for (let d = 1; d <= nd; d++) {
      if (!inDow(it, d)) continue;
      if (it.total === "OFF") t += offSlots[d - 1];
      else t += needOf(m, d, h)[it.total];
    }
    return t;
  }

  const enabled = inp.items.filter(i => i.enabled);
  for (const it of enabled) {
    const total = totalOf(it);
    totals[it.id] = total;
    let eligible = m.roster.filter(r => isEligible(it, r.flags)).map(r => r.personId);
    let dividend = total;
    let v = m.markers[it.id]?.v ?? null;
    // OFF 項目：OFF 固定＝假日數 的人先拿固定值，並自總數扣除（NoDutyOffQuota）
    if (it.id === "OFF") {
      const fixed = m.roster.filter(r => isEligible(it, r.flags) && r.flags.fixedHolidayOff).map(r => r.personId);
      for (const id of fixed) quotas[id][it.id] = fixedOff;
      eligible = eligible.filter(id => !fixed.includes(id));
      dividend = Math.max(0, total - fixedOff * fixed.length);
      // V 落在固定者身上時順延到名單中下一位（Excel 會退回第一位，屬於邊界缺陷）
      if (v && fixed.includes(v)) {
        const order = m.roster.map(r => r.personId);
        const i = order.indexOf(v);
        v = order.slice(i + 1).concat(order.slice(0, i)).find(id => eligible.includes(id)) ?? null;
      }
    }
    const r = distribute(eligible, dividend, v);
    dist[it.id] = { ...r, eligible, v };
  }

  // 夜班配額轉出（需 D、N 兩項皆啟用）
  if (dist.N && dist.D) {
    const transfer = new Set(m.roster.filter(r => r.flags.nightTransfer).map(r => r.personId));
    if (transfer.size) {
      dist.N.x = transferNight(dist.N.eligible, transfer, dist.N.values, dist.D.values, dist.N.x);
    }
  }

  for (const it of enabled) {
    const r = dist[it.id];
    for (const e of m.roster) quotas[e.personId][it.id] ??= 0;
    for (const [id, v] of Object.entries(r.values)) quotas[id][it.id] = v;
    markers[it.id] = { v: r.v, x: r.x };
  }
  return { totals, quotas, markers, offSlots, fixedOff };
}

/**
 * PerformHandover：下月 V ＝ 上月 X 在名單中的下一位合格者（環狀）。
 * 上月沒有 X 時沿用上月 V。X 已不在新名單時，以上月名單順序往後找第一個還在的人。
 */
export function handoverV(
  item: QuotaItem, prevRoster: RosterEntry[], prevMarker: { v: string | null; x: string | null } | undefined,
  newRoster: RosterEntry[],
): string | null {
  if (!prevMarker) return null;
  const { x } = prevMarker;
  if (!x) return prevMarker.v;
  const order = newRoster.map(r => r.personId);
  let pos = order.indexOf(x);
  if (pos < 0) {
    const prevOrder = prevRoster.map(r => r.personId);
    const pi = prevOrder.indexOf(x);
    for (let k = 1; k <= prevOrder.length && pos < 0; k++) {
      const cand = prevOrder[(pi + k) % prevOrder.length];
      const ni = order.indexOf(cand);
      if (ni >= 0) pos = ni - 1; // 從該人（含）開始找
    }
    if (pos < 0) pos = -1;
  }
  const n = newRoster.length;
  for (let k = 1; k <= n; k++) {
    const r = newRoster[(pos + k + n) % n];
    if (isEligible(item, r.flags)) return r.personId;
  }
  return null;
}
