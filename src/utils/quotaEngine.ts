import type { Shift } from "@/composables/useShifts";
import { isDerived } from "@/composables/useShifts";

export interface QuotaTotals { D: number; N: number; Off: number; W6Off: number }
export interface BalanceState { D: number; N: number; Off: number; W6Off: number }
export type BalanceMap = Record<string, BalanceState>

export interface QuotaCell {
  quota: number
  base: number
  extras: number
  balanceBefore: number
  balanceAfter: number
}

export interface QuotaEntry {
  code: string
  D: QuotaCell
  N: QuotaCell
  Off: QuotaCell
  W6Off: QuotaCell
}

export const QUOTA_FIELDS = ["D", "N", "Off", "W6Off"] as const;
export type QuotaField = typeof QUOTA_FIELDS[number];

function getDayType(
  year: number, month: number, day: number,
  holidayDates: Set<string>
): "weekday" | "saturday" | "sunday" | "holiday" {
  const ds = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (holidayDates.has(ds)) return "holiday";
  const dow = new Date(year, month - 1, day).getDay();
  if (dow === 6) return "saturday";
  if (dow === 0) return "sunday";
  return "weekday";
}

function getFixedTarget(
  shift: Shift,
  dayType: "weekday" | "saturday" | "sunday" | "holiday"
): number {
  if (!shift.targets) return 0;
  const raw = shift.targets[dayType];
  if (raw === undefined) return 0;
  if (isDerived(raw)) return 0; // derived targets skipped — counted as Off
  return raw as number;
}

/**
 * Compute how many D / N / Off / W6Off slots the whole team needs this month.
 *
 * Uses shift.targets (per-day-type) as the staffing source of truth.
 * Holiday Saturdays: getDayType returns "holiday" first → holiday targets apply →
 * fewer required → more Off → W6Off reflects holiday-level staffing automatically.
 * Spring Festival and regular weekends are excluded from holidayDates upstream.
 */
export function computeMonthlyTotals(
  year: number,
  month: number,
  totalStaff: number,
  shifts: Shift[],
  holidayDates: Set<string>
): QuotaTotals {
  const daysInMonth = new Date(year, month, 0).getDate();
  let D = 0, N = 0, Off = 0, W6Off = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayType = getDayType(year, month, day, holidayDates);
    const dow = new Date(year, month - 1, day).getDay();

    let required = 0;
    for (const s of shifts) {
      if (s.code === "Off" || s.offVariant) continue;
      const t = getFixedTarget(s, dayType);
      required += t;
      if (s.code === "D") D += t;
      if (s.code === "N") N += t;
    }

    const offToday = Math.max(0, totalStaff - required);
    Off += offToday;
    if (dow === 6) W6Off += offToday;
  }

  return { D, N, Off, W6Off };
}

/**
 * Compute monthly totals for all extra shifts (not D/N/Off/offVariant).
 * Returns a map of shiftCode → total slots needed this month.
 */
export function computeExtraShiftTotals(
  year: number,
  month: number,
  shifts: Shift[],
  holidayDates: Set<string>
): Record<string, number> {
  const daysInMonth = new Date(year, month, 0).getDate();
  const extras = shifts.filter(s =>
    s.code !== 'D' && s.code !== 'N' && s.code !== 'Off' && !s.offVariant && !!s.targets
  );
  const result: Record<string, number> = Object.fromEntries(extras.map(s => [s.code, 0]));
  for (let day = 1; day <= daysInMonth; day++) {
    const dayType = getDayType(year, month, day, holidayDates);
    for (const s of extras) {
      result[s.code] += getFixedTarget(s, dayType);
    }
  }
  return result;
}

/**
 * Distribute totals fairly.
 * Sort staff by cumulative balance ascending (most "owed" gets priority).
 * First `extras` people get `base+1`, rest get `base`.
 */
export function buildPreview(
  staffCodes: string[],
  totals: QuotaTotals,
  balances: BalanceMap,
  savedOrders: Partial<Record<QuotaField, string[]>> = {}
): QuotaEntry[] {
  const n = staffCodes.length;
  if (n === 0) return [];

  const byCode = Object.fromEntries(
    staffCodes.map(code => [code, {
      code,
      D:     emptyCel(),
      N:     emptyCel(),
      Off:   emptyCel(),
      W6Off: emptyCel(),
    } as QuotaEntry])
  );

  for (const field of QUOTA_FIELDS) {
    const total    = totals[field];
    const base     = Math.floor(total / n);
    const extras   = total - base * n;
    const expected = total / n;

    const saved = savedOrders[field];
    const ordered = (saved && saved.length === n)
      ? saved
      : [...staffCodes].sort((a, b) =>
          (balances[a]?.[field] ?? 0) - (balances[b]?.[field] ?? 0)
        );

    ordered.forEach((code, i) => {
      const before = balances[code]?.[field] ?? 0;
      const quota  = i < extras ? base + 1 : base;
      byCode[code][field] = {
        quota,
        base,
        extras,
        balanceBefore: before,
        balanceAfter: parseFloat((before + quota - expected).toFixed(4)),
      };
    });
  }

  return staffCodes.map(c => byCode[c]);
}

function emptyCel(): QuotaCell {
  return { quota: 0, base: 0, extras: 0, balanceBefore: 0, balanceAfter: 0 };
}

/** Rotation order for a field, derived from preview (balance-sorted). */
export function getFieldOrder(preview: QuotaEntry[], field: QuotaField): string[] {
  return [...preview].sort(
    (a, b) => a[field].balanceBefore - b[field].balanceBefore
  ).map(e => e.code);
}
