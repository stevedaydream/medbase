/**
 * 醫院 Excel 排班工具（9A值班表）的儲存格對照表。
 * 匯入（Excel → app）與過渡期匯出（app → 同位置的值）共用。
 */
import * as XLSX from "xlsx";

export const XL = {
  year: "G2",
  month: "J2",
  schedRows: [6, 17] as const,     // 排班區（人員列）
  preRows: [31, 42] as const,      // 預班區
  nameCol: "A",
  inactiveCol: "B",                // 非在職 X
  firstDayCol: 2,                  // C 欄 = 1 號（0-based index）
  holidayRow: 44,                  // 國假註記（預班區下方，排班區第 19 列為其鏡像）
  holidayMirrorRow: 19,
  staffing: {
    S1: "AX2", N: "AX3", D: "AX4",           // 當月人力：白班、夜班、白八
    S1b: "AY2", Nb: "AY3", Db: "AY4",        // 後半
    halfStart: "AZ2",                         // 後半起始日
  },
  flagCols: {
    active: "BJ", support: "BL", noD: "BU", noN: "BV", nightTransfer: "BW",
  },
  /** 配額項目 → [註記欄(V/X), 配額欄] */
  quotaCols: {
    D: ["BM", "BN"], N: ["BO", "BP"], OFF: ["BQ", "BR"], W6OFF: ["BS", "BT"],
  } as Record<string, [string, string]>,
} as const;

export const XL84 = {
  sheet: "8-4輪值",
  peopleRows: [4, 60] as const,    // 人員主檔：代號 A、姓名 B、分機 C、最近輪值日期 D、本月位置 E、狀態 F
  logHeaderText: "輪值日期",       // 永久輪值明細表頭（A 欄）
};

export const dayCol = (day: number) => XLSX.utils.encode_col(XL.firstDayCol + day - 1);

export function cellText(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr];
  if (!c || c.v == null) return "";
  return String(c.v).trim();
}

export function cellValue(ws: XLSX.WorkSheet, addr: string): unknown {
  return ws[addr]?.v;
}

/** Excel 序列日期 → YYYY-MM-DD */
export function serialToDate(v: unknown): string {
  if (typeof v !== "number") return "";
  const p = XLSX.SSF.parse_date_code(v);
  if (!p) return "";
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
