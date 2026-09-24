/**
 * 逐日指派：週末階梯輪序、國定假日抽籤、全外科 8-4 輪值、春節階梯輪值（schedular.md §6）。
 * 全部為純函式；結果由 prefill.ts 寫入預班層。
 */
import type {
  RosterEntry, HolidayDoc, HolidayDutyDoc, WeekendPointers, Person, Duty84Doc, Duty84Entry, CnyDoc,
} from "../types";
import { daysIn, dateStr, dowOf, isHoliday, inCny, addDays, isRestDay, ymOfDate, dayOfDate } from "../calendar";

export interface Assign { date: string; personId: string; code: string; source: "weekend" | "holiday" | "84" | "cny" }

/** 名單中 after 之後第一個符合條件的人（環狀；after 不在名單時從頭找） */
export function nextInOrder(order: string[], after: string | null, ok: (id: string) => boolean): string | null {
  const n = order.length;
  if (!n) return null;
  const start = after ? order.indexOf(after) : -1;
  for (let k = 1; k <= n; k++) {
    const id = order[(start + k + n) % n];
    if (ok(id)) return id;
  }
  return null;
}

// ── 國定假日抽籤 ──────────────────────────────────────────────────────
export function holidayAssigns(ym: string, h: HolidayDoc, duty: HolidayDutyDoc): Assign[] {
  const out: Assign[] = [];
  for (let d = 1; d <= daysIn(ym); d++) {
    const date = dateStr(ym, d);
    if (!isHoliday(h, date) || inCny(h, date)) continue;
    const e = duty[date.slice(0, 4)]?.[date];
    if (e?.D) out.push({ date, personId: e.D, code: "D", source: "holiday" });
    if (e?.N) out.push({ date, personId: e.N, code: "N", source: "holiday" });
  }
  return out;
}

// ── 週末階梯輪序 ──────────────────────────────────────────────────────
export interface WeekendInput {
  ym: string;
  roster: RosterEntry[];
  holidays: HolidayDoc;
  holidayDuty: HolidayDutyDoc;
  start: WeekendPointers;              // 上月最後指派的人
  /** 本月 1 號是週日時，上月最後一天（週六）的週末 N 人選 */
  carrySunN: string | null;
  /** 當日已被其他指派佔用的人（8-4、國定假日、春節） */
  busy: (date: string) => Set<string>;
}
export interface WeekendOutput { assigns: Assign[]; end: WeekendPointers; warnings: string[] }

export function weekendAssigns(inp: WeekendInput): WeekendOutput {
  const { ym, roster, holidays: h } = inp;
  const order = roster.map(r => r.personId);
  const flags = new Map(roster.map(r => [r.personId, r.flags]));
  const okD = (id: string) => { const f = flags.get(id)!; return f.active && !f.noD; };
  const okN = (id: string) => { const f = flags.get(id)!; return f.active && !f.noN && !f.nightTransfer; };
  const lotteryN = (date: string) => inp.holidayDuty[date.slice(0, 4)]?.[date]?.N ?? null;
  const out: Assign[] = [];
  const warnings: string[] = [];
  const end: WeekendPointers = { ...inp.start };
  const nd = daysIn(ym);
  const isWeekendDay = (date: string, dow: number) => {
    // 補班日不算週末；國定假日仍算（由抽籤處理）
    if (h.workdays.includes(date)) return false;
    return dow === 6 || dow === 0;
  };

  function pick(ptr: keyof WeekendPointers, ok: (id: string) => boolean, avoid: Set<string>, label: string): string | null {
    const first = nextInOrder(order, end[ptr], ok);
    const id = nextInOrder(order, end[ptr], x => ok(x) && !avoid.has(x));
    if (first && id && first !== id) warnings.push(`${label}：輪到的人當天已有其他班，改由下一位`);
    if (id) end[ptr] = id;
    return id;
  }

  const nOn = new Map<string, string>(); // 日期 → 週末 N 的人（避免同日 D+N）
  for (let d = 1; d <= nd; d++) {
    const date = dateStr(ym, d);
    const dow = dowOf(ym, d);
    if (!isWeekendDay(date, dow) || inCny(h, date)) continue;

    if (dow === 6) {
      const sun = addDays(date, 1);
      const holSat = isHoliday(h, date), holSun = isHoliday(h, sun);
      if (!holSat && !holSun) {
        const busy = new Set([...inp.busy(date), ...inp.busy(sun)]);
        const n = pick("wkN", okN, busy, `${date} 週末 N`);
        if (n) {
          nOn.set(date, n); nOn.set(sun, n);
          out.push({ date, personId: n, code: "N", source: "weekend" });
          if (ymOfDate(sun) === ym) out.push({ date: sun, personId: n, code: "N", source: "weekend" });
        }
      } else if (holSat && !holSun) {
        const n = lotteryN(date);
        if (n && ymOfDate(sun) === ym) { nOn.set(sun, n); out.push({ date: sun, personId: n, code: "N", source: "weekend" }); }
      } else if (!holSat && holSun) {
        const n = lotteryN(sun);
        if (n) { nOn.set(date, n); out.push({ date, personId: n, code: "N", source: "weekend" }); }
      }
      if (!holSat) {
        const avoid = new Set([...inp.busy(date), ...(nOn.has(date) ? [nOn.get(date)!] : [])]);
        const dd = pick("satD", okD, avoid, `${date} 週六 D`);
        if (dd) out.push({ date, personId: dd, code: "D", source: "weekend" });
      }
    } else {
      const holSun = isHoliday(h, date);
      if (d === 1 && !holSun) {
        const sat = addDays(date, -1);
        const n = isHoliday(h, sat) ? lotteryN(sat) : inp.carrySunN;
        if (n) { nOn.set(date, n); out.push({ date, personId: n, code: "N", source: "weekend" }); }
      }
      if (!holSun) {
        const avoid = new Set([...inp.busy(date), ...(nOn.has(date) ? [nOn.get(date)!] : [])]);
        const dd = pick("sunD", okD, avoid, `${date} 週日 D`);
        if (dd) out.push({ date, personId: dd, code: "D", source: "weekend" });
      }
    }
  }
  return { assigns: out, end, warnings };
}

