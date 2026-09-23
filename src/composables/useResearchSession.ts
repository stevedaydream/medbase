import { reactive, readonly } from "vue";
import { getDb, dbWrite } from "@/db";
import { sha256 } from "@/utils/sha256";
import { useCloudSettings } from "@/stores/cloudSettings";
import { useLogger } from "@/composables/useLogger";
import {
  buildSnapshot, restoreSnapshot, hasLocalData, countUnowned, claimUnowned, type ResearchSnapshot,
} from "@/composables/researchBackup";

/**
 * 論文專案登入工作階段（ADR-012）。
 *
 * - 以通訊錄的 HIS 帳號＋PIN 登入；本機存加鹽雜湊供離線登入，雲端（GAS）另存一份並負責鎖定錯誤嘗試
 * - 登入者與憑證只存在記憶體，關掉 app 即清除
 * - 離開論文專案頁超過 30 分鐘，回來時需重新輸入 PIN（HIS 帳號保留）
 * - 登入期間的修改約 5 秒後自動上傳；雲端依日期保留最近 3 天
 */

const LOCK_AFTER_MS = 30 * 60 * 1000;
const BACKUP_DELAY_MS = 5000;
export const PIN_PATTERN = /^\d{4,6}$/;

export type BackupStatus = "idle" | "pending" | "uploading" | "ok" | "offline" | "auth" | "error";

const state = reactive({
  /** 目前（或上次）的操作者，鎖定後保留以便帶入 */
  his: "",
  name: "",
  unlocked: false,
  /** GAS 發的憑證；離線登入時為 null，修改會待下次連線登入再上傳 */
  token: null as string | null,
  leftAt: null as number | null,
  backupStatus: "idle" as BackupStatus,
  lastBackupAt: "",
  message: "",
});

export function useResearchSession() {
  return readonly(state);
}

/** 目前登入者的 HIS 帳號；未登入時丟錯，避免資料寫成無主 */
export function requireOwner(): string {
  if (!state.unlocked || !state.his) throw new Error("請先登入論文專案");
  return state.his;
}

// ── 工具 ───────────────────────────────────────────────────────────

function isoNow() { return new Date().toISOString(); }

function localDay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function hashPin(salt: string, pin: string) {
  return sha256(`${salt}:${pin}`);
}

interface LocalUser {
  his_account: string; pin_salt: string; pin_hash: string;
  last_change_at: string | null; last_backup_change_at: string | null; last_synced_at: string | null;
}

async function getLocalUser(his: string): Promise<LocalUser | null> {
  const db = await getDb();
  const rows = await db.select<LocalUser[]>("SELECT * FROM research_users WHERE his_account = ?", [his]);
  return rows[0] ?? null;
}

async function saveLocalPin(his: string, pin: string) {
  const salt = crypto.randomUUID();
  const hash = await hashPin(salt, pin);
  await dbWrite(
    `INSERT INTO research_users (his_account, pin_salt, pin_hash) VALUES (?,?,?)
     ON CONFLICT(his_account) DO UPDATE SET pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash`,
    [his, salt, hash],
  );
}

async function verifyLocalPin(user: LocalUser, pin: string) {
  return (await hashPin(user.pin_salt, pin)) === user.pin_hash;
}

function isDirty(u: LocalUser | null) {
  return !!u?.last_change_at && (!u.last_backup_change_at || u.last_change_at > u.last_backup_change_at);
}

/** 通訊錄中以 HIS 帳號找姓名；找不到代表不能使用 */
export async function lookupPerson(his: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM physicians WHERE TRIM(his_account) = ? LIMIT 1", [his.trim()],
  );
  return rows[0]?.name ?? null;
}

// ── GAS ────────────────────────────────────────────────────────────

class NetworkError extends Error {}

interface GasResult {
  ok: boolean; code?: string; error?: string;
  token?: string; latest?: { day: string; updated_at: string } | null;
  updated_at?: string; data?: string; backups?: { day: string; updated_at: string }[];
  remaining?: number; locked_until?: string;
}

async function gas(body: object): Promise<GasResult> {
  const cloud = useCloudSettings();
  await cloud.load();
  if (!cloud.gasUrl) throw new NetworkError("未設定 GAS 網址");
  let res: Response;
  try {
    res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new NetworkError(String(e));
  }
  if (!res.ok) throw new NetworkError(`HTTP ${res.status}`);
  return res.json();
}

function gasErrorMessage(r: GasResult): string {
  if (r.code === "BAD_PIN") return r.remaining != null ? `PIN 錯誤，再錯 ${r.remaining} 次將鎖定 15 分鐘` : "PIN 錯誤";
  if (r.code === "LOCKED") return `錯誤次數過多，已鎖定至 ${r.locked_until ? new Date(r.locked_until).toLocaleTimeString("zh-TW") : "稍後"}`;
  return r.error ?? "雲端驗證失敗";
}

// ── 登入 ───────────────────────────────────────────────────────────

