/**
 * 備份群組與資料表的唯一對照（ADR-023）。
 * 每張資料表都必須歸到某個群組，或列在 EXCLUDED_TABLES／LEGACY_TABLES；
 * backupRegistry.test.ts 會比對 db/index.ts 的 CREATE TABLE，漏列時測試失敗。
 * 完整快照不看這份清單（整個資料庫都會備份），這裡只決定群組匯出／匯入與清空。
 */
export interface BackupGroup {
  key: string;
  label: string;
  icon: string;
  desc: string;
  tables: string[];
  /** 預設不勾選（例如含病人資料） */
  optIn?: boolean;
}

export const BACKUP_GROUPS: BackupGroup[] = [
  { key: "clinical",   label: "臨床資料",     icon: "🩺", desc: "處方、術式、疾病、檢查、SDM 範本",
    tables: ["prescriptions", "surgery", "disease", "examination", "sdm_templates"] },
  { key: "care",       label: "處置與手冊",   icon: "📘", desc: "危急處置卡、工作手冊、規則備忘錄",
    tables: ["emergency_protocols", "handbook", "shift_memos"] },
  { key: "items",      label: "自費耗材",     icon: "📦", desc: "品項、品項科別、手術術式與術式品項",
    tables: ["items", "item_depts", "surgery_types", "surgery_type_items"] },
  { key: "sets",       label: "手術套組",     icon: "🗂", desc: "套組與套組品項",
    tables: ["sets", "set_items"] },
  { key: "contacts",   label: "通訊錄",       icon: "👤", desc: "人員（含 HIS 帳密）、常用分機",
    tables: ["physicians", "contacts"] },
  { key: "scheduler",  label: "排班",         icon: "📅", desc: "排班使用者、排班 v3 文件",
    tables: ["scheduler_users", "sched_docs"] },
  { key: "npDuty",     label: "NP／VS 值班",  icon: "🌙", desc: "值班月份與值班明細",
    tables: ["np_duty_months", "np_duty_assignments"] },
  { key: "acp",        label: "ACP 評估",     icon: "📋", desc: "評估集、項目與紀錄",
    tables: ["acp_sets", "acp_items", "acp_records"] },
  { key: "ahk",        label: "AHK",          icon: "⌨", desc: "腳本元資料與套組（不含硬碟上的 .ahk 檔）",
    tables: ["ahk_scripts", "ahk_groups", "ahk_group_scripts"] },
  { key: "research",   label: "論文專案",     icon: "🎓", desc: "專案、作者、期刊、投稿、審查、稿件與圖片",
    tables: [
      "research_users", "research_authors", "research_journals",
      "research_checklist_templates", "research_checklist_template_items",
      "research_projects", "research_project_authors", "research_project_journals",
      "research_project_checklists", "research_project_checklist_items",
      "research_submissions", "research_submission_events", "research_review_rounds", "research_review_comments",
      "research_refs", "research_manuscript_sections", "research_manuscript_assets",
    ] },
  { key: "noteTemplates", label: "病歷潤飾範本", icon: "📝", desc: "潤飾格式與提示詞",
    tables: ["note_templates"] },
  { key: "notePatients",  label: "病歷潤飾紀錄（含病人資料）", icon: "🔒", desc: "病歷號、姓名、床號與病歷內文",
    tables: ["note_records"], optIn: true },
  { key: "settings",   label: "程式設定",     icon: "⚙️", desc: "雲端網址、同步排程、介面與各頁設定",
    tables: ["app_settings"] },
];

/** 不需要備份的表：除錯紀錄、同步刪除紀錄（還原後依同步重新產生） */
export const EXCLUDED_TABLES = ["debug_logs", "sync_tombstones"];
/** 遷移過程的暫存表（建立後立刻改名） */
export const MIGRATION_TABLES = ["note_templates_v2"];
/** 已沒有程式使用的舊表：清除前先拍永久保留的快照 */
export const LEGACY_TABLES = ["icd_codes", "medications", "rotation_snapshots", "acp_categories", "scheduler_shifts"];
/** 匯出另存快照時預設清掉的病人資料表 */
export const PATIENT_TABLES = ["note_records"];

