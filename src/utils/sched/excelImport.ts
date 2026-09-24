/**
 * 醫院 Excel 排班工具 → 排班 v3 的解析（純函式，不碰資料庫）。
 * 由 useSchedStore.applyImport 將結果寫成文件。
 */
import * as XLSX from "xlsx";
import { XL, XL84, dayCol, cellText, cellValue, serialToDate } from "./excelMap";
import { daysIn, dateStr } from "@/shared/sched/calendar";
import type { Flags, StaffingTable } from "@/shared/sched/types";

export interface ParsedPerson {
  letter: string;
  name: string;
  flags: Flags;
}

export interface ParsedMonth {
  ym: string;
  sheet: string;
  roster: ParsedPerson[];
  schedule: Record<string, string[]>;   // name → 每日
  prebook: Record<string, string[]>;
  holidays: string[];                   // 國假註記的日期
  staffing: { base: StaffingTable; halfStart: number | null; second: StaffingTable | null };
  markers: Record<string, { v: string | null; x: string | null }>; // 名字
  quotas: Record<string, Record<string, number>>;                  // name → item → 配額
  warnings: string[];
}

export interface Parsed84 {
  people: { code: string; name: string; ext: string; lastDate: string; exempt: boolean }[];
  log: { date: string; kind: string; code: string; name: string; unit: string; ym: string; status: string; note: string }[];
}

/** 工作表名稱是否為月份（YYYYMM，允許尾綴如 "202610 (2)" 不算） */
export function monthSheets(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames.filter(n => /^\d{6}$/.test(n)).sort();
}

const isMark = (s: string, m: string) => s.toUpperCase() === m;

/** 儲存格文字 → 班別代碼（大小寫統一、上課改公假） */
export function normalizeCode(raw: string, knownCodes: string[]): string {
  const s = raw.trim();
  if (!s) return "";
  if (s === "上課") return "公假";
  const hit = knownCodes.find(c => c.toUpperCase() === s.toUpperCase());
  return hit ?? s;
}

