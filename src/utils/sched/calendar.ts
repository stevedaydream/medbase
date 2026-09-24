import type { DayType, HolidayDoc } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export function ymParts(ym: string): { y: number; m: number } {
  return { y: Number(ym.slice(0, 4)), m: Number(ym.slice(4, 6)) };
}

export function toYm(y: number, m: number): string {
  const d = new Date(y, m - 1, 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}`;
}

export const nextYm = (ym: string) => { const { y, m } = ymParts(ym); return toYm(y, m + 1); };
export const prevYm = (ym: string) => { const { y, m } = ymParts(ym); return toYm(y, m - 1); };

export function daysIn(ym: string): number {
  const { y, m } = ymParts(ym);
  return new Date(y, m, 0).getDate();
}

export function dateStr(ym: string, day: number): string {
  const { y, m } = ymParts(ym);
  return `${y}-${pad(m)}-${pad(day)}`;
}

/** 0=日 … 6=六 */
export function dowOf(ym: string, day: number): number {
  const { y, m } = ymParts(ym);
  return new Date(y, m - 1, day).getDay();
}

export function isHoliday(h: HolidayDoc, date: string): boolean {
  return date in h.days;
}

/** 國定假日優先；補班日視為平日 */
export function dayTypeOf(ym: string, day: number, h: HolidayDoc): DayType {
  const ds = dateStr(ym, day);
  if (isHoliday(h, ds)) return "holiday";
  if (h.workdays.includes(ds)) return "weekday";
  const dw = dowOf(ym, day);
  if (dw === 6) return "saturday";
  if (dw === 0) return "sunday";
  return "weekday";
}

/** 休息日（週六、週日、國定假日；補班日除外） */
export function isRestDay(ym: string, day: number, h: HolidayDoc): boolean {
  return dayTypeOf(ym, day, h) !== "weekday";
}

export function inCny(h: HolidayDoc, date: string): boolean {
  return h.cny.some(r => date >= r.from && date <= r.to);
}

/** 月份間的日期逐日推進（跨月用） */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function ymOfDate(date: string): string {
  return date.slice(0, 4) + date.slice(5, 7);
}

export function dayOfDate(date: string): number {
  return Number(date.slice(8, 10));
}

export function dowOfDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export const WEEKDAY_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

export function emptyHolidays(): HolidayDoc {
  return { days: {}, workdays: [], cny: [] };
}
