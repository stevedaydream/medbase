import { ref } from "vue";
import { getDb, dbWrite } from "@/db";
import { useLogger } from "@/composables/useLogger";

// ── Table metadata ──────────────────────────────────────────────────────
// key 與 GAS Config 的 {table}_last_updated 對應；資料表的同步方式見 useTableSync（ADR-011）
export const SYNC_TABLE_META: Record<string, { label: string }> = {
  items:         { label: "自費品項" },
  physicians:    { label: "通訊錄" },
  prescriptions: { label: "處方套組" },
  surgery:       { label: "手術處置" },
  examination:   { label: "檢查處置" },
  disease:       { label: "疾病常規" },
  contacts:      { label: "常用分機" },
  ahk:           { label: "AHK 管理" },
  shiftMemos:    { label: "規則備忘錄" },
  sets:          { label: "套組管理" },
  surgeryTypes:  { label: "手術術式" },
  npDuty:        { label: "值班 NP" },
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

    const pending: string[] = [];
    for (const table of Object.keys(SYNC_TABLE_META)) {
      const remoteTs = json.data[`${table}_last_updated`];
      if (!remoteTs) continue;
      const localTs = await getLocalCloudTs(table);
      if (!localTs || remoteTs > localTs) pending.push(table);
    }
    pendingTables.value = pending;

    if (pending.length === 0) {
      addLog("info", "[雲端同步] 版本檢查完成 — 所有表格已是最新");
    } else {
      const labels = pending.map(t => SYNC_TABLE_META[t]?.label ?? t);
      addLog("info", `[雲端同步] 版本檢查完成 — 待更新：${labels.join("、")}`, JSON.stringify({ pending }));
    }
    return pending;
  } catch (e) {
    addLog("warn", "[雲端同步] checkVersions 失敗", String(e));
    return [];
  }
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