export interface LoginResult {
  status: "ok" | "need_setup" | "error";
  message?: string;
  /** 升級前沒有擁有者的資料筆數，>0 時詢問是否認領 */
  unowned?: number;
  /** 雲端比本機新、但本機也有未上傳的修改，需使用者決定 */
  conflict?: { day: string; updated_at: string };
  /** 已自動載入雲端較新的版本 */
  restored?: boolean;
}

async function finishLogin(his: string, name: string, token: string | null, latest: GasResult["latest"]): Promise<LoginResult> {
  state.his = his;
  state.name = name;
  state.token = token;
  state.unlocked = true;
  state.leftAt = null;
  state.message = "";
  state.backupStatus = token ? "idle" : "offline";

  const user = await getLocalUser(his);
  state.lastBackupAt = user?.last_synced_at ?? "";
  const result: LoginResult = { status: "ok", unowned: await countUnowned() };

  // 雲端比這台電腦上次同步的還新（在別台電腦改過）
  if (token && latest && (!user?.last_synced_at || latest.updated_at > user.last_synced_at)) {
    if (!isDirty(user) || !(await hasLocalData(his))) {
      await restoreDay(latest.day);
      result.restored = true;
    } else {
      result.conflict = latest;
    }
  } else if (token && isDirty(user)) {
    backupNow();
  }
  return result;
}

/** 以 HIS 帳號＋PIN 登入。雲端與本機都沒有此帳號時回 need_setup，由畫面請使用者設定 PIN */
export async function login(hisRaw: string, pin: string): Promise<LoginResult> {
  const his = hisRaw.trim();
  const name = await lookupPerson(his);
  if (!name) return { status: "error", message: "通訊錄中找不到這個 HIS 帳號" };
  if (!PIN_PATTERN.test(pin)) return { status: "error", message: "PIN 為 4～6 碼數字" };
  const local = await getLocalUser(his);

  let r: GasResult;
  try {
    r = await gas({ action: "researchLogin", his, pin });
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    // 離線：只能用本機 PIN 登入
    if (!local) return { status: "error", message: "無法連線雲端，且這台電腦沒有你的資料，請確認網路後再試" };
    if (!(await verifyLocalPin(local, pin))) return { status: "error", message: "PIN 錯誤" };
    return finishLogin(his, name, null, null);
  }

  if (r.ok) {
    // 雲端驗證通過：同步本機 PIN（可能在別台電腦改過）
    if (!local || !(await verifyLocalPin(local, pin))) await saveLocalPin(his, pin);
    return finishLogin(his, name, r.token ?? null, r.latest ?? null);
  }
  if (r.code === "NOT_FOUND") {
    // 雲端沒有帳號：本機有就以本機 PIN 驗證後補註冊；都沒有則需設定 PIN
    if (!local) return { status: "need_setup" };
    if (!(await verifyLocalPin(local, pin))) return { status: "error", message: "PIN 錯誤" };
    const reg = await gas({ action: "researchRegister", his, pin }).catch(() => null);
    return finishLogin(his, name, reg?.ok ? reg.token ?? null : null, null);
  }
  return { status: "error", message: gasErrorMessage(r) };
}

/** 第一次使用：設定 PIN（本機＋雲端） */
export async function setupPin(hisRaw: string, pin: string): Promise<LoginResult> {
  const his = hisRaw.trim();
  const name = await lookupPerson(his);
  if (!name) return { status: "error", message: "通訊錄中找不到這個 HIS 帳號" };
  if (!PIN_PATTERN.test(pin)) return { status: "error", message: "PIN 為 4～6 碼數字" };
  let token: string | null = null;
  try {
    const r = await gas({ action: "researchRegister", his, pin });
    if (!r.ok) return { status: "error", message: r.code === "EXISTS" ? "此帳號已在雲端設定過 PIN，請直接輸入 PIN 登入" : gasErrorMessage(r) };
    token = r.token ?? null;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    // 離線也能先在本機設定，下次連線登入時會補註冊到雲端
  }
  await saveLocalPin(his, pin);
  return finishLogin(his, name, token, null);
}

/** 上鎖：先把未上傳的修改送出，再清除憑證；HIS 帳號保留供帶入 */
export async function lock(): Promise<void> {
  await flushBackup();
  state.unlocked = false;
  state.token = null;
  state.leftAt = null;
}

/** 登出／切換人員 */
export async function logout(): Promise<void> {
  await lock();
  state.his = "";
  state.name = "";
  state.lastBackupAt = "";
  state.backupStatus = "idle";
}

/** 路由切換時呼叫（router.afterEach）：離開論文專案超過 30 分鐘，回來需重新輸入 PIN */
export function onRouteChange(to: string, from: string) {
  const isResearch = (p: string) => p.startsWith("/research");
  if (isResearch(from) && !isResearch(to)) state.leftAt = Date.now();
  if (isResearch(to) && !isResearch(from)) {
    if (state.unlocked && state.leftAt && Date.now() - state.leftAt > LOCK_AFTER_MS) lock();
    else state.leftAt = null;
  }
}

