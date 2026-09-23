import { onMounted, onUnmounted } from "vue";
import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { getDb, dbWrite } from "@/db";
import { useLogger } from "@/composables/useLogger";
import { markLocalModified, saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { autoUpdatePassAhk, getPassAhkPath } from "@/composables/usePassAhk";
import { useCloudSettings } from "@/stores/cloudSettings";

/**
 * 通用逐筆同步（ADR-009、ADR-011）。
 *
 * 過去每張表都是「整份本地資料 → GAS 清空 Sheet 重寫」，20 台以上電腦並用時
 * 任何一台儲存就會把別台新增的資料蓋掉，刪除也無法傳遞（別台再存一次就復活）。
 *
 * 現在每筆以 key 對應、以 updated_at 判斷新舊，刪除寫入 sync_tombstones。
 * 合併在 GAS 端（syncTable，持 LockService 鎖）一次完成並回傳結果，
 * 本地再依結果寫回。GAS 的 SYNC_TABLES 與這裡的 SYNC_CONFIGS 必須一致。
 *
 * uid 與 updated_at 由 SQLite trigger 維護（見 db/index.ts initSyncSchema），
 * 各頁面照常寫資料即可；刪除則需呼叫 markDeleted／markDeletedById。
 */

type Row = Record<string, unknown>;

interface SyncConfig {
  /** 顯示名稱 */
  label: string;
  /** 本地資料表 */
  localTable: string;
  /** 對應同一筆的欄位（跨電腦一致，不可用本地自動遞增 id） */
  key: string;
  /** 同步的欄位（含 key），不含 updated_at */
  fields: string[];
  /** 不可為 NULL 的欄位：雲端空字串照原樣寫入 */
  notNull?: string[];
  /** 自訂讀取（含附屬資料）；回傳列需含 fields 與 updated_at。_local_only 的列不送雲端 */
  readRows?: () => Promise<Row[]>;
  /** 自訂寫入一筆雲端資料（含 updated_at） */
  applyRow?: (row: Row, exists: boolean) => Promise<void>;
  /** 自訂刪除 */
  deleteRow?: (key: string) => Promise<void>;
  /** 刪除本地列之前（例如解除 FK 參照） */
  beforeDelete?: (key: string) => Promise<void>;
  /** 本地資料有變動之後，回傳給呼叫方 toast 的訊息 */
  afterApply?: () => Promise<string | null>;
}

const str = (v: unknown) => (v == null ? "" : String(v));

/** 與 SQLite datetime('now','localtime') 同格式，才能跟既有 updated_at 直接比字串 */
export function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const EPOCH = "1970-01-01 00:00:00";

// ── 各表附屬資料的讀寫 ─────────────────────────────────────────────

/** 自費品項：科別（item_depts）打包成逗號字串 */
async function readItems(): Promise<Row[]> {
  const db = await getDb();
  return db.select<Row[]>(`
    SELECT i.hospital_code, i.name_en, i.name_zh, i.purpose, i.unit, i.price, i.supplier, i.notes, i.updated_at,
           (SELECT group_concat(dept, ',') FROM (SELECT dept FROM item_depts d WHERE d.hospital_code = i.hospital_code ORDER BY dept)) AS depts
    FROM items i`);
}

async function applyItem(r: Row): Promise<void> {
  const code = str(r.hospital_code);
  const v = (f: string) => str(r[f]) || null;
  await dbWrite(
    `INSERT INTO items (hospital_code, name_en, name_zh, purpose, unit, price, supplier, notes, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(hospital_code) DO UPDATE SET name_en=excluded.name_en, name_zh=excluded.name_zh,
       purpose=excluded.purpose, unit=excluded.unit, price=excluded.price, supplier=excluded.supplier,
       notes=excluded.notes, updated_at=excluded.updated_at`,
    [code, v("name_en"), v("name_zh"), v("purpose"), v("unit"), v("price"), v("supplier"), v("notes"), str(r.updated_at)],
  );
  await dbWrite("DELETE FROM item_depts WHERE hospital_code = ?", [code]);
  for (const d of str(r.depts).split(",").map(s => s.trim()).filter(Boolean)) {
    await dbWrite("INSERT OR IGNORE INTO item_depts (hospital_code, dept) VALUES (?,?)", [code, d]);
  }
  // 重建科別會觸發 trigger 把 updated_at 改成現在，最後改回雲端版本
  await dbWrite("UPDATE items SET updated_at = ? WHERE hospital_code = ?", [str(r.updated_at), code]);
}

async function deleteItem(code: string): Promise<void> {
  await dbWrite("DELETE FROM item_depts WHERE hospital_code = ?", [code]);
  await dbWrite("DELETE FROM items WHERE hospital_code = ?", [code]);
}

/** 套組：參照醫師改用姓名（各電腦 physicians.id 不同），品項打包成 JSON */
async function readSets(): Promise<Row[]> {
  const db = await getDb();
  const sets = await db.select<Row[]>(`
    SELECT s.id, s.uid, s.name, s.surgery_type, p.name AS physician_name, s.notes, s.updated_at
    FROM sets s LEFT JOIN physicians p ON s.physician_id = p.id`);
  const items = await db.select<Row[]>(
    "SELECT set_id, hospital_code, quantity, is_optional, sort_order, price, notes FROM set_items ORDER BY set_id, sort_order, id",
  );
  const bySet = new Map<unknown, Row[]>();
  for (const it of items) {
    const { set_id, ...rest } = it;
    if (!bySet.has(set_id)) bySet.set(set_id, []);
    bySet.get(set_id)!.push(rest);
  }
  return sets.map(({ id, ...s }) => ({ ...s, items: JSON.stringify(bySet.get(id) ?? []) }));
}

async function applySet(r: Row, exists: boolean): Promise<void> {
  const db = await getDb();
  const uid = str(r.uid);
  const physName = str(r.physician_name).trim();
  const phys = physName
    ? await db.select<{ id: number }[]>("SELECT id FROM physicians WHERE name = ?", [physName])
    : [];
  const physId = phys[0]?.id ?? null;
  const v = (f: string) => str(r[f]) || null;
  if (exists) {
    await dbWrite(
      "UPDATE sets SET name=?, surgery_type=?, physician_id=?, notes=?, updated_at=? WHERE uid=?",
      [str(r.name), v("surgery_type"), physId, v("notes"), str(r.updated_at), uid],
    );
  } else {
    await dbWrite(
      "INSERT INTO sets (uid, name, surgery_type, physician_id, notes, updated_at) VALUES (?,?,?,?,?,?)",
      [uid, str(r.name), v("surgery_type"), physId, v("notes"), str(r.updated_at)],
    );
  }
  const row = await db.select<{ id: number }[]>("SELECT id FROM sets WHERE uid = ?", [uid]);
  const setId = row[0]?.id;
  if (setId == null) return;
  let items: Row[] = [];
  try { items = JSON.parse(str(r.items) || "[]"); } catch { /* 格式錯誤視為空 */ }
  await dbWrite("DELETE FROM set_items WHERE set_id = ?", [setId]);
  for (const it of items) {
    await dbWrite(
      "INSERT INTO set_items (set_id, hospital_code, quantity, is_optional, sort_order, price, notes) VALUES (?,?,?,?,?,?,?)",
      [setId, it.hospital_code ?? null, it.quantity ?? 1, it.is_optional ?? 0, it.sort_order ?? 0, it.price ?? null, it.notes ?? null],
    );
  }
  await dbWrite("UPDATE sets SET updated_at = ? WHERE id = ?", [str(r.updated_at), setId]);
}

async function deleteSet(uid: string): Promise<void> {
  await dbWrite("DELETE FROM set_items WHERE set_id IN (SELECT id FROM sets WHERE uid = ?)", [uid]);
  await dbWrite("DELETE FROM sets WHERE uid = ?", [uid]);
}

/** 手術術式：關聯品項打包成逗號字串 */
async function readSurgeryTypes(): Promise<Row[]> {
  const db = await getDb();
  return db.select<Row[]>(`
    SELECT t.uid, t.name, t.dept, t.notes, t.updated_at,
           (SELECT group_concat(hospital_code, ',') FROM (SELECT hospital_code FROM surgery_type_items i WHERE i.surgery_type_id = t.id ORDER BY hospital_code)) AS items
    FROM surgery_types t`);
}

async function applySurgeryType(r: Row, exists: boolean): Promise<void> {
  const db = await getDb();
  const uid = str(r.uid);
  const v = (f: string) => str(r[f]) || null;
  if (exists) {
    await dbWrite("UPDATE surgery_types SET name=?, dept=?, notes=?, updated_at=? WHERE uid=?",
      [str(r.name), v("dept"), v("notes"), str(r.updated_at), uid]);
  } else {
    await dbWrite("INSERT INTO surgery_types (uid, name, dept, notes, updated_at) VALUES (?,?,?,?,?)",
      [uid, str(r.name), v("dept"), v("notes"), str(r.updated_at)]);
  }
  const row = await db.select<{ id: number }[]>("SELECT id FROM surgery_types WHERE uid = ?", [uid]);
  const typeId = row[0]?.id;
  if (typeId == null) return;
  await dbWrite("DELETE FROM surgery_type_items WHERE surgery_type_id = ?", [typeId]);
  for (const code of str(r.items).split(",").map(s => s.trim()).filter(Boolean)) {
    await dbWrite("INSERT OR IGNORE INTO surgery_type_items (surgery_type_id, hospital_code) VALUES (?,?)", [typeId, code]);
  }
  await dbWrite("UPDATE surgery_types SET updated_at = ? WHERE id = ?", [str(r.updated_at), typeId]);
}

async function deleteSurgeryType(uid: string): Promise<void> {
  await dbWrite("DELETE FROM surgery_type_items WHERE surgery_type_id IN (SELECT id FROM surgery_types WHERE uid = ?)", [uid]);
  await dbWrite("DELETE FROM surgery_types WHERE uid = ?", [uid]);
}

/**
 * AHK 腳本：內容在各電腦的檔案裡，路徑各電腦不同，只同步檔名。
 * pass.ahk 由通訊錄帳密自動產生，不同步（避免帳密進試算表、也避免互相覆蓋）。
 * 讀不到檔案的腳本不送出，也不會蓋掉雲端版本。
 */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function readAhkScripts(): Promise<Row[]> {
  const db = await getDb();
  const passPath = await getPassAhkPath();
  const rows = await db.select<{ uid: string; name: string; file_path: string; description: string | null; updated_at: string | null }[]>(
    "SELECT uid, name, file_path, description, updated_at FROM ahk_scripts",
  );
  const out: Row[] = [];
  for (const s of rows) {
    const base = { uid: s.uid, name: s.name, description: s.description ?? "", filename: basename(s.file_path) };
    if (passPath && s.file_path === passPath) {
      out.push({ ...base, content: "", updated_at: s.updated_at, _local_only: true });
      continue;
    }
    try {
      out.push({ ...base, content: await readTextFile(s.file_path), updated_at: s.updated_at });
    } catch {
      out.push({ ...base, content: "", updated_at: EPOCH, _local_only: true });
    }
  }
  return out;
}

async function applyAhkScript(r: Row, exists: boolean): Promise<void> {
  const db = await getDb();
  const uid = str(r.uid);
  let path: string;
  if (exists) {
    path = (await db.select<{ file_path: string }[]>("SELECT file_path FROM ahk_scripts WHERE uid = ?", [uid]))[0].file_path;
  } else {
    const dir = await join(await documentDir(), "MedBase", "ahk");
    await mkdir(dir, { recursive: true }).catch(() => {});
    const filename = str(r.filename) || `${uid}.ahk`;
    path = await join(dir, filename);
    const taken = (await db.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM ahk_scripts WHERE file_path = ?", [path]))[0].c > 0;
    if (taken || await exists_(path)) path = await join(dir, `${uid.slice(0, 8)}_${filename}`);
  }
  // 試算表儲存格會把 \r\n 存成 \n，寫回 Windows 檔案時還原
  await writeTextFile(path, str(r.content).replace(/\r?\n/g, "\r\n"));
  if (exists) {
    await dbWrite("UPDATE ahk_scripts SET name=?, description=?, updated_at=? WHERE uid=?",
      [str(r.name), str(r.description), str(r.updated_at), uid]);
  } else {
    await dbWrite("INSERT INTO ahk_scripts (uid, name, file_path, description, updated_at) VALUES (?,?,?,?,?)",
      [uid, str(r.name), path, str(r.description), str(r.updated_at)]);
  }
}

function exists_(path: string): Promise<boolean> {
  return exists(path).catch(() => false);
}

// ── 同步設定 ───────────────────────────────────────────────────────

const SYNC_CONFIGS: Record<string, SyncConfig> = {
  physicians: {
    label: "通訊錄",
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
  prescriptions: {
    label: "處方套組", localTable: "prescriptions", key: "uid",
    fields: ["uid", "name", "category", "indication", "orders", "notes"], notNull: ["name", "orders"],
  },
  surgery: {
    label: "手術處置", localTable: "surgery", key: "uid",
    fields: ["uid", "name", "category", "indication", "pre_op_orders", "post_op_orders", "notes"], notNull: ["name"],
  },
  examination: {
    label: "檢查處置", localTable: "examination", key: "uid",
    fields: ["uid", "name", "his_code", "category", "indication", "orders", "notes"], notNull: ["name"],
  },
  disease: {
    label: "疾病常規", localTable: "disease", key: "uid",
    fields: ["uid", "name", "icd10", "category", "workup", "treatment_orders", "consult_flow", "notes"], notNull: ["name"],
  },
  shiftMemos: {
    label: "規則備忘錄", localTable: "shift_memos", key: "uid",
    fields: ["uid", "category", "title", "content", "sort_order"], notNull: ["category", "title", "content"],
  },
  contacts: {
    label: "常用分機", localTable: "contacts", key: "uid",
    fields: ["uid", "label", "ext", "category", "notes"], notNull: ["label", "ext"],
  },
  items: {
    label: "自費品項", localTable: "items", key: "hospital_code",
    fields: ["hospital_code", "name_en", "name_zh", "purpose", "unit", "price", "supplier", "notes", "depts"],
    readRows: readItems, applyRow: applyItem, deleteRow: deleteItem,
  },
  sets: {
    label: "套組管理", localTable: "sets", key: "uid",
    fields: ["uid", "name", "surgery_type", "physician_name", "notes", "items"],
    readRows: readSets, applyRow: applySet, deleteRow: deleteSet,
  },
  surgeryTypes: {
    label: "手術術式", localTable: "surgery_types", key: "uid",
    fields: ["uid", "name", "dept", "notes", "items"],
    readRows: readSurgeryTypes, applyRow: applySurgeryType, deleteRow: deleteSurgeryType,
  },
  ahk: {
    label: "AHK 管理", localTable: "ahk_scripts", key: "uid",
    fields: ["uid", "name", "description", "filename", "content"],
    readRows: readAhkScripts, applyRow: applyAhkScript,
  },
};

/** 逐筆同步的表（App.vue 背景同步逐一處理） */
export const SYNCED_TABLES = Object.keys(SYNC_CONFIGS);

export function syncLabel(table: string): string {
  return SYNC_CONFIGS[table]?.label ?? table;
}

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

/** 記錄刪除（在 DELETE 本地列之前或之後皆可） */
export async function markDeleted(table: string, key: string): Promise<void> {
  if (!key) return;
  await dbWrite(
    "INSERT OR REPLACE INTO sync_tombstones (tbl, key, deleted_at) VALUES (?, ?, ?)",
    [table, key, nowLocal()],
  );
}

/** 以本地 id 記錄刪除（uid 為 key 的表），須在 DELETE 之前呼叫 */
export async function markDeletedById(table: string, id: number): Promise<void> {
  const cfg = SYNC_CONFIGS[table];
  if (!cfg) return;
  const db = await getDb();
  const rows = await db.select<{ k: string }[]>(`SELECT ${cfg.key} AS k FROM ${cfg.localTable} WHERE id = ?`, [id]);
  if (rows[0]?.k) await markDeleted(table, rows[0].k);
}

// ── 本地修改後自動同步 ───────────────────────────────────────────

const touchTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 本地資料有異動（新增／修改／刪除）後呼叫：標記修改並在短暫延遲後同步。
 * 連續編輯（例如備忘錄自動儲存）只會送出一次。
 */
export async function touchTable(table: string): Promise<void> {
  await markLocalModified(table);
  const prev = touchTimers.get(table);
  if (prev) clearTimeout(prev);
  touchTimers.set(table, setTimeout(() => {
    touchTimers.delete(table);
    const gasUrl = useCloudSettings().gasUrl;
    if (!gasUrl) return;
    syncTable(table, gasUrl).catch((e) => {
      const label = syncLabel(table);
      if (e instanceof NoBaselineError) useLogger().addLog("info", `[雲端同步] ${label}尚未建立同步基準，暫停自動同步`);
      else useLogger().addLog("warn", `[雲端同步] ${label}同步失敗`, String(e));
    });
  }, 1500));
}

/** 上次同步之後，本地是否有修改或刪除（背景同步據此決定要不要送） */
export async function hasLocalChanges(table: string): Promise<boolean> {
  const cfg = SYNC_CONFIGS[table];
  if (!cfg) return false;
  const db = await getDb();
  const last = (await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key = ?", [`${table}_last_sync_local`],
  ))[0]?.value;
  if (!last) return true;
  const a = (await db.select<{ m: string | null }[]>(`SELECT MAX(updated_at) AS m FROM ${cfg.localTable}`))[0]?.m ?? "";
  const b = (await db.select<{ m: string | null }[]>("SELECT MAX(deleted_at) AS m FROM sync_tombstones WHERE tbl = ?", [table]))[0]?.m ?? "";
  return a >= last || b >= last;
}

// ── 同步完成通知（頁面據此重新載入）─────────────────────────────

export const TABLE_SYNCED_EVENT = "medbase:table-synced";

/** 該表同步後本地有變動時呼叫 cb（背景同步、其他頁面觸發的同步都適用） */
export function onTableSynced(table: string, cb: () => void) {
  const handler = (e: Event) => {
    if ((e as CustomEvent<{ table: string }>).detail?.table === table) cb();
  };
  onMounted(() => window.addEventListener(TABLE_SYNCED_EVENT, handler));
  onUnmounted(() => window.removeEventListener(TABLE_SYNCED_EVENT, handler));
}

// ── 同步本體 ───────────────────────────────────────────────────────

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

async function defaultRead(cfg: SyncConfig): Promise<Row[]> {
  const db = await getDb();
  return db.select<Row[]>(`SELECT ${[...cfg.fields, "updated_at"].join(", ")} FROM ${cfg.localTable}`);
}

async function defaultApply(cfg: SyncConfig, r: Row, exists: boolean): Promise<void> {
  const val = (f: string) => {
    const s = str(r[f]);
    return s || (cfg.notNull?.includes(f) ? "" : null);
  };
  const ts = str(r.updated_at) || EPOCH;
  if (exists) {
    await dbWrite(
      `UPDATE ${cfg.localTable} SET ${cfg.fields.map(f => `${f} = ?`).join(", ")}, updated_at = ? WHERE ${cfg.key} = ?`,
      [...cfg.fields.map(val), ts, str(r[cfg.key])],
    );
  } else {
    await dbWrite(
      `INSERT INTO ${cfg.localTable} (${[...cfg.fields, "updated_at"].join(", ")}) VALUES (${cfg.fields.map(() => "?").join(", ")}, ?)`,
      [...cfg.fields.map(val), ts],
    );
  }
}

async function runSync(table: string, gasUrl: string, force: boolean): Promise<SyncResult> {
  const cfg = SYNC_CONFIGS[table];
  if (!cfg) throw new Error(`未設定同步的資料表：${table}`);
  const { addLog } = useLogger();
  const db = await getDb();
  const startedAt = nowLocal();

  const localRows = cfg.readRows ? await cfg.readRows() : await defaultRead(cfg);
  const localMap = new Map(localRows.map(r => [str(r[cfg.key]), r]));
  const sendRows = localRows
    .filter(r => !r._local_only && str(r[cfg.key]))
    .map(r => Object.fromEntries([...cfg.fields, "updated_at"].map(f => [f, r[f] ?? null])));
  const localTombs = await db.select<{ key: string; deleted_at: string }[]>(
    "SELECT key, deleted_at FROM sync_tombstones WHERE tbl = ?", [table],
  );

  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "syncTable", table, rows: sendRows, tombstones: localTombs, now: startedAt, force }),
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
    const lr = localMap.get(key);
    // 本地沒送出的列（例如讀不到檔案）一律以雲端為準
    if (lr && !lr._local_only && str(cr.updated_at) <= str(lr.updated_at)) continue;
    const exists = !!lr;
    if (cfg.applyRow) await cfg.applyRow(cr, exists);
    else await defaultApply(cfg, cr, exists);
    if (!exists) inserted++;
    else if (cfg.fields.some(f => str(lr[f]) !== str(cr[f]))) updated++;
  }

  // ── 套用刪除：本地列比刪除時間新則保留（同步途中剛被改過） ──
  for (const t of cloudTombs) {
    const local = await db.select<{ updated_at: string | null }[]>(
      `SELECT updated_at FROM ${cfg.localTable} WHERE ${cfg.key} = ?`, [t.key],
    );
    if (!local.length || str(local[0].updated_at) > str(t.deleted_at)) continue;
    await cfg.beforeDelete?.(t.key);
    if (cfg.deleteRow) await cfg.deleteRow(t.key);
    else await dbWrite(`DELETE FROM ${cfg.localTable} WHERE ${cfg.key} = ?`, [t.key]);
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
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [`${table}_last_sync_local`, startedAt]);
  const changed = inserted + updated + deleted > 0;
  const message = changed ? (await cfg.afterApply?.()) ?? null : null;
  if (changed) window.dispatchEvent(new CustomEvent(TABLE_SYNCED_EVENT, { detail: { table } }));

  addLog(
    "info",
    `[雲端同步] ${force ? "覆蓋" : "同步"} ${cfg.label} — 新增 ${inserted}、更新 ${updated}、刪除 ${deleted}`,
    JSON.stringify({ table, force, sent: sendRows.length, cloud: cloudRows.length, inserted, updated, deleted, timestamp: new Date().toISOString() }),
  );
  return { inserted, updated, deleted, message };
}
