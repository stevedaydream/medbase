/**
 * 資料垃圾桶（ADR-028）：逐筆同步表刪除前把整筆資料（含附屬資料）存到 GAS Trash，所有電腦共用，保留 30 天。
 * 離線時先放本機待上傳（app_settings trash_pending），連線後補傳。
 * 還原＝以現在時間寫回該筆，同步時蓋過刪除紀錄，所有電腦跟著回來。
 */
import { invoke } from "@tauri-apps/api/core";
import { getDb, dbWrite } from "@/db";
import { readSyncRow, restoreSyncRow, syncRowExists, syncLabel } from "@/composables/useTableSync";
import { useCloudSettings } from "@/stores/cloudSettings";

export interface TrashItem {
  id: string;
  table: string;
  key: string;
  label: string;
  /** ISO 時間 */
  deleted_at: string;
  machine: string;
  /** 整筆資料 JSON */
  data: string;
  /** 還沒上傳到雲端 */
  pending?: boolean;
}

export const TRASH_KEEP_DAYS = 30;
const PENDING_KEY = "trash_pending";

/** 還原時本機已有同 key 的資料 */
export class TrashConflictError extends Error {}

let machine: string | null = null;
async function machineName(): Promise<string> {
  if (machine === null) machine = await invoke<string>("machine_name").catch(() => "");
  return machine;
}

/** 顯示名稱：依資料表常見的名稱欄位 */
export function trashLabel(row: Record<string, unknown>, key: string): string {
  for (const f of ["name", "title", "label", "name_zh", "name_en"]) {
    const v = row[f];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return key;
}

async function readPending(): Promise<TrashItem[]> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key = ?", [PENDING_KEY]);
  try { return rows[0] ? JSON.parse(rows[0].value) : []; } catch { return []; }
}

async function writePending(list: TrashItem[]): Promise<void> {
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [PENDING_KEY, JSON.stringify(list)]);
}

async function gas<T>(body: Record<string, unknown>): Promise<T> {
  const cloud = useCloudSettings();
  await cloud.load();
  if (!cloud.gasUrl) throw new Error("未設定 GAS 網址");
  const res = await fetch(cloud.gasUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json() as T & { ok: boolean; error?: string };
  if (!j.ok) throw new Error(j.error ?? "GAS 錯誤");
  return j;
}

/** 刪除前呼叫（markDeleted 內）：存下整筆資料；找不到資料（例如已刪掉）就略過 */
export async function trashCapture(table: string, key: string): Promise<void> {
  try {
    const row = await readSyncRow(table, key);
    if (!row) return;
    const item: TrashItem = {
      id: crypto.randomUUID(), table, key, label: trashLabel(row, key),
      deleted_at: new Date().toISOString(), machine: await machineName(), data: JSON.stringify(row),
    };
    await writePending([...await readPending(), item]);
    void flushTrash();
  } catch (e) {
    // 垃圾桶失敗不能擋住刪除
    console.error("[trash] 無法存入垃圾桶", e);
  }
}

let flushing: Promise<void> | null = null;
/** 把本機待上傳的項目傳到雲端 */
export function flushTrash(): Promise<void> {
  flushing ??= (async () => {
    const list = await readPending();
    if (!list.length) return;
    try {
      await gas({ action: "trashPut", items: list });
      const sent = new Set(list.map(i => i.id));
      await writePending((await readPending()).filter(i => !sent.has(i.id)));
    } catch { /* 離線或未設定 GAS：留在本機，下次再傳 */ }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** 垃圾桶內容（雲端＋本機尚未上傳），新的在前；cloudError 為雲端讀取失敗的原因 */
export async function listTrash(): Promise<{ items: TrashItem[]; cloudError: string }> {
  await flushTrash();
  let cloud: TrashItem[] = [];
  let cloudError = "";
  try { cloud = (await gas<{ items: TrashItem[] }>({ action: "trashList" })).items ?? []; }
  catch (e) { cloudError = (e as Error).message; }
  const pending = (await readPending()).map(i => ({ ...i, pending: true }));
  const limit = new Date(Date.now() - TRASH_KEEP_DAYS * 86400000).toISOString();
  const seen = new Set(cloud.map(i => i.id));
  return {
    items: [...cloud, ...pending.filter(i => !seen.has(i.id))]
      .filter(i => i.deleted_at >= limit)
      .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)),
    cloudError,
  };
}

/** 剩幾天會被清掉 */
export function daysLeft(item: TrashItem, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(item.deleted_at).getTime() + TRASH_KEEP_DAYS * 86400000 - now) / 86400000));
}

export { syncLabel as trashTableLabel };

/** 還原；本機已有同 key 的資料時，overwrite 才覆蓋，否則丟出 TrashConflictError */
export async function restoreTrash(item: TrashItem, overwrite = false): Promise<void> {
  if (!overwrite && await syncRowExists(item.table, item.key)) {
    throw new TrashConflictError(`已有同名的${syncLabel(item.table)}「${item.label}」`);
  }
  await restoreSyncRow(item.table, JSON.parse(item.data));
  await removeTrash([item.id]);
}

/** 從垃圾桶移除（永久刪除） */
export async function removeTrash(ids: string[]): Promise<void> {
  const drop = new Set(ids);
  await writePending((await readPending()).filter(i => !drop.has(i.id)));
  await gas({ action: "trashRemove", ids }).catch(() => null);
}

export async function clearTrash(): Promise<void> {
  await writePending([]);
  await gas({ action: "trashRemove", all: true });
}
