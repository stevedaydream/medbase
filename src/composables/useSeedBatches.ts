import { getDb, dbWrite } from "@/db";

/**
 * 首批內容分批加入（ADR-017、ADR-018）：只加「這台電腦還沒加過的批次」，
 * 使用者刪過（有刪除紀錄）或已有同名條目的不加回來。
 * 時間戳用最舊：雲端已有同 uid 的內容（別台電腦先上傳或已修改）時以雲端為準。
 * 回傳是否有新增。
 */
export async function addSeedBatches(o: {
  syncTable: string;
  localTable: string;
  versionKey: string;
  /** 還沒有 versionKey 時視為已加到第幾批（舊版程式已寫入第 1 批時為 1） */
  assumed: number;
  version: number;
  seeds: { uid: string; name: string; spec: unknown; since: number }[];
}): Promise<boolean> {
  const db = await getDb();
  const stored = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", [o.versionKey]);
  const cur = stored.length ? Number(stored[0].value) : o.assumed;
  if (cur >= o.version) return false;
  const tombs = new Set((await db.select<{ key: string }[]>("SELECT key FROM sync_tombstones WHERE tbl=?", [o.syncTable])).map(r => r.key));
  const names = new Set((await db.select<{ name: string }[]>(`SELECT name FROM ${o.localTable}`)).map(r => r.name));
  let added = 0;
  for (const s of o.seeds) {
    if (s.since <= cur || tombs.has(s.uid) || names.has(s.name)) continue;
    const r = await dbWrite(`INSERT OR IGNORE INTO ${o.localTable} (uid, updated_at, name, spec) VALUES (?, ?, ?, ?)`,
      [s.uid, "1970-01-01 00:00:00", s.name, JSON.stringify(s.spec)]);
    added += r.rowsAffected;
  }
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [o.versionKey, String(o.version)]);
  return added > 0;
}
