/**
 * 排班系統 v3 領域型別與預設值（ADR-014，設計書 schedular.md v3）。
 * 所有狀態以「文件」為單位存放：全域文件（人員、班別、配額項目…）與每月文件（month / prebook）。
 */

export type Role = "super" | "scheduler" | "employee";

/** 全外科 NP 名單（人員主檔），8-4 與春節共用順序 */
export interface Person {
  id: string;
  name: string;
  unit: string;        // 所屬單位，例 "9A"
  ext: string;
  his: string;         // HIS 帳號（登入、手機對應）
  role: Role;
  code84: string;      // 8-4 輪值表代號（A–X）
  order: number;       // 8-4／春節輪序順序
  exempt84: boolean;
  exemptCny: boolean;
  active: boolean;
}

export type DayType = "weekday" | "saturday" | "sunday" | "holiday";
export const DAY_TYPES: { key: DayType; label: string }[] = [
  { key: "weekday",  label: "平日" },
  { key: "saturday", label: "週六" },
  { key: "sunday",   label: "週日" },
  { key: "holiday",  label: "國定假日" },
];

export type ShiftCategory = "D" | "N" | "OFF" | "S1" | "H3" | "OTHER";

export interface ShiftDef {
  code: string;
  name: string;
  color: string;       // COLOR_PALETTE key（palette.ts）
  hotkey: string;      // 鍵盤快速鍵（單一字元，可空）
  hours: number;
  staffing: boolean;   // 佔當日上班人力
  takesOff: boolean;   // 佔當日休假名額
  reducesOff: boolean; // 使當日可休 −1（離開單位，例 8-4）
  isRest: boolean;     // 算休息日（中斷連續上班）
  category: ShiftCategory;
}

/** 空白格：平日＝S1、週六＝H3；週日／國定假日不允許空白 */
export const BLANK_BY_DAYTYPE: Record<DayType, string | null> = {
  weekday: "S1", saturday: "H3", sunday: null, holiday: null,
};

export const DEFAULT_SHIFTS: ShiftDef[] = [
  { code: "D",    name: "白八",   color: "blue",    hotkey: "d", hours: 12, staffing: true,  takesOff: false, reducesOff: false, isRest: false, category: "D" },
  { code: "NrsD", name: "NrsD",   color: "cyan",    hotkey: "",  hours: 12, staffing: true,  takesOff: false, reducesOff: false, isRest: false, category: "D" },
  { code: "N",    name: "夜班",   color: "violet",  hotkey: "n", hours: 12, staffing: true,  takesOff: false, reducesOff: false, isRest: false, category: "N" },
  { code: "S1",   name: "正常班", color: "emerald", hotkey: "s", hours: 8,  staffing: true,  takesOff: false, reducesOff: false, isRest: false, category: "S1" },
  { code: "H3",   name: "週六半天", color: "yellow", hotkey: "h", hours: 4,  staffing: true,  takesOff: false, reducesOff: false, isRest: false, category: "H3" },
  { code: "OFF",  name: "休假",   color: "gray",    hotkey: "o", hours: 0,  staffing: false, takesOff: true,  reducesOff: false, isRest: true,  category: "OFF" },
  { code: "公假", name: "公假",   color: "pink",    hotkey: "g", hours: 8,  staffing: false, takesOff: true,  reducesOff: false, isRest: false, category: "OFF" },
  { code: "8-4",  name: "8-4 輪值", color: "orange", hotkey: "8", hours: 8,  staffing: false, takesOff: false, reducesOff: true,  isRest: false, category: "OTHER" },
];

/** 預班限制註記（不是班別） */
export const CONSTRAINT_MARKS = ["勿休", "勿值"] as const;
export type ConstraintMark = typeof CONSTRAINT_MARKS[number];

