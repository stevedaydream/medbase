import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getDb, dbWrite } from "@/db";

// ── 型別定義 ─────────────────────────────────────────────────────

export interface HisPatient {
  account_no: string;
  chart_no: string;
  patient_name?: string;
  bed_no?: string;
  ward?: string;
}

export interface HisScrapeResult {
  account_no: string;
  chart_no: string;
  note_text: string;
  raw_html: string;
  status: "ok" | "partial" | "error" | "session_expired";
  error_msg?: string;
}

export interface HisLoginResult {
  success: boolean;
  session_cookie: string;
  redirect_url: string;
}

export interface HisSettings {
  base_url: string;
  login_path: string;
  patient_list_path: string;
  note_view_path: string;
  logout_path: string;
  login_username_field: string;
  login_password_field: string;
}

// ── Singleton 狀態 ────────────────────────────────────────────────

export const hisScraping   = ref(false);
export const hisProgress   = ref(0);
export const hisTotal      = ref(0);
export const hisMessage    = ref("");
export const hisLastSyncAt = ref("");

// ── 輔助：讀取 app_settings ──────────────────────────────────────

export async function loadHisSettings(): Promise<HisSettings> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    `SELECT key, value FROM app_settings WHERE key LIKE 'his_%'`
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    base_url:             map["his_base_url"]             ?? "http://10.15.1.232/cgh/html",
    login_path:           map["his_login_path"]           ?? "/servlet/HttpDispatcher/Login/login",
    patient_list_path:    map["his_patient_list_path"]    ?? "",
    note_view_path:       map["his_note_view_path"]       ?? "/servlet/HttpDispatcher/Ins010218/noteTotalView",
    logout_path:          map["his_logout_path"]          ?? "/servlet/HttpDispatcher/Logout/logout",
    login_username_field: map["his_login_username_field"] ?? "usrno",
    login_password_field: map["his_login_password_field"] ?? "usrpw",
  };
}

export async function saveHisSettings(settings: HisSettings): Promise<void> {
  const entries: [string, string][] = [
    ["his_base_url",             settings.base_url],
    ["his_login_path",           settings.login_path],
    ["his_patient_list_path",    settings.patient_list_path],
    ["his_note_view_path",       settings.note_view_path],
    ["his_logout_path",          settings.logout_path],
    ["his_login_username_field", settings.login_username_field],
    ["his_login_password_field", settings.login_password_field],
  ];
  for (const [key, value] of entries) {
    await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)", [key, value]);
  }
}

// ── 輔助：讀取醫師 HIS 帳號 ──────────────────────────────────────

async function loadPhysicianCreds(physicianId: number): Promise<{ account: string; password: string }> {
  const db = await getDb();
  const rows = await db.select<{ his_account: string; his_password: string }[]>(
    "SELECT his_account, his_password FROM physicians WHERE id = ? LIMIT 1",
    [physicianId]
  );
  if (!rows.length || !rows[0].his_account) throw new Error("找不到該醫師的 HIS 帳號");
  return { account: rows[0].his_account, password: rows[0].his_password ?? "" };
}

// ── 命令封裝 ─────────────────────────────────────────────────────

export async function testHisLogin(physicianId: number): Promise<HisLoginResult> {
  const [settings, creds] = await Promise.all([loadHisSettings(), loadPhysicianCreds(physicianId)]);
  return invoke<HisLoginResult>("his_test_login", {
    baseUrl:       settings.base_url,
    loginPath:     settings.login_path,
    usernameField: settings.login_username_field,
    passwordField: settings.login_password_field,
    username:      creds.account,
    password:      creds.password,
  });
}

export async function fetchHisRaw(physicianId: number, fetchPath: string, fetchParams: string): Promise<string> {
  const [settings, creds] = await Promise.all([loadHisSettings(), loadPhysicianCreds(physicianId)]);
  return invoke<string>("his_raw_fetch", {
    baseUrl:       settings.base_url,
    loginPath:     settings.login_path,
    usernameField: settings.login_username_field,
    passwordField: settings.login_password_field,
    username:      creds.account,
    password:      creds.password,
    fetchPath,
    fetchParams,
  });
}

export async function fetchHisPatientList(physicianId: number): Promise<HisPatient[]> {
  const [settings, creds] = await Promise.all([loadHisSettings(), loadPhysicianCreds(physicianId)]);
  if (!settings.patient_list_path) throw new Error("尚未設定病人清單路徑");
  return invoke<HisPatient[]>("his_fetch_patient_list", {
    baseUrl:       settings.base_url,
    loginPath:     settings.login_path,
    usernameField: settings.login_username_field,
    passwordField: settings.login_password_field,
    username:      creds.account,
    password:      creds.password,
    listPath:      settings.patient_list_path,
    listParams:    "",
  });
}

export async function scrapeHisNotes(
  physicianId: number,
  patients: HisPatient[]
): Promise<HisScrapeResult[]> {
  if (hisScraping.value) throw new Error("擷取中，請稍候");
  if (!patients.length) throw new Error("未選擇任何病人");

  const [settings, creds] = await Promise.all([loadHisSettings(), loadPhysicianCreds(physicianId)]);

  hisScraping.value = true;
  hisProgress.value = 0;
  hisTotal.value    = patients.length;
  hisMessage.value  = "登入 HIS 中…";

  try {
    const results = await invoke<HisScrapeResult[]>("his_scrape_batch", {
      baseUrl:       settings.base_url,
      loginPath:     settings.login_path,
      usernameField: settings.login_username_field,
      passwordField: settings.login_password_field,
      username:      creds.account,
      password:      creds.password,
      noteViewPath:  settings.note_view_path,
      logoutPath:    settings.logout_path,
      patients,
    });

    // 逐筆寫入 SQLite
    hisMessage.value = "儲存至資料庫…";
    for (let i = 0; i < results.length; i++) {
      const r  = results[i];
      const pt = patients[i];
      await dbWrite(
        `INSERT OR REPLACE INTO his_notes
         (account_no, chart_no, patient_name, bed_no, ward, raw_html, note_text,
          physician_id, scraped_at, status, error_msg)
         VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'),?,?)`,
        [
          r.account_no,
          r.chart_no,
          pt.patient_name ?? "",
          pt.bed_no       ?? "",
          pt.ward         ?? "",
          r.raw_html,
          r.note_text,
          physicianId,
          r.status,
          r.error_msg ?? null,
        ]
      );
      hisProgress.value = i + 1;
    }

    hisLastSyncAt.value = new Date().toLocaleString("zh-TW");
    hisMessage.value = `完成：${results.filter(r => r.status === "ok").length} 筆成功`;
    return results;
  } finally {
    hisScraping.value = false;
  }
}
