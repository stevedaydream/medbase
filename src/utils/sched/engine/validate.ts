/**
 * 排班統計與檢核（schedular.md §8；只警告不阻擋）。
 */
import type { MonthDoc, PrebookDoc, HolidayDoc, ShiftDef, QuotaItem, RuleParams } from "../types";
import { BLANK_BY_DAYTYPE, cellKey } from "../types";
import { daysIn, dayTypeOf, dowOf, dateStr, inCny } from "../calendar";
import { needOf } from "./staffing";

export type RuleCode = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12";
export const RULE_LABELS: Record<RuleCode, string> = {
  R1: "連續上班超過上限",
  R2: "連續值班超過上限",
  R3: "預班勿休卻排休",
  R4: "預班勿值卻排值班",
  R5: "違反不排 D／不排 N",
  R6: "OFF 只能排在假日",
  R7: "每日人力不符",
  R8: "休假人數超過可休",
  R9: "配額不符",
  R10: "週日／國定假日空白",
  R11: "N 隔天只能 N 或 OFF",
  R12: "覆蓋預班或預填",
};

export interface Issue {
  rule: RuleCode;
  personId: string | null;
  day: number | null;
  message: string;
}

export interface GridCtx {
  month: MonthDoc;
  prebook: PrebookDoc | undefined;
  holidays: HolidayDoc;
  shifts: ShiftDef[];
  items: QuotaItem[];
  rules: RuleParams;
  /** 目前顯示／檢核的格子（排班層或預班層） */
  cell: (personId: string, day: number) => string;
  /** 上月最後幾天（連續上班跨月），personId → 由舊到新 */
  prevTail?: Record<string, string[]>;
  /** 每人各項目的目標（配額＋換班調整） */
  targets?: Record<string, Record<string, number>>;
  offSlots: number[];
  name: (personId: string) => string;
  /** 發布後修改時「核准偏離」的人：配額不符不警告 */
  approved?: Set<string>;
}

export function shiftMap(shifts: ShiftDef[]): Map<string, ShiftDef> {
  return new Map(shifts.map(s => [s.code, s]));
}

/** 空白格依日類型補預設班別（平日 S1、週六 H3） */
export function effectiveCode(ctx: Pick<GridCtx, "month" | "holidays" | "cell">, personId: string, day: number): string {
  const v = ctx.cell(personId, day);
  if (v) return v;
  return BLANK_BY_DAYTYPE[dayTypeOf(ctx.month.ym, day, ctx.holidays)] ?? "";
}

export interface PersonStats {
  counts: Record<string, number>;   // 配額項目 → 實際
  hours: number;
  byCode: Record<string, number>;
}

export function personStats(ctx: GridCtx, personId: string): PersonStats {
  const sm = shiftMap(ctx.shifts);
  const counts: Record<string, number> = {};
  const byCode: Record<string, number> = {};
  let hours = 0;
  const nd = daysIn(ctx.month.ym);
  for (const it of ctx.items) counts[it.id] = 0;
  for (let d = 1; d <= nd; d++) {
    const raw = ctx.cell(personId, d);
    const eff = effectiveCode(ctx, personId, d);
    if (eff) byCode[eff] = (byCode[eff] ?? 0) + 1;
    hours += sm.get(eff)?.hours ?? 0;
    for (const it of ctx.items) {
      if (it.dow && !it.dow.includes(dowOf(ctx.month.ym, d))) continue;
      if (raw && it.countShifts.includes(raw)) counts[it.id]++;
    }
  }
  return { counts, hours, byCode };
}

export interface DayStats { D: number; N: number; S1: number; off: number }

export function dayStats(ctx: GridCtx, day: number): DayStats {
  const sm = shiftMap(ctx.shifts);
  const st: DayStats = { D: 0, N: 0, S1: 0, off: 0 };
  for (const r of ctx.month.roster) {
    if (!r.flags.active) continue;
    const s = sm.get(effectiveCode(ctx, r.personId, day));
    if (!s) continue;
    if (s.takesOff) st.off++;
    if (!s.staffing) continue;
    if (s.category === "D") st.D++;
    else if (s.category === "N") st.N++;
    else if (s.category === "S1" || s.category === "H3") { if (!r.flags.support) st.S1++; }
  }
  return st;
}