export const ALL_GROUP_TABLES = BACKUP_GROUPS.flatMap(g => g.tables);
export const groupOfTable = (t: string) => BACKUP_GROUPS.find(g => g.tables.includes(t));

/** 群組匯出檔格式 */
export const GROUP_FILE_FORMAT = "medbase-groups";
export const GROUP_FILE_VERSION = 1;
export interface GroupFile {
  format: typeof GROUP_FILE_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  groups: string[];
  tables: Record<string, Record<string, unknown>[]>;
}

export function parseGroupFile(text: string): GroupFile {
  let j: Partial<GroupFile>;
  try { j = JSON.parse(text); } catch { throw new Error("檔案不是有效的 JSON"); }
  if (j.format !== GROUP_FILE_FORMAT || typeof j.tables !== "object" || !j.tables) throw new Error("不是 MedBase 群組備份檔");
  if ((j.version ?? 0) > GROUP_FILE_VERSION) throw new Error("備份檔來自較新版本的 MedBase，請先更新");
  return j as GroupFile;
}

/** 檔案中各群組的資料表筆數（只列有資料、且在本版清單內的表） */
export function previewGroupFile(f: GroupFile): { group: BackupGroup; tables: { table: string; rows: number }[] }[] {
  return BACKUP_GROUPS.map(group => ({
    group,
    tables: group.tables.filter(t => Array.isArray(f.tables[t])).map(t => ({ table: t, rows: f.tables[t].length })),
  })).filter(x => x.tables.length);
}

/** Excel 一格上限 32,767 字；僅供檢視的匯出用 */
export const XLSX_CELL_MAX = 32_000;
export function xlsxCell(v: unknown): unknown {
  if (typeof v === "string" && v.length > XLSX_CELL_MAX) return `${v.slice(0, 200)}…（內容過長 ${v.length.toLocaleString()} 字，請用 JSON 備份）`;
  return v;
}

// ── 快照檔名：medbase_<kind>_<YYYYMMDD-HHmmss>.db ─────────────────
export type SnapshotKind = "daily" | "pre-restore" | "pre-import" | "pre-clear" | "keep";
export const SNAPSHOT_LABELS: Record<SnapshotKind, string> = {
  daily: "每日自動", "pre-restore": "還原前", "pre-import": "匯入前", "pre-clear": "清空前", keep: "永久保留",
};
export const KEEP_DAILY = 14;
export const KEEP_PRE = 10;

export function snapshotName(kind: SnapshotKind, d: Date, note = ""): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `medbase_${kind}_${stamp}${note ? `_${note.replace(/[^\w-]/g, "")}` : ""}.db`;
}

export interface SnapshotInfo { name: string; kind: SnapshotKind; at: Date; note: string }
export function parseSnapshotName(name: string): SnapshotInfo | null {
  const m = name.match(/^medbase_(daily|pre-restore|pre-import|pre-clear|keep)_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:_([\w-]+))?\.db$/);
  if (!m) return null;
  const [, kind, y, mo, d, h, mi, s, note] = m;
  return { name, kind: kind as SnapshotKind, at: new Date(+y, +mo - 1, +d, +h, +mi, +s), note: note ?? "" };
}

/** 依保留規則該刪的快照（每日留 KEEP_DAILY 份、操作前合計留 KEEP_PRE 份、永久保留不刪） */
export function snapshotsToPrune(list: SnapshotInfo[]): SnapshotInfo[] {
  const newest = (xs: SnapshotInfo[]) => [...xs].sort((a, b) => b.at.getTime() - a.at.getTime());
  const daily = newest(list.filter(x => x.kind === "daily"));
  const pre = newest(list.filter(x => x.kind.startsWith("pre-")));
  return [...daily.slice(KEEP_DAILY), ...pre.slice(KEEP_PRE)];
}

/** 今天是否已有每日快照 */
export const hasDailyToday = (list: SnapshotInfo[], now: Date) =>
  list.some(x => x.kind === "daily" && x.at.toDateString() === now.toDateString());