// ── 8-4（全外科）─────────────────────────────────────────────────────
/** 每段連續休息日的最後一天（春節期間除外），再套用手動增刪 */
export function duty84Dates(from: string, to: string, h: HolidayDoc, doc: Duty84Doc): { date: string; kind: string }[] {
  const out: { date: string; kind: string }[] = [];
  const rest = (date: string) => isRestDay(ymOfDate(date), dayOfDate(date), h);
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!rest(date) || rest(addDays(date, 1)) || inCny(h, date)) continue;
    // 往前數這段休息日的長度
    let len = 1;
    while (rest(addDays(date, -len))) len++;
    const plainWeekend = len === 2 && !isHoliday(h, date) && !isHoliday(h, addDays(date, -1));
    out.push({ date, kind: plainWeekend ? "一般週日" : "連假末日" });
  }
  const removed = new Set(doc.removedDates);
  const list = out.filter(x => !removed.has(x.date));
  for (const a of doc.addedDates) {
    if (a >= from && a <= to && !list.some(x => x.date === a)) list.push({ date: a, kind: "手動" });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 自 from 起重排 8-4：保留 from 之前的明細；之後的日期依名單順序接續上一位（跳過免輪、停用），
 * 手動指定的人保留。
 */
export function recompute84(doc: Duty84Doc, people: Person[], h: HolidayDoc, from: string, to: string): Duty84Entry[] {
  const order = [...people].sort((a, b) => a.order - b.order);
  const ids = order.map(p => p.id);
  const ok = (id: string) => { const p = order.find(x => x.id === id)!; return p.active && !p.exempt84; };
  const kept = doc.log.filter(e => e.date < from).sort((a, b) => a.date.localeCompare(b.date));
  const manual = new Map(doc.log.filter(e => e.date >= from && e.manual).map(e => [e.date, e]));
  let ptr = [...kept].reverse().find(e => e.personId)?.personId ?? null;
  const out: Duty84Entry[] = [...kept];
  for (const { date, kind } of duty84Dates(from, to, h, doc)) {
    const m = manual.get(date);
    if (m) { out.push(m); if (m.personId) ptr = m.personId; continue; }
    const id = nextInOrder(ids, ptr, ok);
    out.push({ date, personId: id, kind, manual: false, note: "" });
    if (id) ptr = id;
  }
  return out;
}

// ── 春節（全外科）────────────────────────────────────────────────────
/** 階梯：每天 D 往下一位，N＝前一天的 D；第一天 N＝去年最後一天的 D */
export function recomputeCny(cny: CnyDoc, people: Person[], h: HolidayDoc): CnyDoc {
  const order = [...people].sort((a, b) => a.order - b.order);
  const ids = order.map(p => p.id);
  const ok = (id: string) => { const p = order.find(x => x.id === id)!; return p.active && !p.exemptCny; };
  const lastD: Record<string, string | null> = { ...cny.lastD };
  const log: CnyDoc["log"] = [];
  for (const r of [...h.cny].sort((a, b) => a.from.localeCompare(b.from))) {
    const year = r.from.slice(0, 4);
    let prevD = lastD[String(Number(year) - 1)] ?? null;
    let dPtr = prevD;
    for (let date = r.from; date <= r.to; date = addDays(date, 1)) {
      const d = nextInOrder(ids, dPtr, ok);
      log.push({ date, D: d, N: prevD });
      prevD = d;
      if (d) dPtr = d;
    }
    lastD[year] = prevD;
  }
  return { lastD, log };
}

export function cnyAssigns(ym: string, cny: CnyDoc): Assign[] {
  const out: Assign[] = [];
  for (const e of cny.log) {
    if (ymOfDate(e.date) !== ym) continue;
    if (e.D) out.push({ date: e.date, personId: e.D, code: "D", source: "cny" });
    if (e.N) out.push({ date: e.date, personId: e.N, code: "N", source: "cny" });
  }
  return out;
}

export function duty84Assigns(ym: string, log: Duty84Entry[]): Assign[] {
  return log.filter(e => ymOfDate(e.date) === ym && e.personId)
    .map(e => ({ date: e.date, personId: e.personId!, code: "8-4", source: "84" as const }));
}

