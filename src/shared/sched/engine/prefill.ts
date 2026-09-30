/**
 * 系統預填與往後重算（schedular.md §6.5、§7）。
 * 預填寫入預班層（src = "sys"）；覆蓋員工預約時產生通知。
 */
import type {
  MonthDoc, PrebookDoc, Person, HolidayDoc, HolidayDutyDoc, Duty84Doc, CnyDoc, ShiftDef, QuotaItem,
  CellOrigin, WeekendPointers,
} from "../types";
import { cellKey, emptyMonth, clone, CONSTRAINT_MARKS } from "../types";
import { daysIn, dateStr, dayOfDate, prevYm, nextYm, addDays, dowOf, dayTypeOf, inCny } from "../calendar";
import {
  holidayAssigns, weekendAssigns, duty84Assigns, cnyAssigns, recompute84, recomputeCny, type Assign,
} from "./rotation";
import { computeQuotas, handoverV } from "./quota";
import { staffIds, offSlots, needOf } from "./staffing";

/**
 * 手動指定的「本月第一位」換算成輪序指標（第一位的前一個人），
 * 讓 nextInOrder 從指定的人開始。
 */
export function applyWeekendFirst(
  order: string[], start: WeekendPointers | null | undefined, first: MonthDoc["weekendFirst"],
): WeekendPointers {
  const out: WeekendPointers = { wkN: null, satD: null, sunD: null, ...(start ?? {}) };
  for (const k of ["wkN", "satD", "sunD"] as const) {
    const id = first?.[k];
    const i = id ? order.indexOf(id) : -1;
    if (i >= 0) out[k] = order[(i - 1 + order.length) % order.length];
  }
  return out;
}

export interface SchedSnapshot {
  people: Person[];
  shifts: ShiftDef[];
  quotaItems: QuotaItem[];
  holidays: HolidayDoc;
  holidayDuty: HolidayDutyDoc;
  duty84: Duty84Doc;
  cny: CnyDoc;
  months: Record<string, MonthDoc>;
  prebooks: Record<string, PrebookDoc>;
}

export interface Notice {
  personId: string;
  ym: string;
  day: number;
  oldValue: string;
  newValue: string;
  reason: string;
}

export interface RecomputeResult {
  months: Record<string, MonthDoc>;
  prebooks: Record<string, PrebookDoc>;
  duty84: Duty84Doc;
  cny: CnyDoc;
  notices: Notice[];
  warnings: string[];
}

const isMark = (v: string | null | undefined) => !!v && (CONSTRAINT_MARKS as readonly string[]).includes(v);

/** 預班層某格目前的值 */
export function prebookValue(pb: PrebookDoc | undefined, personId: string, day: number): string {
  return pb?.cells[cellKey(personId, day)]?.v ?? "";
}

/** 月份實際排班（已排班或已發布用排班層，開放預班用預班層） */
export function cellFnOf(m: MonthDoc, pb: PrebookDoc | undefined) {
  if (m.status === "open") return (id: string, d: number) => { const v = prebookValue(pb, id, d); return isMark(v) ? "" : v; };
  return (id: string, d: number) => m.schedule[id]?.[d - 1] ?? "";
}

/** 開新月份：沿用上月的人員設定與人力表（不含日期區段與單日微調） */
export function newMonthFrom(prev: MonthDoc | undefined, ym: string): MonthDoc {
  const m = emptyMonth(ym);
  if (prev) {
    m.roster = clone(prev.roster);
    m.staffing.base = clone(prev.staffing.base);
  }
  return m;
}

/**
 * 算出某月所有預填（春節 > 8-4 > 國定假日 > 週末），只保留本月名單中的人。
 * 8-4 是全外科輪值，同一人同一天撞班時優先保留。
 */