export function validate(ctx: GridCtx): Issue[] {
  const { month: m, holidays: h, rules } = ctx;
  const off = new Set(rules.disabled);
  const on = (r: RuleCode) => !off.has(r);
  const sm = shiftMap(ctx.shifts);
  const nd = daysIn(m.ym);
  const out: Issue[] = [];
  const scheduling = m.status !== "open";
  const d2 = (d: number) => `${Number(m.ym.slice(4))}/${d}`;

  for (const r of m.roster) {
    if (!r.flags.active) continue;
    const id = r.personId, nm = ctx.name(id);
    const tail = ctx.prevTail?.[id] ?? [];
    let work = 0, duty = 0;
    // 跨月：先吃上月尾巴
    for (const c of tail) {
      const s = sm.get(c);
      work = !c || s?.isRest ? 0 : work + 1;
      duty = s && (s.category === "D" || s.category === "N") ? duty + 1 : 0;
    }
    for (let d = 1; d <= nd; d++) {
      const raw = ctx.cell(id, d);
      const eff = effectiveCode(ctx, id, d);
      const s = sm.get(eff);
      const dt = dayTypeOf(m.ym, d, h);
      const pre = ctx.prebook?.cells[cellKey(id, d)]?.v ?? "";

      work = !eff || s?.isRest ? 0 : work + 1;
      if (on("R1") && scheduling && work === rules.maxConsecutiveWork + 1) {
        out.push({ rule: "R1", personId: id, day: d, message: `${nm} 至 ${d2(d)} 已連續上班 ${work} 天（上限 ${rules.maxConsecutiveWork}）` });
      }
      const isDuty = s && (s.category === "D" || s.category === "N");
      duty = isDuty ? duty + 1 : 0;
      if (on("R2") && scheduling && duty === rules.maxConsecutiveDuty + 1) {
        out.push({ rule: "R2", personId: id, day: d, message: `${nm} 至 ${d2(d)} 已連續值班 ${duty} 天（上限 ${rules.maxConsecutiveDuty}）` });
      }
      if (on("R3") && pre === "勿休" && s?.category === "OFF") {
        out.push({ rule: "R3", personId: id, day: d, message: `${nm} ${d2(d)} 預班勿休，卻排了 ${eff}` });
      }
      if (on("R4") && pre === "勿值" && isDuty) {
        out.push({ rule: "R4", personId: id, day: d, message: `${nm} ${d2(d)} 預班勿值，卻排了 ${eff}` });
      }
      if (on("R5") && ((r.flags.noD && s?.category === "D") || (r.flags.noN && s?.category === "N"))) {
        out.push({ rule: "R5", personId: id, day: d, message: `${nm} 不排 ${s!.category}，${d2(d)} 卻排了 ${eff}` });
      }
      if (on("R6") && r.flags.offHolidayOnly && s?.category === "OFF" && s.isRest && dt === "weekday") {
        out.push({ rule: "R6", personId: id, day: d, message: `${nm} OFF 只能排在假日，${d2(d)} 是平日` });
      }
      if (on("R10") && scheduling && !eff && (dt === "sunday" || dt === "holiday")) {
        out.push({ rule: "R10", personId: id, day: d, message: `${nm} ${d2(d)} 是${dt === "sunday" ? "週日" : "國定假日"}，不可空白` });
      }
      if (on("R11") && scheduling && rules.nightNextOnlyNOrOff && s?.category === "N" && d < nd) {
        const next = sm.get(effectiveCode(ctx, id, d + 1));
        if (!next || !(next.category === "N" || (next.category === "OFF" && next.isRest))) {
          out.push({ rule: "R11", personId: id, day: d + 1, message: `${nm} ${d2(d)} 上 N，隔天排了 ${effectiveCode(ctx, id, d + 1) || "空白"}` });
        }
      }
      if (on("R12") && scheduling && pre && pre !== "勿休" && pre !== "勿值" && raw !== pre) {
        out.push({ rule: "R12", personId: id, day: d, message: `${nm} ${d2(d)} 預班／預填為 ${pre}，目前排 ${raw || "空白"}` });
      }
    }
    if (on("R9") && scheduling && ctx.targets?.[id] && !ctx.approved?.has(id)) {
      const st = personStats(ctx, id);
      for (const it of ctx.items) {
        const t = ctx.targets[id][it.id];
        if (t === undefined || st.counts[it.id] === t) continue;
        out.push({ rule: "R9", personId: id, day: null, message: `${nm} ${it.name} ${st.counts[it.id]}／配額 ${t}` });
      }
    }
  }

  for (let d = 1; d <= nd; d++) {
    const ds = dayStats(ctx, d);
    if (on("R8") && ds.off > ctx.offSlots[d - 1]) {
      out.push({ rule: "R8", personId: null, day: d, message: `${d2(d)} 休假 ${ds.off} 人，可休 ${ctx.offSlots[d - 1]} 人` });
    }
    if (on("R7") && scheduling && !inCny(h, dateStr(m.ym, d))) {
      const need = needOf(m, d, h);
      const diff = (["D", "N", "S1"] as const).filter(k => ds[k] !== need[k]).map(k => `${k} ${ds[k]}／${need[k]}`);
      if (diff.length) out.push({ rule: "R7", personId: null, day: d, message: `${d2(d)} 人力不符：${diff.join("、")}` });
    }
  }
  return out;
}
