import { ref } from "vue";
import { getDb, dbWrite } from "@/db";
import { useLogger } from "@/composables/useLogger";

// ── Table metadata ──────────────────────────────────────────────────────
export const SYNC_TABLE_META: Record<string, {
  label: string;
  getAction: string;
  extractData: (res: Record<string, unknown>) => unknown[];
  primaryKey: string;
}> = {
  items:         { label: "自費品項",   getAction: "getItems",         extractData: r => r.data as unknown[], primaryKey: "hospital_code" },
  physicians:    { label: "通訊錄",     getAction: "getPhysicians",    extractData: r => r.data as unknown[], primaryKey: "name" },
  prescriptions: { label: "處方套組",   getAction: "getPrescriptions", extractData: r => r.data as unknown[], primaryKey: "id" },
  surgery:       { label: "手術處置",   getAction: "getSurgery",       extractData: r => r.data as unknown[], primaryKey: "id" },
  examination:   { label: "檢查處置",   getAction: "getExamination",   extractData: r => r.data as unknown[], primaryKey: "id" },
  disease:       { label: "疾病常規",   getAction: "getDisease",       extractData: r => r.data as unknown[], primaryKey: "id" },
  contacts:      { label: "常用分機",   getAction: "getContacts",      extractData: r => r.data as unknown[], primaryKey: "label" },
  ahk:           { label: "AHK 管理",   getAction: "getAhkScripts",    extractData: r => r.scripts as unknown[], primaryKey: "id" },
  shiftMemos:    { label: "規則備忘錄", getAction: "getShiftMemos",    extractData: r => r.data as unknown[], primaryKey: "id" },
  sets:          { label: "套組管理",   getAction: "getSets",          extractData: r => r.sets as unknown[], primaryKey: "id" },
};

// ── Module-level singletons ─────────────────────────────────────────────
const pendingTables = ref<string[]>([]);
let pollingTimer: ReturnType<typeof setInterval> | null = null;

// ── DB helpers ──────────────────────────────────────────────────────────

async function getAppSetting(key: string): Promise<string | null> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = ?", [key]
    );
    return rows[0]?.value ?? null;
  } catch { return null; }
}

async function setAppSetting(key: string, value: string): Promise<void> {
  await dbWrite(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
    [key, value]
  );
}

// ── Public API ──────────────────────────────────────────────────────────

/** 取得本地對應 table 的上次雲端 pull 時間 */
export async function getLocalCloudTs(table: string): Promise<string | null> {
  return getAppSetting(`${table}_cloud_ts`);
}

/** 取得本地對應 table 的本地最後修改時間 */
export async function getLocalModifiedTs(table: string): Promise<string | null> {
  return getAppSetting(`${table}_local_modified_ts`);
}

/** 標記本地 table 已修改（save 後呼叫） */
export async function markLocalModified(table: string): Promise<void> {
  await setAppSetting(`${table}_local_modified_ts`, new Date().toISOString());
}

/** 儲存雲端同步時間戳（push 或 pull 成功後呼叫） */
export async function saveSyncTimestamp(table: string): Promise<void> {
  await setAppSetting(`${table}_cloud_ts`, new Date().toISOString());
}

/** 向 GAS 取得所有 table 的 last_updated 版本，比對本地 cloud_ts，更新 pendingTables */
export async function checkCloudVersions(gasUrl: string): Promise<string[]> {
  if (!gasUrl) return [];
  const { addLog } = useLogger();
  try {
    const res = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getVersions" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { ok: boolean; data?: Record<string, string>; error?: string };
    if (!json.ok || !json.data) {
      addLog("warn", "[雲端同步] checkVersions — GAS 回傳異常", JSON.stringify(json));
      return [];
    }

    const MANUAL_ONLY = new Set(["ahk", "sets"]);
    const pending: string[] = [];
    const manualPending: string[] = [];

    for (const table of Object.keys(SYNC_TABLE_META)) {
      const remoteTs = json.data[`${table}_last_updated`];
      if (!remoteTs) continue;
      const localTs = await getLocalCloudTs(table);
      if (!localTs || remoteTs > localTs) {
        if (MANUAL_ONLY.has(table)) manualPending.push(table);
        else pending.push(table);
      }
    }
    pendingTables.value = pending;

    const allPending = [...pending, ...manualPending];
    if (allPending.length === 0) {
      addLog("info", "[雲端同步] 版本檢查完成 — 所有表格已是最新");
    } else {
      const autoLabels   = pending.map(t => SYNC_TABLE_META[t]?.label ?? t);
      const manualLabels = manualPending.map(t => SYNC_TABLE_META[t]?.label ?? t);
      const parts: string[] = [];
      if (autoLabels.length)   parts.push(`待自動更新：${autoLabels.join("、")}`);
      if (manualLabels.length) parts.push(`待手動更新：${manualLabels.join("、")}`);
      addLog("info", `[雲端同步] 版本檢查完成 — ${parts.join("；")}`, JSON.stringify({ pending, manualPending }));
    }
    for (const table of manualPending) {
      addLog("info", `[雲端同步] ${SYNC_TABLE_META[table]?.label ?? table} 雲端有更新，請至對應頁面手動還原`);
    }
    return allPending;
  } catch (e) {
    addLog("warn", "[雲端同步] checkVersions 失敗", String(e));
    return [];
  }
}