export function monthAssigns(
  s: SchedSnapshot, m: MonthDoc, prev: MonthDoc | undefined, cny: CnyDoc, log84: Duty84Doc["log"],
): { assigns: Assign[]; end: MonthDoc["weekend"]["end"]; warnings: string[] } {
  const inRoster = new Set(m.roster.map(r => r.personId));
  const fixed: Assign[] = [
    ...cnyAssigns(m.ym, cny),
    ...duty84Assigns(m.ym, log84),
    ...holidayAssigns(m.ym, s.holidays, s.holidayDuty),
  ];
  // 下個月的全外科預填只用來避開跨月週末（月底週六 N 連值到下月週日），不寫入本月
  const nym = nextYm(m.ym);
  const nextFixed: Assign[] = [
    ...cnyAssigns(nym, cny),
    ...duty84Assigns(nym, log84),
    ...holidayAssigns(nym, s.holidays, s.holidayDuty),
  ];
  const busyMap = new Map<string, Set<string>>();
  for (const a of [...fixed, ...nextFixed]) {
    if (!busyMap.has(a.date)) busyMap.set(a.date, new Set());
    busyMap.get(a.date)!.add(a.personId);
  }
  const start = applyWeekendFirst(m.roster.map(r => r.personId), prev?.weekend.end ?? m.weekend.start, m.weekendFirst);
  const lastPrev = prev ? daysIn(prev.ym) : 0;
  const carrySunN = prev && dowOf(prev.ym, lastPrev) === 6 ? prev.weekend.end?.wkN ?? null : null;
  const wk = weekendAssigns({
    ym: m.ym, roster: m.roster, holidays: s.holidays, holidayDuty: s.holidayDuty,
    start: start ?? { wkN: null, satD: null, sunD: null }, carrySunN,
    busy: date => busyMap.get(date) ?? new Set(),
  });
  const warnings = [...wk.warnings];
  // 預填換人：輪序照算，符合的格子改由接手的人預填
  const raw = [...fixed, ...wk.assigns];
  for (const sw of m.prefillSwaps ?? []) {
    const date = dateStr(m.ym, sw.day);
    const hit = raw.find(a => a.date === date && a.code === sw.code && a.personId === sw.from);
    if (!hit) { warnings.push(`${date} 預填換人失效：輪序已不是由該員上 ${sw.code}`); continue; }
    // 接手的人當天已有其他預填（例如 8-4）：不換，仍由原本的人上，避免去重後留下空班
    const clash = raw.find(a => a !== hit && a.date === date && a.personId === sw.to);
    if (clash) { warnings.push(`${date} 預填換人失效：接手的人當天已有 ${clash.code}，${sw.code} 仍由原本的人上`); continue; }
    hit.personId = sw.to;
  }
  const all = raw.filter(a => inRoster.has(a.personId));
  // 同一格只取第一個（優先順序如上）
  const seen = new Set<string>();
  const kept = new Map<string, Assign>();
  const assigns = all.filter(a => {
    const k = `${a.personId}|${a.date}`;
    if (seen.has(k)) { warnings.push(`${a.date} 同一人同一天有兩個預填（${kept.get(k)!.code}、${a.code}），只保留 ${kept.get(k)!.code}`); return false; }
    seen.add(k); kept.set(k, a); return true;
  });
  return { assigns, end: wk.end, warnings };
}

/** 將預填寫入預班層：清除舊的 sys 格，覆蓋員工預約時記通知 */
export function applyPrefill(pb: PrebookDoc, assigns: Assign[], now: string, reason: string): { doc: PrebookDoc; notices: Notice[] } {
  const doc: PrebookDoc = { ym: pb.ym, cells: {} };
  for (const [k, c] of Object.entries(pb.cells)) if (c.src !== "sys") doc.cells[k] = c;
  const notices: Notice[] = [];
  for (const a of assigns) {
    const day = dayOfDate(a.date);
    const k = cellKey(a.personId, day);
    const old = doc.cells[k];
    if (old && old.src === "emp" && old.v && old.v !== a.code) {
      notices.push({ personId: a.personId, ym: pb.ym, day, oldValue: old.v, newValue: a.code, reason });
    }
    doc.cells[k] = { v: a.code, src: "sys", by: "system", at: now, reason };
  }
  return { doc, notices };
}

