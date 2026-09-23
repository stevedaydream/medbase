/**
 * NP／VS 值班：科別常數與顯示規則，桌機側邊欄與手機首頁共用（ADR-013）。
 * 班別時間：白八 08–20、夜八 20–隔日 08；凌晨 00–08 仍在班的是「昨天的夜八」（顯示「昨夜」）。
 */

export const NP_WARDS = ["9A", "9B", "8A"] as const;
export type NpWard = (typeof NP_WARDS)[number];
export const VS_UNITS = ["ICU", "總值", "GS", "CRS", "ORTHO", "NS", "PS", "URO", "CVS", "Chest", "Trauma"] as const;
export type VsDutyUnit = (typeof VS_UNITS)[number];
export const DUTY_UNITS = [...NP_WARDS, ...VS_UNITS] as const;
export type DutyUnit = (typeof DUTY_UNITS)[number];

export function isNpWard(unit: string): unit is NpWard {
  return (NP_WARDS as readonly string[]).includes(unit);
}

export function isVsDutyUnit(unit: string): unit is VsDutyUnit {
  return (VS_UNITS as readonly string[]).includes(unit);
}

/** VS 預設只顯示總值，其餘科別收折 */
export const VS_PRIMARY = "總值";
export const VS_OTHERS = VS_UNITS.filter(u => u !== VS_PRIMARY);

export interface DutyShiftLike { shift: string; carried?: boolean }

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** YYYY-MM-DD（本地時間） */
export function localDateKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** 看「今天」時，凌晨 8 點前把昨天的夜八加到最前面並標為 carried */
export function withCarriedNight<T extends DutyShiftLike>(todayRows: T[], yesterdayRows: T[], now: Date, viewingToday: boolean): (T & { carried: boolean })[] {
  const list = todayRows.map(r => ({ ...r, carried: false }));
  if (!viewingToday || now.getHours() >= 8) return list;
  return [...yesterdayRows.filter(r => r.shift === "夜八").map(r => ({ ...r, carried: true })), ...list];
}

/** 此刻是否在班（只有看「今天」才有意義） */
export function isOnDuty(row: DutyShiftLike, now: Date, viewingToday: boolean): boolean {
  if (!viewingToday) return false;
  const h = now.getHours();
  if (row.carried) return h < 8;
  if (row.shift === "白八") return h >= 8 && h < 20;
  if (row.shift === "夜八") return h >= 20;
  return false;
}

/** 只有白八／夜八有時間；其他班（例如 PGY 值班）不淡化 */
export function isTimedShift(row: DutyShiftLike): boolean {
  return !!row.carried || row.shift === "白八" || row.shift === "夜八";
}

export function shiftLabel(row: DutyShiftLike): string {
  if (row.carried) return "昨夜";
  if (row.shift === "白八") return "白";
  if (row.shift === "夜八") return "夜";
  return row.shift;
}

/** 姓名比對（去空白），用於以值班姓名找通訊錄的 HIS 帳號 */
export function normName(name: string): string {
  return name.replace(/\s+/g, "");
}
