/**
 * 匯出（schedular.md §13）：
 * - buildAppWorkbook：app 班表格式（5 列表頭、日期、星期、各配額實際數、放假人數）＋ 8-4／春節輪值明細
 * - buildPositionalSheet：過渡期「Excel 完整格式」——值放在醫院活頁簿相同儲存格（與匯入共用 excelMap）
 */
import * as XLSX from "xlsx";
import type { MonthDoc, PrebookDoc, HolidayDoc, QuotaItem, Person, Duty84Doc, CnyDoc } from "./types";
import { cellKey } from "./types";
import { XL, dayCol } from "./excelMap";
import { daysIn, dateStr, dowOf, ymParts, ymOfDate, WEEKDAY_LABEL } from "./calendar";

export interface ExportCtx {
  month: MonthDoc;
  prebook: PrebookDoc | undefined;
  holidays: HolidayDoc;
  items: QuotaItem[];
  people: Person[];
  quotas: Record<string, Record<string, number>>;
  counts: Record<string, Record<string, number>>;   // personId → 項目 → 實際
  hours: Record<string, number>;
  offSlots: number[];
  offCount: number[];                                 // 每日實際休假人數
  duty84: Duty84Doc;
  cny: CnyDoc;
}

/** 依本月順序產生 Excel 字母代號（B、C、D…） */
export function letterOf(index: number): string {
  return XLSX.utils.encode_col(index + 1);
}

const nameOf = (people: Person[], id: string) => people.find(p => p.id === id)?.name ?? "?";