export const AUTO_OFF_REASON = "週日／國定假日自動補休";

/**
 * 週日、國定假日、春節：預填後沒有任何班的人自動補 OFF（src sys、auto），
 * 讓每日已休／可休與每人休假天數在預班時就準確。
 * 不覆蓋任何已登記的格子；要補的人比可休人數多（例如單日人力微調需要有人上班）時當天不補、提示。
 */
export function applyAutoOff(
  m: MonthDoc, pb: PrebookDoc, h: HolidayDoc, shifts: ShiftDef[], now: string,
): { doc: PrebookDoc; warnings: string[] } {
  const doc: PrebookDoc = { ym: pb.ym, cells: { ...pb.cells } };
  const warnings: string[] = [];
  const takesOff = new Set(shifts.filter(x => x.takesOff).map(x => x.code));
  const sm = new Map(shifts.map(x => [x.code, x]));
  const ids = staffIds(m);
  const cell = cellFnOf(m, doc);
  for (let d = 1; d <= daysIn(m.ym); d++) {
    const date = dateStr(m.ym, d);
    const t = dayTypeOf(m.ym, d, h);
    const cny = inCny(h, date);
    if (t !== "sunday" && t !== "holiday" && !cny) continue;
    const empty = ids.filter(id => !doc.cells[cellKey(id, d)]?.v);
    if (!empty.length) continue;
    // 春節由全外科輪值，沒輪到的人都休
    if (!cny) {
      const need = needOf(m, d, h);
      const working = ids.filter(id => sm.get(doc.cells[cellKey(id, d)]?.v ?? "")?.staffing).length;
      if (working < need.D + need.N + need.S1) {
        warnings.push(`${date} 當天值班還沒排定（例如國定假日尚未抽籤），未自動補 OFF`);
        continue;
      }
      const already = ids.filter(id => takesOff.has(doc.cells[cellKey(id, d)]?.v ?? "")).length;
      const room = offSlots(m, d, h, shifts, cell) - already;
      if (empty.length > room) {
        warnings.push(`${date} 可休 ${Math.max(0, room)} 人、還沒排班的有 ${empty.length} 人，需要有人上班，未自動補 OFF，請手動排`);
        continue;
      }
    }
    for (const id of empty) doc.cells[cellKey(id, d)] = { v: "OFF", src: "sys", by: "system", at: now, reason: AUTO_OFF_REASON, auto: true };
  }
  return { doc, warnings };
}

/**
 * 自 fromYm 起重算：8-4 明細、春節、每個「開放預班」月份的預填、週末指標、V 交接與預估 X。
 * 已排班／已發布的月份不動，只作為下一個月的交接依據。
 */
