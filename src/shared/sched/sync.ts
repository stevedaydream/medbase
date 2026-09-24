/**
 * 排班文件雙向同步（ADR-014）：先下載雲端較新且本機未修改的文件，再上傳本機修改。
 * 伺服器以版本比對寫入；預班／紀錄／通知在伺服器合併，其餘衝突時以雲端為準。
 */
export interface LocalMeta { key: string; json: string; version: string; cloud_version: string | null; dirty: number }
export interface PutResult { key: string; ok: boolean; conflict?: boolean; merged?: boolean; version: string; json?: string }

export interface SyncLocal {
  list(): Promise<LocalMeta[]>;
  apply(key: string, json: string, cloudVersion: string, expectVersion?: string): Promise<boolean>;
  synced(key: string, sentVersion: string, cloudVersion: string): Promise<void>;
}
export interface SyncRemote {
  list(): Promise<{ key: string; version: string }[]>;
  get(keys: string[]): Promise<{ key: string; version: string; json: string }[]>;
  put(items: { key: string; json: string; base: string | null }[]): Promise<PutResult[]>;
}
export interface SyncReport { downloaded: string[]; uploaded: string[]; merged: string[]; conflicts: string[] }

export async function syncOnce(local: SyncLocal, remote: SyncRemote): Promise<SyncReport> {
  const rep: SyncReport = { downloaded: [], uploaded: [], merged: [], conflicts: [] };
  const cloud = new Map((await remote.list()).map(d => [d.key, d.version]));
  const mine = new Map((await local.list()).map(d => [d.key, d]));

  // ① 下載：雲端有新版本、本機沒有未上傳修改
  const toGet = [...cloud.entries()]
    .filter(([k, v]) => { const l = mine.get(k); return !l || (!l.dirty && l.cloud_version !== v); })
    .map(([k]) => k);
  if (toGet.length) {
    for (const d of await remote.get(toGet)) {
      const l = mine.get(d.key);
      if (await local.apply(d.key, d.json, d.version, l?.version)) rep.downloaded.push(d.key);
    }
  }

  // ② 上傳：本機修改（base＝本機最後看到的雲端版本）
  const dirty = [...mine.values()].filter(l => l.dirty);
  if (dirty.length) {
    const results = await remote.put(dirty.map(l => ({ key: l.key, json: l.json, base: l.cloud_version })));
    for (const r of results) {
      const l = mine.get(r.key)!;
      if (r.ok && r.json !== undefined) {
        // 伺服器合併後的內容：本機未再改動才覆蓋，否則下次再合併
        if (await local.apply(r.key, r.json, r.version, l.version)) rep.merged.push(r.key);
        else await local.synced(r.key, "", r.version);
      } else if (r.ok) {
        await local.synced(r.key, l.version, r.version);
        rep.uploaded.push(r.key);
      } else if (r.conflict && r.json !== undefined) {
        await local.apply(r.key, r.json, r.version);
        rep.conflicts.push(r.key);
      }
    }
  }
  return rep;
}