export async function claimUnownedData(): Promise<void> {
  await claimUnowned(requireOwner());
  await markChanged();
}

// ── 自動備份 ─────────────────────────────────────────────────────

let backupTimer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;

/** 論文資料有任何修改後呼叫（useResearch 的寫入函式） */
export async function markChanged(): Promise<void> {
  if (!state.his) return;
  await dbWrite(
    `INSERT INTO research_users (his_account, pin_salt, pin_hash, last_change_at) VALUES (?, '', '', ?)
     ON CONFLICT(his_account) DO UPDATE SET last_change_at = excluded.last_change_at`,
    [state.his, isoNow()],
  );
  state.backupStatus = state.token ? "pending" : "offline";
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => { backupTimer = null; backupNow(); }, BACKUP_DELAY_MS);
}

async function flushBackup(): Promise<void> {
  if (backupTimer) { clearTimeout(backupTimer); backupTimer = null; await backupNow(); }
  else if (running) await running;
}

/** 立即上傳目前登入者的資料（同一時間只跑一個） */
export function backupNow(): Promise<void> {
  if (running) return running;
  running = doBackup().finally(() => { running = null; });
  return running;
}

async function doBackup(): Promise<void> {
  const his = state.his;
  if (!his) return;
  if (!state.token) { state.backupStatus = "offline"; return; }
  const user = await getLocalUser(his);
  if (!isDirty(user)) { state.backupStatus = "ok"; return; }

  state.backupStatus = "uploading";
  const changeAt = user!.last_change_at;
  try {
    const snap = await buildSnapshot(his);
    const r = await gas({ action: "researchBackup", his, token: state.token, day: localDay(), data: JSON.stringify(snap) });
    if (!r.ok) {
      if (r.code === "AUTH") { state.token = null; state.backupStatus = "auth"; state.message = "登入憑證已過期，重新輸入 PIN 後會補上傳"; return; }
      throw new Error(r.error ?? "上傳失敗");
    }
    await dbWrite(
      "UPDATE research_users SET last_backup_change_at = ?, last_synced_at = ? WHERE his_account = ?",
      [changeAt, r.updated_at ?? isoNow(), his],
    );
    state.lastBackupAt = r.updated_at ?? isoNow();
    // 上傳期間又有修改：再排一次
    const after = await getLocalUser(his);
    state.backupStatus = isDirty(after) ? "pending" : "ok";
    if (isDirty(after) && !backupTimer) backupTimer = setTimeout(() => { backupTimer = null; backupNow(); }, BACKUP_DELAY_MS);
  } catch (e) {
    state.backupStatus = e instanceof NetworkError ? "offline" : "error";
    state.message = String(e instanceof Error ? e.message : e);
    useLogger().addLog("warn", "[論文專案] 雲端備份失敗", String(e));
  }
}

// ── 還原 ───────────────────────────────────────────────────────────

export async function listBackups(): Promise<{ day: string; updated_at: string }[]> {
  if (!state.token) throw new Error("目前為離線登入，無法讀取雲端備份");
  const r = await gas({ action: "researchListBackups", his: state.his, token: state.token });
  if (!r.ok) throw new Error(r.code === "AUTH" ? "登入憑證已過期，請重新登入" : r.error ?? "讀取失敗");
  return r.backups ?? [];
}

/** 以雲端某一天的備份取代自己在本機的資料 */
export async function restoreDay(day: string): Promise<void> {
  const his = requireOwner();
  if (!state.token) throw new Error("目前為離線登入，無法讀取雲端備份");
  const r = await gas({ action: "researchGetBackup", his, token: state.token, day });
  if (!r.ok || !r.data) throw new Error(r.code === "AUTH" ? "登入憑證已過期，請重新登入" : r.error ?? "讀取失敗");
  const snap = JSON.parse(r.data) as ResearchSnapshot;
  await restoreSnapshot(his, snap);

  const latest = (await listBackups().catch(() => []))[0];
  const isLatest = !latest || latest.day === day;
  const now = isoNow();
  // 還原最新一份＝與雲端一致；還原較舊的一份則視為修改，會上傳成今天的備份
  await dbWrite(
    `INSERT INTO research_users (his_account, pin_salt, pin_hash, last_change_at, last_backup_change_at, last_synced_at)
     VALUES (?, '', '', ?, ?, ?)
     ON CONFLICT(his_account) DO UPDATE SET last_change_at = excluded.last_change_at,
       last_backup_change_at = excluded.last_backup_change_at, last_synced_at = excluded.last_synced_at`,
    [his, now, isLatest ? now : null, r.updated_at ?? now],
  );
  state.lastBackupAt = r.updated_at ?? now;
  state.backupStatus = isLatest ? "ok" : "pending";
  if (!isLatest) backupNow();
}
