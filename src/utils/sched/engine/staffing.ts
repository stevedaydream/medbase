/**
 * 每日人力與可休人數（三層覆蓋：日類型人力表 → 日期區段 → 單日微調）。
 * Excel 對照：第 18 列「放假人數」公式。
 */
import type { MonthDoc, Need, HolidayDoc, ShiftDef } from "../types";
import { dayTypeOf, dateStr, inCny, daysIn } from "../calendar";

/** 取某格的班別（排班層或預班層，由呼叫端決定） */
export type CellFn = (personId: string, day: number) => string;

export const CNY_NEED: Need = { D: 1, N: 1, S1: 0 };

export function needOf(m: MonthDoc, day: number, h: HolidayDoc): Need {
  if (inCny(h, dateStr(m.ym, day))) return CNY_NEED;
  const dt = dayTypeOf(m.ym, day, h);
  const range = [...m.staffing.ranges].reverse().find(r => day >= r.from && day <= r.to);
  return (range?.table ?? m.staffing.base)[dt];
}

/** 參與人力計算的人：在職且非支援 */
export function staffIds(m: MonthDoc): string[] {
  return m.roster.filter(r => r.flags.active && !r.flags.support).map(r => r.personId);
}

/**
 * 可休人數 ＝ 在職（不含支援）− 當日需上班（D+N+S1）− 當日離開單位（8-4 類）＋ 單日微調。
 * 春節期間：需上班改為「當日輪到 9A 的人數」（由 cnyDuty 提供）。
 */
export function offSlots(
  m: MonthDoc, day: number, h: HolidayDoc, shifts: ShiftDef[], cell: CellFn,
  cnyDuty?: (day: number) => number,
): number {
  const ids = staffIds(m);
  const reduce = new Set(shifts.filter(s => s.reducesOff).map(s => s.code));
  const away = ids.filter(id => reduce.has(cell(id, day))).length;
  let working: number;
  if (inCny(h, dateStr(m.ym, day))) {
    working = cnyDuty ? cnyDuty(day) : CNY_NEED.D + CNY_NEED.N;
  } else {
    const n = needOf(m, day, h);
    working = n.D + n.N + n.S1;
  }
  const adj = m.staffing.dayAdjust[day] ?? 0;
  return Math.max(0, ids.length - working - away + adj);
}

export function allOffSlots(
  m: MonthDoc, h: HolidayDoc, shifts: ShiftDef[], cell: CellFn, cnyDuty?: (day: number) => number,
): number[] {
  return Array.from({ length: daysIn(m.ym) }, (_, i) => offSlots(m, i + 1, h, shifts, cell, cnyDuty));
}
