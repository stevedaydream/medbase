import { ref, computed } from "vue";

export interface DerivedTarget { subtract: string[] }
export type DayTarget = number | DerivedTarget
export interface ShiftTargets {
  weekday?:  DayTarget;
  saturday?: DayTarget;
  sunday?:   DayTarget;
  holiday?:  DayTarget;
}
export function isDerived(t: DayTarget | undefined): t is DerivedTarget {
  return typeof t === "object" && t !== null && "subtract" in t;
}

export interface Shift { code: string; color: string; target?: number; targets?: ShiftTargets; offVariant?: boolean }

export const COLOR_PALETTE = [
  { key: "blue",    bg: "#1e3a5f", text: "#93c5fd" },
  { key: "violet",  bg: "#2e1065", text: "#c4b5fd" },
  { key: "emerald", bg: "#064e3b", text: "#6ee7b7" },
  { key: "gray",    bg: "#374151", text: "#9ca3af" },
  { key: "red",     bg: "#7f1d1d", text: "#fca5a5" },
  { key: "orange",  bg: "#431407", text: "#fb923c" },
  { key: "yellow",  bg: "#422006", text: "#fcd34d" },
  { key: "pink",    bg: "#500724", text: "#f9a8d4" },
  { key: "cyan",    bg: "#0c4a6e", text: "#7dd3fc" },
];

export const DEFAULT_SHIFTS: Shift[] = [
  { code: "D",   color: "blue"    },
  { code: "N",   color: "violet"  },
  { code: "AM",  color: "emerald" },
  { code: "Off", color: "gray"    },
];

export function useShifts(
  setSetting: (key: string, value: string) => Promise<void>
) {
  const shifts       = ref<Shift[]>(DEFAULT_SHIFTS.map(s => ({ ...s })));
  const newShiftCode = ref("");
  const shiftCycle   = computed(() => [...shifts.value.map(s => s.code), null]);

  function colorOf(key: string) {
    return COLOR_PALETTE.find(c => c.key === key) ?? COLOR_PALETTE[0];
  }

  function shiftStyleObj(code: string | null): Record<string, string> {
    if (!code) return {};
    const shift = shifts.value.find(s => s.code === code);
    const color = colorOf(shift?.color ?? "gray");
    return { backgroundColor: color.bg, color: color.text };
  }

  function countShift(row: { days: (string | null)[] }, code: string) {
    return row.days.filter(d => d === code).length;
  }

  function quotaStatus(
    row: { days: (string | null)[] },
    shift: Shift
  ): "over" | "under" | "met" | "none" {
    if (!shift.target) return "none";
    const actual = countShift(row, shift.code);
    if (actual > shift.target) return "over";
    if (actual < shift.target) return "under";
    return "met";
  }

  function totalShiftStaff(
    scheduleData: { days: (string | null)[] }[],
    di: number,
    code: string
  ) {
    return scheduleData.filter(r => r.days[di] === code).length;
  }

  async function saveShifts() {
    await setSetting("shifts", JSON.stringify(shifts.value));
  }

  function addShift() {
    const code = newShiftCode.value.trim().toUpperCase();
    if (!code || shifts.value.some(s => s.code === code)) return;
    const usedColors = shifts.value.map(s => s.color);
    const nextColor  = COLOR_PALETTE.find(c => !usedColors.includes(c.key))?.key ?? "blue";
    shifts.value.push({ code, color: nextColor });
    newShiftCode.value = "";
    saveShifts();
  }

  function removeShift(idx: number) {
    shifts.value.splice(idx, 1);
    saveShifts();
  }

  function cycleShiftColor(idx: number) {
    const cur = shifts.value[idx].color;
    const ci  = COLOR_PALETTE.findIndex(c => c.key === cur);
    shifts.value[idx].color = COLOR_PALETTE[(ci + 1) % COLOR_PALETTE.length].key;
    saveShifts();
  }

  return {
    shifts, newShiftCode, shiftCycle,
    colorOf, shiftStyleObj, countShift, quotaStatus, totalShiftStaff,
    saveShifts, addShift, removeShift, cycleShiftColor,
  };
}