function toSerial(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

export function buildAppWorkbook(c: ExportCtx): XLSX.WorkBook {
  const m = c.month, nd = daysIn(m.ym);
  const { y, m: mo } = ymParts(m.ym);
  const roster = m.roster.filter(r => r.flags.active);
  const statCols = [...c.items.map(i => i.name), "總時"];
  const width = 1 + nd + 1 + statCols.length;
  const blank = () => Array<string | number | null>(width).fill(null);
  const sep = 1 + nd, stat0 = sep + 1;

  const r0 = blank(); r0[0] = "外科"; r0[3] = "年"; r0[5] = y; r0[6] = `(${y - 1911} 年 )`; r0[8] = mo; r0[9] = "月";
  const r1 = blank(); r1[0] = "特殊日期標註";
  const r2 = blank(); r2[0] = "日期";
  const r3 = blank(); r3[0] = "星期";
  for (let d = 1; d <= nd; d++) {
    const ds = dateStr(m.ym, d), dw = dowOf(m.ym, d);
    r1[d] = c.holidays.days[ds] ?? (dw === 6 ? "休息日" : dw === 0 ? "例假日" : "");
    r2[d] = toSerial(ds);
    r3[d] = WEEKDAY_LABEL[dw];
  }
  const r4 = blank(); r4[0] = "姓名";
  statCols.forEach((s, i) => { r4[stat0 + i] = s; });

  const rows = roster.map((r, i) => {
    const row = blank();
    row[0] = `${letterOf(i)}${nameOf(c.people, r.personId)}`;
    for (let d = 1; d <= nd; d++) row[d] = m.schedule[r.personId]?.[d - 1] ?? "";
    c.items.forEach((it, k) => {
      const act = c.counts[r.personId]?.[it.id] ?? 0, t = c.quotas[r.personId]?.[it.id];
      row[stat0 + k] = t === undefined || t === act ? act : `${act}/${t}`;
    });
    row[stat0 + c.items.length] = c.hours[r.personId] ?? 0;
    return row;
  });
  const off = blank(); off[0] = "放假人數";
  const cap = blank(); cap[0] = "可休人數";
  for (let d = 1; d <= nd; d++) { off[d] = c.offCount[d - 1]; cap[d] = c.offSlots[d - 1]; }

  const ws = XLSX.utils.aoa_to_sheet([r0, r1, r2, r3, r4, ...rows, off, cap]);
  for (let d = 1; d <= nd; d++) {
    const a = XLSX.utils.encode_cell({ r: 2, c: d });
    if (ws[a]) ws[a].z = "d";
  }
  ws["!cols"] = [{ wch: 10 }, ...Array.from({ length: nd }, () => ({ wch: 4.5 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Schedule_${m.ym}`);
  XLSX.utils.book_append_sheet(wb, rotationSheet(c), "8-4與春節輪值");
  return wb;
}

function rotationSheet(c: ExportCtx): XLSX.WorkSheet {
  const ym = c.month.ym;
  const who = (id: string | null) => c.people.find(p => p.id === id);
  const rows: (string | number)[][] = [["日期", "類型", "班別", "代號", "姓名", "單位", "分機"]];
  for (const e of c.duty84.log.filter(x => ymOfDate(x.date) === ym)) {
    const p = who(e.personId);
    rows.push([e.date, e.kind, "8-4", p?.code84 ?? "", p?.name ?? "（未排）", p?.unit || "外單位", p?.ext ?? ""]);
  }
  for (const e of c.cny.log.filter(x => ymOfDate(x.date) === ym)) {
    for (const [code, id] of [["D", e.D], ["N", e.N]] as const) {
      const p = who(id);
      rows.push([e.date, "春節", code, p?.code84 ?? "", p?.name ?? "（未排）", p?.unit || "外單位", p?.ext ?? ""]);
    }
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

/** 過渡期：值放在醫院活頁簿相同儲存格，可整塊複製貼回 */
export function buildPositionalSheet(c: ExportCtx): XLSX.WorkSheet {
  const m = c.month, nd = daysIn(m.ym);
  const { y, m: mo } = ymParts(m.ym);
  const ws: XLSX.WorkSheet = {};
  const put = (addr: string, v: string | number) => { ws[addr] = typeof v === "number" ? { t: "n", v } : { t: "s", v }; };
  put(XL.year, y);
  put(XL.month, mo);
  const [s0, s1] = XL.schedRows, [p0] = XL.preRows;
  const V = (b: boolean) => (b ? "V" : "");
  m.roster.slice(0, s1 - s0 + 1).forEach((r, i) => {
    const row = s0 + i, pre = p0 + i;
    const label = `${letterOf(i)}${nameOf(c.people, r.personId)}`;
    put(`${XL.nameCol}${row}`, label);
    put(`${XL.nameCol}${pre}`, label);
    if (!r.flags.active) put(`${XL.inactiveCol}${row}`, "X");
    const f = XL.flagCols;
    if (r.flags.active) put(`${f.active}${row}`, "V");
    for (const [k, col] of [["support", f.support], ["noD", f.noD], ["noN", f.noN], ["nightTransfer", f.nightTransfer]] as const) {
      if (r.flags[k]) put(`${col}${row}`, V(true));
    }
    for (let d = 1; d <= nd; d++) {
      const v = m.schedule[r.personId]?.[d - 1] ?? "";
      if (v) put(`${dayCol(d)}${row}`, v);
      const pv = c.prebook?.cells[cellKey(r.personId, d)]?.v ?? "";
      if (pv) put(`${dayCol(d)}${pre}`, pv);
    }
    for (const [item, [mc, qc]] of Object.entries(XL.quotaCols)) {
      const q = c.quotas[r.personId]?.[item];
      if (q !== undefined) put(`${qc}${row}`, q);
      const mk = m.markers[item];
      // Excel 同格只能放一個標記：V 與 X 同人時放 X（與原活頁簿行為相同）
      if (mk?.x === r.personId) put(`${mc}${row}`, "X");
      else if (mk?.v === r.personId) put(`${mc}${row}`, "V");
    }
  });
  const st = XL.staffing, b = m.staffing.base.weekday, sun = m.staffing.base.sunday;
  put(st.S1, b.S1); put(st.N, sun.N); put(st.D, sun.D);
  const rg = m.staffing.ranges[0];
  if (rg) {
    const t = rg.table;
    put(st.S1b, t.weekday.S1); put(st.Nb, t.sunday.N); put(st.Db, t.sunday.D); put(st.halfStart, rg.from);
  }
  for (let d = 1; d <= nd; d++) {
    if (dateStr(m.ym, d) in c.holidays.days) put(`${dayCol(d)}${XL.holidayRow}`, "國");
  }
  ws["!ref"] = "A1:BW44";
  return ws;
}

export function buildPositionalWorkbook(c: ExportCtx): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildPositionalSheet(c), c.month.ym);
  return wb;
}