/** 向 GAS 拉取指定 table 的雲端資料 */
export async function fetchCloudTable(
  table: string,
  gasUrl: string
): Promise<unknown[] | null> {
  const meta = SYNC_TABLE_META[table];
  if (!meta || !gasUrl) return null;
  try {
    const res = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: meta.getAction }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as Record<string, unknown>;
    if (!json.ok) throw new Error(String(json.error ?? "GAS 錯誤"));
    return meta.extractData(json);
  } catch {
    return null;
  }
}

/**
 * 推送 table 資料至 GAS，更新時間戳，寫入同步 log。
 * 呼叫方需自行組好 payload（含 action + data）。
 * 此函式不處理 isSyncing banner，由各 View 自行管理。
 */
export async function pushTableToCloud(
  table: string,
  gasUrl: string,
  payload: Record<string, unknown>,
  rowCount?: number
): Promise<boolean> {
  if (!gasUrl) return false;
  const { addLog } = useLogger();
  try {
    const res = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { ok: boolean; error?: string };
    if (!json.ok) throw new Error(json.error ?? "GAS 錯誤");
    await saveSyncTimestamp(table);
    addLog(
      "info",
      `[雲端同步] push ${SYNC_TABLE_META[table]?.label ?? table}${rowCount != null ? ` — ${rowCount} 筆` : ""}`,
      JSON.stringify({ table, action: "push", timestamp: new Date().toISOString(), rows: rowCount })
    );
    return true;
  } catch (e) {
    addLog("warn", `[雲端同步] push ${SYNC_TABLE_META[table]?.label ?? table} 失敗`, String(e));
    return false;
  }
}

/**
 * 偵測衝突：若本地 modified_ts > cloud_ts，代表有未推送的本地變更
 * 且雲端也有更新 → 衝突
 */
export async function hasConflict(table: string): Promise<boolean> {
  const modifiedTs = await getLocalModifiedTs(table);
  const cloudTs    = await getLocalCloudTs(table);
  if (!modifiedTs || !cloudTs) return false;
  return modifiedTs > cloudTs;
}

/** 寫入雲端 pull 的同步 log */
export function logPullResult(
  table: string,
  updatedCount: number,
  addedCount: number
): void {
  const { addLog } = useLogger();
  addLog(
    "info",
    `[雲端同步] pull ${SYNC_TABLE_META[table]?.label ?? table} — 更新 ${updatedCount} 筆、新增 ${addedCount} 筆`,
    JSON.stringify({ table, action: "pull", updatedRows: updatedCount, addedRows: addedCount, timestamp: new Date().toISOString() })
  );
}

/** 啟動背景輪詢（預設每小時一次） */
export function startPolling(
  gasUrlGetter: () => string,
  intervalMs = 3_600_000
): void {
  stopPolling();
  pollingTimer = setInterval(async () => {
    const url = gasUrlGetter();
    if (!url) return;
    await checkCloudVersions(url);
  }, intervalMs);
}

/** 停止背景輪詢 */
export function stopPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

/** 全域 pending tables ref，供 App.vue 監聽 */
export { pendingTables };

/** SettingView 可 increment 此 ref，App.vue watch 後立即執行完整同步 */
export const syncRequest = ref(0);
export function requestImmediateSync() { syncRequest.value++; }
