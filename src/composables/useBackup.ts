/**
 * 備份（ADR-023）：完整快照（每日自動、操作前自動、手動另存、還原）與群組 JSON 匯出／匯入。
 * 快照存在 AppData\...\backups\，由 Rust 以獨立連線 VACUUM INTO 產生（含 WAL 裡的最新資料）。
 */
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { readDir, mkdir, remove, exists, copyFile, stat, writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { getDb, closeDb, dbWrite } from "@/db";
import { useLogger } from "@/composables/useLogger";
import { useCloudSettings } from "@/stores/cloudSettings";
import { touchTable, markDeleted, syncOfLocalTable, syncTable, SYNCED_TABLES } from "@/composables/useTableSync";
import { refreshPassAhk } from "@/composables/usePhysicians";
import {
  BACKUP_GROUPS, LEGACY_TABLES, PATIENT_TABLES, GROUP_FILE_FORMAT, GROUP_FILE_VERSION,
  snapshotName, parseSnapshotName, snapshotsToPrune, hasDailyToday,
  type SnapshotKind, type SnapshotInfo, type GroupFile,
} from "@/utils/backupRegistry";

const FORCE_SYNC_MARKER = "pending-force-sync.json";
/** 附屬表：匯入後觸發主表的同步 */
const PARENT_SYNC: Record<string, string> = { item_depts: "items", set_items: "sets", surgery_type_items: "surgeryTypes" };

export const dbPath = async () => join(await appDataDir(), "medbase.db");
export async function backupDir(): Promise<string> {
  const dir = await join(await appDataDir(), "backups");
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return dir;
}

export interface Snapshot extends SnapshotInfo { path: string; size: number }

export async function listSnapshots(): Promise<Snapshot[]> {
  const dir = await backupDir();
  const out: Snapshot[] = [];
  for (const e of await readDir(dir)) {
    const info = e.isFile ? parseSnapshotName(e.name) : null;
    if (!info) continue;
    const path = await join(dir, e.name);
    const size = await stat(path).then(s => s.size).catch(() => 0);
    out.push({ ...info, path, size });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

async function prune(): Promise<void> {
  for (const s of snapshotsToPrune(await listSnapshots())) {
    await remove((s as Snapshot).path).catch(() => {});
  }
}

/** 拍一份快照到備份資料夾 */
export async function createSnapshot(kind: SnapshotKind, note = ""): Promise<Snapshot> {
  const dir = await backupDir();
  const name = snapshotName(kind, new Date(), note);
  const path = await join(dir, name);
  const size = await invoke<number>("backup_snapshot", { src: await dbPath(), dest: path, scrub: [] });
  await prune();
  useLogger().addLog("info", `[備份] 已建立快照 ${name}`);
  return { ...parseSnapshotName(name)!, path, size };
}

/** App 啟動時：今天還沒有每日快照就拍一份 */
export async function ensureDailySnapshot(): Promise<void> {
  try {
    if (hasDailyToday(await listSnapshots(), new Date())) return;
    await createSnapshot("daily");
  } catch (e) {
    useLogger().addLog("warn", "[備份] 每日自動快照失敗", String(e));
  }
}

/** 另存快照到指定位置；includePatients 為 false 時清掉病歷潤飾紀錄 */
export async function saveSnapshotAs(src: string | null, dest: string, includePatients: boolean): Promise<number> {
  if (await exists(dest)) await remove(dest);
  return invoke<number>("backup_snapshot", {
    src: src ?? await dbPath(), dest, scrub: includePatients ? [] : PATIENT_TABLES,
  });
}

/**
 * 還原：先拍「還原前」快照，關閉資料庫、覆蓋主檔、清掉 -wal／-shm 後重新啟動。
 * overwriteCloud：重新啟動後以還原的資料「覆蓋」所有逐筆同步的資料表（排班文件不在其中）。
 */
export async function restoreSnapshot(src: string, overwriteCloud: boolean): Promise<void> {
  await createSnapshot("pre-restore");
  const dir = await backupDir();
  const marker = await join(dir, FORCE_SYNC_MARKER);
  if (overwriteCloud) await writeTextFile(marker, JSON.stringify({ at: new Date().toISOString(), src }));
  else if (await exists(marker)) await remove(marker);
  const db = await dbPath();
  await closeDb();
  await copyFile(src, db);
  for (const ext of ["-wal", "-shm"]) if (await exists(db + ext)) await remove(db + ext);
  await relaunch();
}

/** App 啟動時：還原時選了「覆蓋雲端」，就把逐筆同步的資料表全部以本機覆蓋 */
export async function runPendingForceSync(): Promise<void> {
  const marker = await join(await backupDir(), FORCE_SYNC_MARKER);
  if (!(await exists(marker))) return;
  await remove(marker);
  const gasUrl = useCloudSettings().gasUrl;
  const log = useLogger();
  if (!gasUrl) { log.addLog("warn", "[備份] 還原後要覆蓋雲端，但未設定 GAS 網址"); return; }
  for (const t of SYNCED_TABLES) {
    try { await syncTable(t, gasUrl, { force: true }); }
    catch (e) { log.addLog("warn", `[備份] 還原後覆蓋雲端失敗：${t}`, String(e)); }
  }
  log.addLog("info", "[備份] 還原後已以本機資料覆蓋雲端");
}

// ── 群組 JSON 匯出／匯入 ──────────────────────────────────────────
export async function exportGroups(keys: string[]): Promise<GroupFile> {
  const db = await getDb();
  const tables: GroupFile["tables"] = {};
  for (const g of BACKUP_GROUPS.filter(g => keys.includes(g.key))) {
    for (const t of g.tables) {
      tables[t] = await db.select<Record<string, unknown>[]>(`SELECT * FROM "${t}"`).catch(() => []);
    }
  }
  return {
    format: GROUP_FILE_FORMAT, version: GROUP_FILE_VERSION, exportedAt: new Date().toISOString(),
    appVersion: await getVersion().catch(() => ""), groups: keys, tables,
  };
}

/**
 * 匯入選取的群組（mode：merge 或 replace）。先拍「匯入前」快照，整批交易寫入。
 * replace 時，本機有、檔案沒有的同步資料會寫刪除紀錄，同步後其他電腦也會刪除。
 */
export async function importGroups(file: GroupFile, modes: Record<string, "merge" | "replace">): Promise<{ rows: number; ahk: string | null }> {
  const groups = BACKUP_GROUPS.filter(g => modes[g.key]);
  if (!groups.length) return { rows: 0, ahk: null };
  await createSnapshot("pre-import");
  const db = await getDb();
  const payload: { table: string; mode: string; rows: Record<string, unknown>[] }[] = [];
  const touched = new Set<string>();
  const tombs: { name: string; key: string }[] = [];
  for (const g of groups) {
    for (const t of g.tables) {
      const rows = file.tables[t];
      if (!Array.isArray(rows)) continue;
      payload.push({ table: t, mode: modes[g.key], rows });
      const sync = syncOfLocalTable(t);
      if (sync) touched.add(sync.name);
      if (PARENT_SYNC[t]) touched.add(PARENT_SYNC[t]);
      if (sync && modes[g.key] === "replace") {
        const keep = new Set(rows.map(r => String(r[sync.key] ?? "")));
        const local = await db.select<{ k: string }[]>(`SELECT "${sync.key}" AS k FROM "${t}"`);
        for (const { k } of local) if (k && !keep.has(String(k))) tombs.push({ name: sync.name, key: String(k) });
      }
    }
  }
  const rows = await invoke<number>("backup_import", { dbPath: await dbPath(), tables: payload });
  for (const t of tombs) await markDeleted(t.name, t.key);
  await useCloudSettings().reload();
  for (const t of touched) await touchTable(t);
  const ahk = touched.has("physicians") ? await refreshPassAhk() : null;
  return { rows, ahk };
}

// ── 清空與舊表 ────────────────────────────────────────────────────
export async function clearGroups(keys: string[]): Promise<void> {
  await createSnapshot("pre-clear");
  const tables = BACKUP_GROUPS.filter(g => keys.includes(g.key)).flatMap(g => g.tables);
  if (tables.includes("physicians") && !tables.includes("sets")) await dbWrite("UPDATE sets SET physician_id = NULL");
  await invoke("backup_import", { dbPath: await dbPath(), tables: tables.map(t => ({ table: t, mode: "replace", rows: [] })) });
}

export async function existingLegacyTables(): Promise<{ table: string; rows: number }[]> {
  const db = await getDb();
  const out: { table: string; rows: number }[] = [];
  for (const t of LEGACY_TABLES) {
    const has = await db.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?", [t]);
    if (!has[0]?.c) continue;
    const n = await db.select<{ c: number }[]>(`SELECT COUNT(*) AS c FROM "${t}"`).catch(() => [{ c: 0 }]);
    out.push({ table: t, rows: n[0]?.c ?? 0 });
  }
  return out;
}

/** 清除舊表：先拍永久保留的快照，再刪表並壓縮 */
export async function dropLegacyTables(tables: string[]): Promise<void> {
  await createSnapshot("keep", "legacy");
  await invoke("backup_drop_tables", { dbPath: await dbPath(), tables });
}

export { readTextFile };