export function splitName(raw: string): { letter: string; name: string } {
  const m = raw.trim().match(/^([A-Za-z]{1,2})(.+)$/);
  return m ? { letter: m[1].toUpperCase(), name: m[2].trim() } : { letter: "", name: raw.trim() };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readTable(ws: XLSX.WorkSheet, s1: string, n: string, d: string): StaffingTable {
  const S1 = num(cellValue(ws, s1)), N = num(cellValue(ws, n)), D = num(cellValue(ws, d));
  // Excel 平日與週六同一組（AX5），週日／國定假日只要夜班＋白八
  return {
    weekday:  { D, N, S1 },
    saturday: { D, N, S1 },
    sunday:   { D, N, S1: 0 },
    holiday:  { D, N, S1: 0 },
  };
}

/**
 * Excel 的 V 可能被 X 蓋掉（餘數＝1 時同一格），此時由配額數值反推：
 * 多拿 1 的人在合格名單中成一段連續（環狀），V 為該段開頭；沒有多拿者則 V＝X 的下一位。
 */
export function inferV(eligible: string[], quota: Record<string, number>, x: string | null): string | null {
  if (!eligible.length) return null;
  const vals = eligible.map(n => quota[n] ?? 0);
  const base = Math.min(...vals);
  const plus = vals.map(v => v > base);
  if (!plus.some(Boolean)) {
    if (!x) return eligible[0];
    const i = eligible.indexOf(x);
    return eligible[(i + 1) % eligible.length];
  }
  for (let i = 0; i < eligible.length; i++) {
    const prev = (i - 1 + eligible.length) % eligible.length;
    if (plus[i] && !plus[prev]) return eligible[i];
  }
  return eligible[0];
}

export function parseMonthSheet(wb: XLSX.WorkBook, sheet: string, knownCodes: string[]): ParsedMonth {
  const ws = wb.Sheets[sheet];
  const warnings: string[] = [];
  const y = num(cellValue(ws, XL.year)), m = num(cellValue(ws, XL.month));
  const ym = y && m ? `${y}${String(m).padStart(2, "0")}` : sheet;
  if (ym !== sheet) warnings.push(`工作表 ${sheet} 的年月儲存格為 ${ym}`);
  const nd = daysIn(ym);

  const roster: ParsedPerson[] = [];
  const schedule: Record<string, string[]> = {};
  const prebook: Record<string, string[]> = {};
  const [s0, s1] = XL.schedRows;
  const pre0 = XL.preRows[0];
  const rowOfName: Record<string, number> = {};

  for (let r = s0; r <= s1; r++) {
    // 排班區 A 欄是公式（=A31），值即預班區姓名
    const raw = cellText(ws, `${XL.nameCol}${r}`) || cellText(ws, `${XL.nameCol}${pre0 + r - s0}`);
    if (!raw) continue;
    const { letter, name } = splitName(raw);
    const fc = XL.flagCols;
    const f = (col: string) => isMark(cellText(ws, `${col}${r}`), "V");
    const inactiveX = isMark(cellText(ws, `${XL.inactiveCol}${r}`), "X");
    const noD = f(fc.noD), noN = f(fc.noN);
    const flags: Flags = {
      active: f(fc.active) && !inactiveX,
      support: f(fc.support),
      noD, noN,
      nightTransfer: f(fc.nightTransfer),
      // Excel 隱含規則：不排 D＋不排 N → OFF 固定＝假日數且只休假日（v3 拆為獨立旗標）
      fixedHolidayOff: noD && noN,
      offHolidayOnly: noD && noN,
    };
    roster.push({ letter, name, flags });
    rowOfName[name] = r;

    const days: string[] = [], pre: string[] = [];
    for (let d = 1; d <= nd; d++) {
      days.push(normalizeCode(cellText(ws, `${dayCol(d)}${r}`), knownCodes));
      pre.push(normalizeCode(cellText(ws, `${dayCol(d)}${pre0 + r - s0}`), knownCodes));
    }
    schedule[name] = days;
    prebook[name] = pre;
  }

  const holidays: string[] = [];
  for (let d = 1; d <= nd; d++) {
    const a = cellText(ws, `${dayCol(d)}${XL.holidayRow}`) || cellText(ws, `${dayCol(d)}${XL.holidayMirrorRow}`);
    if (a.includes("國")) holidays.push(dateStr(ym, d));
  }

  const st = XL.staffing;
  const base = readTable(ws, st.S1, st.N, st.D);
  const hs = num(cellValue(ws, st.halfStart));
  const halfStart = hs >= 2 && hs <= nd ? hs : null;
  const second = halfStart ? readTable(ws, st.S1b, st.Nb, st.Db) : null;

  const quotas: Record<string, Record<string, number>> = {};
  const markers: Record<string, { v: string | null; x: string | null }> = {};
  for (const p of roster) quotas[p.name] = {};
  for (const [item, [mc, qc]] of Object.entries(XL.quotaCols)) {
    let v: string | null = null, x: string | null = null;
    for (const p of roster) {
      const r = rowOfName[p.name];
      const mk = cellText(ws, `${mc}${r}`).toUpperCase();
      if (mk === "V") v = p.name;
      if (mk === "X") x = p.name;
      quotas[p.name][item] = num(cellValue(ws, `${qc}${r}`));
    }
    if (!v) {
      const eligible = roster.filter(p => eligibleFor(item, p.flags)).map(p => p.name);
      v = inferV(eligible, Object.fromEntries(roster.map(p => [p.name, quotas[p.name][item]])), x);
      if (v) warnings.push(`${item} 欄沒有 V（被 X 覆蓋），由配額數值推得 V＝${v}`);
    }
    markers[item] = { v, x };
  }

  return { ym, sheet, roster, schedule, prebook, holidays, staffing: { base, halfStart, second }, markers, quotas, warnings };
}

/** Excel 各配額欄的合格條件（DistributeQuota），只用於匯入時反推 V */
function eligibleFor(item: string, f: Flags): boolean {
  if (!f.active) return false;
  if (item === "D") return !f.noD;
  if (item === "N") return !f.noN;
  if (item === "OFF") return !f.support && !f.fixedHolidayOff;
  return !f.support;
}

export function parse84(wb: XLSX.WorkBook): Parsed84 | null {
  const ws = wb.Sheets[XL84.sheet];
  if (!ws) return null;
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const people: Parsed84["people"] = [];
  let logStart = -1;
  for (let r = XL84.peopleRows[0]; r <= range.e.r + 1; r++) {
    const a = cellText(ws, `A${r}`);
    if (a === XL84.logHeaderText) { logStart = r + 1; break; }
    const name = cellText(ws, `B${r}`);
    if (!a || !name || !/^[A-Za-z]{1,2}$/.test(a)) continue;
    people.push({
      code: a.toUpperCase(), name, ext: cellText(ws, `C${r}`),
      lastDate: serialToDate(cellValue(ws, `D${r}`)),
      exempt: cellText(ws, `F${r}`).includes("免"),
    });
  }
  const log: Parsed84["log"] = [];
  if (logStart > 0) {
    for (let r = logStart; r <= range.e.r + 1; r++) {
      const date = serialToDate(cellValue(ws, `A${r}`));
      if (!date) continue;
      log.push({
        date, kind: cellText(ws, `B${r}`), code: cellText(ws, `C${r}`).toUpperCase(),
        name: cellText(ws, `D${r}`), unit: cellText(ws, `F${r}`), ym: cellText(ws, `G${r}`),
        status: cellText(ws, `I${r}`), note: cellText(ws, `J${r}`),
      });
    }
  }
  return { people, log };
}