// ── 每月人員旗標 ──────────────────────────────────────────────────────
export interface Flags {
  active: boolean;
  support: boolean;
  noD: boolean;
  noN: boolean;
  nightTransfer: boolean;
  fixedHolidayOff: boolean;
  offHolidayOnly: boolean;
}
export type FlagKey = keyof Flags;
export const FLAG_DEFS: { key: FlagKey; label: string; short: string }[] = [
  { key: "active",          label: "在職",              short: "職" },
  { key: "support",         label: "支援人員",          short: "支" },
  { key: "noD",             label: "不排 D",            short: "⊘D" },
  { key: "noN",             label: "不排 N",            short: "⊘N" },
  { key: "nightTransfer",   label: "夜班配額轉出",      short: "N→" },
  { key: "fixedHolidayOff", label: "OFF 固定＝假日數",  short: "固休" },
  { key: "offHolidayOnly",  label: "OFF 只能排在假日",  short: "假休" },
];
export const emptyFlags = (): Flags => ({
  active: true, support: false, noD: false, noN: false,
  nightTransfer: false, fixedHolidayOff: false, offHolidayOnly: false,
});

// ── 配額項目（super 設定）─────────────────────────────────────────────
/** 總數來源：D／N＝每日需求加總；OFF＝每日可休加總（可限星期幾） */
export type QuotaTotalSource = "D" | "N" | "OFF";
export interface QuotaItem {
  id: string;
  name: string;
  enabled: boolean;
  total: QuotaTotalSource;
  dow: number[] | null;      // 只算這些星期幾（0=日…6=六）；null＝全部
  countShifts: string[];     // 實際統計哪些班別
  exclude: FlagKey[];        // 這些旗標的人不參與
}
export const DEFAULT_QUOTA_ITEMS: QuotaItem[] = [
  { id: "D",     name: "D",       enabled: true, total: "D",   dow: null, countShifts: ["D", "NrsD"],  exclude: ["noD"] },
  { id: "N",     name: "N",       enabled: true, total: "N",   dow: null, countShifts: ["N"],          exclude: ["noN"] },
  { id: "OFF",   name: "OFF",     enabled: true, total: "OFF", dow: null, countShifts: ["OFF", "公假"], exclude: ["support"] },
  { id: "W6OFF", name: "週六 OFF", enabled: true, total: "OFF", dow: [6],  countShifts: ["OFF"],        exclude: ["support"] },
];

// ── 檢核規則參數（super 設定）─────────────────────────────────────────
export interface RuleParams {
  maxConsecutiveWork: number;   // 1 連續上班上限
  maxConsecutiveDuty: number;   // 2 連續值班上限
  nightNextOnlyNOrOff: boolean; // 11 N 隔天只能 N 或 OFF
  revertHours: number;          // 發布後可退回時數
  disabled: string[];           // 關閉的規則代碼
}
export const DEFAULT_RULES: RuleParams = {
  maxConsecutiveWork: 6,
  maxConsecutiveDuty: 5,
  nightNextOnlyNOrOff: true,
  revertHours: 48,
  disabled: [],
};

// ── 人力表 ────────────────────────────────────────────────────────────
export interface Need { D: number; N: number; S1: number }
export type StaffingTable = Record<DayType, Need>;
export const DEFAULT_STAFFING: StaffingTable = {
  weekday:  { D: 1, N: 1, S1: 4 },
  saturday: { D: 1, N: 1, S1: 4 },
  sunday:   { D: 1, N: 1, S1: 0 },
  holiday:  { D: 1, N: 1, S1: 0 },
};
export interface StaffingRange { from: number; to: number; table: StaffingTable } // 日（1-based，含）
export interface Staffing {
  base: StaffingTable;
  ranges: StaffingRange[];
  dayAdjust: Record<number, number>;  // 單日可休微調（日 → ±n）
}

// ── 國定假日 ──────────────────────────────────────────────────────────
export interface HolidayDoc {
  days: Record<string, string>;      // "YYYY-MM-DD" → 名稱
  workdays: string[];                // 補班日（視為平日）
  cny: { from: string; to: string }[]; // 春節輪值區間
}

/** 國定假日抽籤結果：年 → 日期 → D/N 人員 id */
export type HolidayDutyDoc = Record<string, Record<string, { D?: string | null; N?: string | null }>>;

// ── 8-4 與春節 ────────────────────────────────────────────────────────
export interface Duty84Entry {
  date: string;          // YYYY-MM-DD
  personId: string | null;
  kind: string;          // 一般週日／連假末日／手動
  manual: boolean;       // 手動指定人選（重算時保留）
  note: string;
}
export interface Duty84Doc {
  log: Duty84Entry[];
  removedDates: string[]; // 手動刪除的自動日期
  addedDates: string[];   // 手動新增的日期
}
export interface CnyDoc {
  lastD: Record<string, string | null>; // 春節年度 → 最後一天 D 的人（第一天 N 接續用）
  log: { date: string; D: string | null; N: string | null }[];
}

