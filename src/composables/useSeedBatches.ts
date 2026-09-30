import { getDb, dbWrite } from "@/db";

/**
 * 首批內容分批加入與更新（ADR-017、ADR-018）。只在本機還沒處理過的批次時執行：
 * - 新批次的條目：加入（使用者刪過、或已有同名條目的不加回來；retired 的不加）
 * - 沒改過的首批條目（時間戳仍是 1970）：更新成最新內容（retired 的改成草稿）
 * 時間戳用 1970-01-01 00:00:<批次>：比任何真實修改都舊，雲端或別台電腦改過的內容優先。
 * 回傳是否有變動。
 */
export async function addSeedBatches(o: {
  syncTable: string;
  localTable: string;
  versionKey: string;
  /** 還沒有 versionKey 時視為已處理到第幾批（舊版程式已寫入第 1 批時為 1） */
  assumed: number;
  version: number;
  seeds: { uid: string; name: string; spec: unknown; since: number; retired?: boolean }[];
}): Promise<boolean> {
  const db = await getDb();
  const stored = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", [o.versionKey]);
  const cur = stored.length ? Number(stored[0].value) : o.assumed;
  if (cur >= o.version) return false;
  const stamp = `1970-01-01 00:00:${String(Math.min(o.version, 59)).padStart(2, "0")}`;
  const tombs = new Set((await db.select<{ key: string }[]>("SELECT key FROM sync_tombstones WHERE tbl=?", [o.syncTable])).map(r => r.key));
  const rows = await db.select<{ uid: string; name: string; spec: string | null; updated_at: string | null }[]>(
    `SELECT uid, name, spec, updated_at FROM ${o.localTable}`);
  const byUid = new Map(rows.map(r => [r.uid, r]));
  const names = new Set(rows.map(r => r.name));
  let changed = 0;
  for (const s of o.seeds) {
    const json = JSON.stringify(s.spec);
    const row = byUid.get(s.uid);
    if (row) {
      // 沒改過（1970 時間戳）才更新
      if ((row.updated_at ?? "") < "1970-01-02" && (row.spec !== json || row.name !== s.name)) {
        await dbWrite(`UPDATE ${o.localTable} SET name=?, spec=?, updated_at=? WHERE uid=?`, [s.name, json, stamp, s.uid]);
        changed++;
      }
      continue;
    }
    if (s.retired || s.since <= cur || tombs.has(s.uid) || names.has(s.name)) continue;
    const r = await dbWrite(`INSERT OR IGNORE INTO ${o.localTable} (uid, updated_at, name, spec) VALUES (?, ?, ?, ?)`, [s.uid, stamp, s.name, json]);
    changed += r.rowsAffected;
  }
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [o.versionKey, String(o.version)]);
  return changed > 0;
}
