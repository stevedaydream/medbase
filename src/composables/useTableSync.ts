import { getDb, dbWrite } from "@/db";
import { useLogger } from "@/composables/useLogger";
import { saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { autoUpdatePassAhk } from "@/composables/usePassAhk";

/**
 * 通用逐筆同步。
 *
 * 過去每張表都是「整份本地資料 → GAS 清空 Sheet 重寫」，20 台以上電腦並用時
 * 任何一台儲存就會把別台新增的資料蓋掉，刪除也無法傳遞（別台再存一次就復活）。
 *
 * 現在每筆以 key 對應、以 updated_at 判斷新舊，刪除寫入 sync_tombstones。
 * 合併在 GAS 端（syncTable，持 LockService 鎖）一次完成並回傳結果，
 * 本地再依結果寫回。GAS 的 SYNC_TABLES 與這裡的 SYNC_CONFIGS 必須一致。
 */

interface SyncConfig {
  /** 本地資料表 */
  localTable: string;
  /** 對應同一筆的欄位（跨電腦一致，不可用本地自動遞增 id） */
  key: string;
  /** 同步的欄位（含 key），不含 updated_at */
  fields: string[];
  /** 刪除本地列之前（例如解除 FK 參照） */
  beforeDelete?: (key: string) => Promise<void>;
  /** 本地資料有變動之後，回傳給呼叫方 toast 的訊息 */
  afterApply?: () => Promise<string | null>;
}

const SYNC_CONFIGS: Record<string, SyncConfig> = {
  physicians: {
    localTable: "physicians",
    key: "name",
    fields: ["name", "department", "title", "ext", "his_account", "his_password", "phs_account", "phs_password", "notes"],
    beforeDelete: async (name) => {
      // sets.physician_id 參照 physicians(id)，不先解除會撞 FK
      await dbWrite("UPDATE sets SET physician_id = NULL WHERE physician_id IN (SELECT id FROM physicians WHERE name = ?)", [name]);
    },
    // 背景同步不可 Reload，見 usePassAhk
    afterApply: () => autoUpdatePassAhk({ reload: false }),
  },
};

type Row = Record<string, unknown>;

/**
 * 雲端尚未建立同步基準（沒有任何電腦按過「覆蓋」）。GAS 拒絕一般同步，
 * 雲端與本地都沒有被動到。自動同步路徑遇到它應保持安靜，只有手動操作才提示。
 */
export class NoBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoBaselineError";
  }
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  /** afterApply 的訊息（例如 pass.ahk 重建結果） */
  message: string | null;
}

/** 與 SQLite datetime('now','localtime') 同格式，才能跟既有 updated_at 直接比字串 */
export function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const str = (v: unknown) => (v == null ? "" : String(v));

/** 記錄刪除（在 DELETE 本地列之前或之後皆可） */
export async function markDeleted(table: string, key: string): Promise<void> {
  if (!key) return;
  await dbWrite(
    "INSERT OR REPLACE INTO sync_tombstones (tbl, key, deleted_at) VALUES (?, ?, ?)",
    [table, key, nowLocal()],
  );
}

// 同一張表的同步序列化：儲存後自動同步、背景同步、手動按鈕可能同時觸發
const queues = new Map<string, Promise<unknown>>();

/**
 * 與雲端逐筆同步一張表。
 * force = 「覆蓋」：以本地為準，雲端有、本地沒有的會被標記刪除（其他電腦同步後也會刪）。
 */
export function syncTable(table: string, gasUrl: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const prev = queues.get(table) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => runSync(table, gasUrl, !!opts.force));
  queues.set(table, next);
  return next;
}

async function runSync(table: string, gasUrl: string, force: boolean): Promise<SyncResult> {
  const cfg = SYNC_CONFIGS[table];
  if (!cfg) throw new Error(`未設定同步的資料表：${table}`);
  const { addLog } = useLogger();
  const db = await getDb();
  const cols = [...cfg.fields, "updated_at"].join(", ");

  const localRows = await db.select<Row[]>(`SELECT ${cols} FROM ${cfg.localTable}`);
  const localTombs = await db.select<{ key: string; deleted_at: string }[]>(
    "SELECT key, deleted_at FROM sync_tombstones WHERE tbl = ?", [table],
  );

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "syncTable", table, rows: localRows, tombstones: localTombs, now: nowLocal(), force }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { ok: boolean; code?: string; error?: string; rows?: Row[]; tombstones?: { key: string; deleted_at: string }[] };
  if (!json.ok && json.code === "NO_BASELINE") throw new NoBaselineError(json.error ?? "尚未建立同步基準");
  if (!json.ok) throw new Error(json.error ?? "GAS 錯誤");

  const cloudRows = json.rows ?? [];
  const cloudTombs = json.tombstones ?? [];
  let inserted = 0, updated = 0, deleted = 0;

  // ── 寫回雲端合併結果 ──
  for (const cr of cloudRows) {
    const key = str(cr[cfg.key]);
    if (!key) continue;
    const local = await db.select<Row[]>(
      `SELECT ${cols} FROM ${cfg.localTable} WHERE ${cfg.key} = ?`, [key],
    );
    const cloudTs = str(cr.updated_at);
    if (!local.length) {
      await dbWrite(
        `INSERT INTO ${cfg.localTable} (${cols}) VALUES (${cfg.fields.map(() => "?").join(", ")}, ?)`,
        [...cfg.fields.map(f => str(cr[f]) || null), cloudTs || "1970-01-01 00:00:00"],
      );
      inserted++;
      continue;
    }
    const lr = local[0];
    const localTs = str(lr.updated_at);
    if (cloudTs <= localTs) continue;
    const changed = cfg.fields.some(f => str(lr[f]) !== str(cr[f]));
    await dbWrite(
      `UPDATE ${cfg.localTable} SET ${cfg.fields.map(f => `${f} = ?`).join(", ")}, updated_at = ? WHERE ${cfg.key} = ?`,
      [...cfg.fields.map(f => str(cr[f]) || null), cloudTs, key],
    );
    if (changed) updated++;
  }

  // ── 套用刪除：本地列比刪除時間新則保留（同步途中剛被改過） ──
  for (const t of cloudTombs) {
    const local = await db.select<{ updated_at: string | null }[]>(
      `SELECT updated_at FROM ${cfg.localTable} WHERE ${cfg.key} = ?`, [t.key],
    );
    if (!local.length || str(local[0].updated_at) > str(t.deleted_at)) continue;
    await cfg.beforeDelete?.(t.key);
    await dbWrite(`DELETE FROM ${cfg.localTable} WHERE ${cfg.key} = ?`, [t.key]);
    deleted++;
  }

  // 本地刪除紀錄換成雲端的版本（雲端已合併本地送上去的紀錄）
  await dbWrite("DELETE FROM sync_tombstones WHERE tbl = ?", [table]);
  for (const t of cloudTombs) {
    await dbWrite(
      "INSERT OR REPLACE INTO sync_tombstones (tbl, key, deleted_at) VALUES (?, ?, ?)",
      [table, t.key, t.deleted_at],
    );
  }

  await saveSyncTimestamp(table);
  const message = (inserted || updated || deleted) ? (await cfg.afterApply?.()) ?? null : null;

  addLog(
    "info",
    `[雲端同步] ${force ? "覆蓋" : "同步"} ${table} — 新增 ${inserted}、更新 ${updated}、刪除 ${deleted}`,
    JSON.stringify({ table, force, sent: localRows.length, cloud: cloudRows.length, inserted, updated, deleted, timestamp: new Date().toISOString() }),
  );
  return { inserted, updated, deleted, message };
}