export function recomputeFrom(s: SchedSnapshot, fromYm: string, now: string, reason: string): RecomputeResult {
  const months: Record<string, MonthDoc> = clone(s.months);
  const prebooks: Record<string, PrebookDoc> = clone(s.prebooks);
  const warnings: string[] = [];
  const notices: Notice[] = [];

  // 有預班但沒有月份文件的月份（例如匯入的後續月份）：補建
  const allYms = [...new Set([...Object.keys(months), ...Object.keys(prebooks)])].sort();
  for (const ym of allYms) {
    if (!months[ym]) months[ym] = newMonthFrom(months[prevYm(ym)] ?? findPrev(months, ym), ym);
    prebooks[ym] ??= { ym, cells: {} };
  }
  const yms = Object.keys(months).sort();
  const last = yms[yms.length - 1];
  // 多算下個月第一週的 8-4：最後一個月的月底週末也能避開下月週日的 8-4
  const horizon = addDays(last ? dateStr(last, daysIn(last)) : dateStr(fromYm, daysIn(fromYm)), 7);

  const duty84: Duty84Doc = { ...clone(s.duty84), log: recompute84(s.duty84, s.people, s.holidays, dateStr(fromYm, 1), horizon) };
  const cny = recomputeCny(s.cny, s.people, s.holidays);

  for (const ym of yms) {
    if (ym < fromYm) continue;
    const m = months[ym];
    if (m.status !== "open") continue;
    const prev = months[prevYm(ym)];
    // V 交接
    if (prev) {
      for (const it of s.quotaItems) {
        m.markers[it.id] = { v: m.vOverride?.[it.id] ?? handoverV(it, prev.roster, prev.markers[it.id], m.roster), x: null };
      }
      m.weekend.start = prev.weekend.end ?? m.weekend.start;
    }
    const { assigns, end, warnings: w } = monthAssigns(s, m, prev, cny, duty84.log);
    warnings.push(...w.map(x => `${ym}：${x}`));
    m.weekend.end = end;
    const r = applyPrefill(prebooks[ym], assigns, now, reason);
    const off = applyAutoOff(m, r.doc, s.holidays, s.shifts, now);
    prebooks[ym] = off.doc;
    warnings.push(...off.warnings.map(x => `${ym}：${x}`));
    notices.push(...r.notices);
    // 預估配額（決定本月 X，供下月交接）
    const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, off.doc) });
    for (const [k, mk] of Object.entries(q.markers)) m.markers[k] = mk;
  }
  return { months, prebooks, duty84, cny, notices, warnings };
}

function findPrev(months: Record<string, MonthDoc>, ym: string): MonthDoc | undefined {
  const earlier = Object.keys(months).filter(k => k < ym).sort();
  return earlier.length ? months[earlier[earlier.length - 1]] : undefined;
}

/**
 * 開始排班：預班凍結，預班與預填帶入排班層（勿休／勿值不寫入），V 由上月交接，算出本月配額與 X。
 * 上月未發布時由呼叫端決定是否強制（force）。
 */
export function startScheduling(
  s: SchedSnapshot, ym: string, now: string, opts: { force?: boolean } = {},
): { month: MonthDoc; error?: string } {
  const m = clone(s.months[ym]);
  const prev = s.months[prevYm(ym)];
  if (!m) return { month: m, error: "月份不存在" };
  if (m.status !== "open") return { month: m, error: "此月份已開始排班" };
  if (prev && prev.status !== "published" && !opts.force) return { month: m, error: "上個月尚未發布" };
  const pb = s.prebooks[ym];
  const nd = daysIn(ym);
  for (const r of m.roster) {
    const days: string[] = [], origin: CellOrigin[] = [];
    for (let d = 1; d <= nd; d++) {
      const c = pb?.cells[cellKey(r.personId, d)];
      const v = c?.v ?? "";
      if (!v || isMark(v)) { days.push(""); origin.push(""); continue; }
      days.push(v);
      origin.push(c!.src === "sys" ? "sys" : "pre");
    }
    m.schedule[r.personId] = days;
    m.origin[r.personId] = origin;
  }
  if (prev) {
    for (const it of s.quotaItems) {
      m.markers[it.id] = { v: m.vOverride?.[it.id] ?? handoverV(it, prev.roster, prev.markers[it.id], m.roster), x: null };
    }
  }
  // 預填換人轉成換班紀錄（原本的人該項 −1、接手的人 +1），配額目標與欠班沿用換班機制
  for (const sw of m.prefillSwaps ?? []) {
    if ((m.schedule[sw.to]?.[sw.day - 1] ?? "") !== sw.code) continue;
    (m.swaps ??= []).push({ id: sw.id, day: sw.day, a: sw.from, b: sw.to, aCode: sw.code, bCode: "", at: sw.at, by: sw.by, note: sw.note || "預填換人" });
  }
  m.status = "scheduling";
  m.startedAt = now;
  const q = computeQuotas({ month: m, holidays: s.holidays, shifts: s.shifts, items: s.quotaItems, cell: cellFnOf(m, pb) });
  for (const [k, mk] of Object.entries(q.markers)) m.markers[k] = mk;
  return { month: m };
}