/** 操作紀錄：每月一份（log:YYYYMM），全域設定類存 log:global */
export interface LogEntry {
  at: string;           // ISO
  actor: string;        // "system" 或操作者姓名
  action: string;       // 例：重新計算、改格、開始排班
  detail: string;
}
export interface LogDoc { key: string; entries: LogEntry[] }

/** 員工畫面用的衍生文件（est:YYYYMM）：月份狀態、每日可休、預估配額 */
export interface EstDoc {
  ym: string;
  status: MonthStatus;
  offSlots: number[];
  quotas: Record<string, Record<string, number>>;
  items: { id: string; name: string }[];
  updatedAt: string;
}

/** 通知（預班被覆蓋、被代改、發布、發布後異動）；personId 為收件人，雲端 notices 文件 */
export interface NoticeItem {
  id: string;
  personId: string;
  at: string;
  text: string;
  read: boolean;
  sent: boolean;
}

// ── 每月文件 ──────────────────────────────────────────────────────────
export type MonthStatus = "open" | "scheduling" | "published";
export interface RosterEntry { personId: string; flags: Flags }
export type CellOrigin = "" | "pre" | "sys";
export interface WeekendPointers { wkN: string | null; satD: string | null; sunD: string | null }

export interface MonthDoc {
  ym: string;                             // "202611"
  status: MonthStatus;
  roster: RosterEntry[];
  staffing: Staffing;
  schedule: Record<string, string[]>;     // personId → 每日班別（index 0 = 1 號；"" = 空白）
  origin: Record<string, CellOrigin[]>;
  markers: Record<string, { v: string | null; x: string | null }>; // 配額項目 → V／X
  frozenQuotas: Record<string, Record<string, number>> | null;     // 發布時定案
  weekend: { start: WeekendPointers; end: WeekendPointers | null };
  startedAt: string | null;
  publishedAt: string | null;
  imported: boolean;
  swaps?: SwapRec[];                      // 換班紀錄（同日兩人互換）
  changeLog?: ChangeRec[];                // 發布後異動紀錄
}

/** 換班：同一天兩人互換班別（跨日換班＝兩筆；跨月未抵銷者成為欠班） */
export interface SwapRec {
  id: string;
  day: number;
  a: string;        // personId
  b: string;
  aCode: string;    // 互換前 a 的班別
  bCode: string;
  at: string;
  by: string;
  note: string;
}

/** 發布後修改（必填原因） */
export interface ChangeRec {
  at: string;
  by: string;
  personId: string;
  day: number;
  from: string;
  to: string;
  reason: string;
  approved: boolean; // 核准偏離：此人配額不符不再警告
}

/** 欠班：from 欠 to（to 多上了 from 的班），依配額項目計 */
export interface DebtRec {
  id: string;
  from: string;
  to: string;
  item: string;
  qty: number;
  ym: string;
  settledAt: string | null;
  note: string;
}

/** 排班鎖（每月一份，lock:YYYYMM） */
export interface LockInfo {
  his: string;
  name: string;
  machine: string;
  at: string;
}

export interface PrebookCell {
  v: string | null;       // 班別或限制註記；null＝已刪除（墓碑）
  src: "emp" | "sys";
  by: string;             // HIS 帳號或 "system"
  at: string;             // ISO 時間
  reason?: string;
}
export interface PrebookDoc {
  ym: string;
  cells: Record<string, PrebookCell>;     // key = `${personId}|${day}`
}

export const cellKey = (personId: string, day: number) => `${personId}|${day}`;

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyMonth(ym: string): MonthDoc {
  return {
    ym, status: "open", roster: [],
    staffing: { base: structuredClone(DEFAULT_STAFFING), ranges: [], dayAdjust: {} },
    schedule: {}, origin: {}, markers: {}, frozenQuotas: null,
    weekend: { start: { wkN: null, satD: null, sunD: null }, end: null },
    startedAt: null, publishedAt: null, imported: false, swaps: [], changeLog: [],
  };
}

/** 深拷貝（可用於 Vue reactive 物件；structuredClone 無法複製 Proxy） */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
