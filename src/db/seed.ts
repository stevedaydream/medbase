export interface SeedPhysician {
  name: string;
  department: string | null;
  title: string | null;
  ext: string | null;
  his_account: string | null;
  his_password: string | null;
  phs_account: string | null;
  phs_password: string | null;
  notes: string | null;
}

export interface SeedContact {
  label: string;
  ext: string;
  category: string;
  notes: string | null;
}

// ── 醫師通訊錄預設資料 ──────────────────────────────────────────────
// 每次全新安裝（physicians 表為空時）自動匯入
export const seedPhysicians: SeedPhysician[] = [
  // 範例：
  // { name: "王大明", department: "一般外科", title: "主治醫師", ext: "1234", his_account: "wang", his_password: "pw123", phs_account: "", phs_password: "", notes: null },
];

// ── 常用分機預設資料 ────────────────────────────────────────────────
// 每次全新安裝（contacts 表為空時）自動匯入
export const seedContacts: SeedContact[] = [
  // 範例：
  // { label: "急診護理站", ext: "1000", category: "急診", notes: null },
  // { label: "手術室控台", ext: "2000", category: "手術室", notes: null },
];

// ── 雲端設定預設值 ──────────────────────────────────────────────────
// 僅在該 key 尚未存在時寫入（INSERT OR IGNORE），不覆蓋管理員已修改的值
export const seedAppSettings: { key: string; value: string }[] = [
  // 敏感雲端設定（GAS URL、Spreadsheet ID、API Key）已移除，
  // 請在設定頁使用「匯入設定 JSON」匯入，或手動填寫後儲存。
  { key: "ahk_exe_path", value: "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe" },
];

// ── 病歷潤飾格式範本 ────────────────────────────────────────────────────
export interface SeedNoteTemplate {
  format_key: string;
  format_label: string;
  system_prompt: string;
  example: string;
}

export const seedNoteTemplates: SeedNoteTemplate[] = [
  { format_key: "admission",  format_label: "入院病歷",      system_prompt: "", example: "" },
  { format_key: "discharge",  format_label: "出院摘要",      system_prompt: "", example: "" },
  { format_key: "transfer",   format_label: "轉科摘要",      system_prompt: "", example: "" },
  { format_key: "weekly",     format_label: "週記錄",        system_prompt: "", example: "" },
  { format_key: "progress",   format_label: "Progress Note", system_prompt: "", example: "" },
];
