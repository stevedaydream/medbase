import Database from "@tauri-apps/plugin-sql";
import { seedPhysicians, seedContacts, seedAppSettings, seedNoteTemplates } from "./seed";
import { sha256 } from "@/utils/sha256";

let db: Database | null = null;
let _writeChain: Promise<void> = Promise.resolve();

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}

export async function dbWrite(sql: string, params?: unknown[]): Promise<import("@tauri-apps/plugin-sql").QueryResult> {
  const database = await getDb();
  let resolve!: () => void;
  const prev = _writeChain;
  _writeChain = new Promise(r => { resolve = r; });
  try {
    await prev;
    return await database.execute(sql, params ?? []);
  } finally {
    resolve();
  }
}

export async function getDb(): Promise<Database> {
  if (!db) {
    // _busy_timeout 寫進 URL，讓連線池的每條連線都自動套用
    db = await Database.load("sqlite:medbase.db");
    await db.execute("PRAGMA journal_mode=WAL");
    await db.execute("PRAGMA busy_timeout=5000");
    await initSchema(db);
    await seedIfEmpty(db);
  }
  return db;
}

/** 只在第一次（items 為空時）匯入種子資料 */
async function seedIfEmpty(db: Database) {
  // ① 醫師通訊錄
  if (seedPhysicians.length > 0) {
    const rows = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM physicians");
    if (rows[0].c === 0) {
      for (const p of seedPhysicians) {
        await db.execute(
          "INSERT INTO physicians (name, department, title, ext, his_account, his_password, phs_account, phs_password, notes) VALUES (?,?,?,?,?,?,?,?,?)",
          [p.name, p.department, p.title, p.ext, p.his_account, p.his_password, p.phs_account, p.phs_password, p.notes]
        );
      }
      console.log("[seed] imported", seedPhysicians.length, "physicians");
    }
  }

  // ② 常用分機
  if (seedContacts.length > 0) {
    const rows = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM contacts");
    if (rows[0].c === 0) {
      for (const c of seedContacts) {
        await db.execute(
          "INSERT INTO contacts (label, ext, category, notes) VALUES (?,?,?,?)",
          [c.label, c.ext, c.category, c.notes]
        );
      }
      console.log("[seed] imported", seedContacts.length, "contacts");
    }
  }

  // ③ Scheduler super 帳號（預設密碼 Admin0000，首次啟動建立）
  const superRow = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) as c FROM scheduler_users WHERE code = 'super'"
  );
  if (superRow[0].c === 0) {
    const hash = await sha256("Admin0000");
    await db.execute(
      "INSERT INTO scheduler_users (code, name, role, pw_hash, is_active, sort_order, employee_id) VALUES (?, ?, ?, ?, 1, 0, ?)",
      ["super", "系統管理員", "super", hash, "super"]
    );
    console.log("[seed] created default super account (Admin0000)");
  }

  // ④ ACP Categories Seed
  const acpRows = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM acp_categories");
  if (acpRows[0].c === 0) {
    const defaultCats = [
      { name: "一般囑言", reasons: ["臨床不適用", "已有替代醫囑", "家屬拒絕", "非本次住院範圍"] },
      { name: "藥囑", reasons: ["已有同類藥物", "過敏風險", "腎功能不佳", "家屬拒絕自費"] },
      { name: "處置", reasons: ["家屬拒絕", "解剖構造不適合", "已有侵入性替代方案", "病人已轉院/出院"] }
    ];
    for (const cat of defaultCats) {
      await db.execute("INSERT INTO acp_categories (name, na_reasons) VALUES (?, ?)", 
        [cat.name, JSON.stringify(cat.reasons)]);
    }
    console.log("[seed] imported default ACP categories");
  }

  // ⑤ 雲端設定預設值（INSERT OR IGNORE：已存在的 key 不覆蓋）
  for (const s of seedAppSettings) {
    await db.execute(
      "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
      [s.key, s.value]
    );
  }

  // ⑥ 病歷潤飾格式範本（首次建立）
  const ntRows = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM note_templates");
  if (ntRows[0].c === 0) {
    for (const t of seedNoteTemplates) {
      await db.execute(
        "INSERT OR IGNORE INTO note_templates (format_key, format_label, system_prompt, example) VALUES (?,?,?,?)",
        [t.format_key, t.format_label, t.system_prompt, t.example]
      );
    }
  }
}

async function initSchema(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      generic_name TEXT,
      synonyms TEXT,          -- JSON array
      category TEXT,
      route TEXT,             -- IV / PO / IM / SC
      dose TEXT,
      iv_rate TEXT,
      warnings TEXT,          -- JSON array (防呆紅字)
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      indication TEXT,
      orders TEXT NOT NULL,   -- JSON array of order lines
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS surgery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      indication TEXT,
      pre_op_orders TEXT,     -- JSON
      post_op_orders TEXT,    -- JSON
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS disease (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icd10 TEXT,
      category TEXT,
      workup TEXT,            -- JSON：入院需開的 labs/影像
      treatment_orders TEXT,  -- JSON：常規醫囑
      consult_flow TEXT,      -- TEXT：會診流程（每行一步）
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS examination (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      his_code TEXT,          -- HIS 系統開單代碼
      category TEXT,
      indication TEXT,
      orders TEXT,            -- JSON：開單注意事項
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── 自費耗材主表 ────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS items (
      hospital_code TEXT    PRIMARY KEY,
      name_en       TEXT,
      name_zh       TEXT,
      purpose       TEXT,    -- 產品用途（止血劑/Mesh/骨板…），約12種固定值
      unit          TEXT,
      price         INTEGER,
      supplier      TEXT,
      notes         TEXT
    );
  `);

  // ── 品項科別多對多（一品項可屬多科）────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS item_depts (
      hospital_code TEXT NOT NULL REFERENCES items(hospital_code) ON DELETE CASCADE,
      dept          TEXT NOT NULL,
      PRIMARY KEY (hospital_code, dept)
    );
  `);

  // ── 套組（physician_id → physicians，無 doctor_id）──
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      surgery_type  TEXT,
      physician_id  INTEGER REFERENCES physicians(id),
      department_id INTEGER,
      notes         TEXT
    );
  `);

  // ── 套組耗材明細 ─────────────────────────────────
  // hospital_code advisory FK（部分耗材不在 items 主表）
  // is_optional=1 表示 PRN（按需，取代 quantity=NULL）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS set_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id        INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
      hospital_code TEXT,
      quantity      INTEGER DEFAULT 1,
      is_optional   INTEGER DEFAULT 0,
      sort_order    INTEGER DEFAULT 0,
      price         INTEGER,
      notes         TEXT
    );
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_purpose    ON items(purpose);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_name_zh    ON items(name_zh);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_items_code       ON items(hospital_code);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_item_depts_code  ON item_depts(hospital_code);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sets_physician   ON sets(physician_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sets_dept        ON sets(department_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sets_surgery     ON sets(surgery_type);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_set_items_set    ON set_items(set_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_set_items_code   ON set_items(hospital_code);`);

  // ── 醫師通訊錄（is_vs 標記套組 VS）──────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS physicians (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      department   TEXT,
      title        TEXT,
      ext          TEXT,
      his_account  TEXT,
      his_password TEXT,
      phs_account  TEXT,
      phs_password TEXT,
      is_vs        INTEGER DEFAULT 0,
      notes        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS emergency_protocols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      triggers TEXT,           -- JSON array
      immediate_actions TEXT,  -- JSON array
      critical_meds TEXT,      -- JSON array
      timers TEXT,             -- JSON array [{label, seconds}]
      contacts TEXT,           -- JSON array [{label, ext}]
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── App 全域設定（key-value）────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // ── 排班系統使用者（含角色與密碼 hash）──────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS scheduler_users (
      code        TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'employee',
      pw_hash     TEXT    NOT NULL,
      is_active   INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      employee_id TEXT    UNIQUE
    );
  `);
  // Migration: 舊資料庫補欄位（忽略已存在錯誤）
  try {
    await db.execute(`ALTER TABLE scheduler_users ADD COLUMN employee_id TEXT UNIQUE`);
  } catch { /* 欄位已存在，忽略 */ }
  // 回填：沒有 employee_id 的舊帳號以 code 補上
  await db.execute(`UPDATE scheduler_users SET employee_id = code WHERE employee_id IS NULL`);

  // ── AHK 腳本（元資料，內容存磁碟）──────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ahk_scripts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      file_path   TEXT    NOT NULL UNIQUE,
      description TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── AHK 套組（profile）──────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ahk_groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── 套組 ↔ 腳本（多對多）────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ahk_group_scripts (
      group_id   INTEGER NOT NULL REFERENCES ahk_groups(id)  ON DELETE CASCADE,
      script_id  INTEGER NOT NULL REFERENCES ahk_scripts(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (group_id, script_id)
    );
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ahk_group_scripts_group ON ahk_group_scripts(group_id);`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      ext TEXT NOT NULL,
      category TEXT DEFAULT '常用分機',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── ACP (Advance Care Planning) 評估系統 ──────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS acp_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      na_reasons TEXT    NOT NULL DEFAULT '[]'
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS acp_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS acp_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id INTEGER REFERENCES acp_sets(id) ON DELETE CASCADE,
      category_type TEXT NOT NULL, -- 'general', 'medication', 'procedure'
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS acp_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      set_name TEXT,
      total_expected INTEGER,
      total_prescribed INTEGER,
      total_na INTEGER,
      completion_rate REAL,
      details_json TEXT,         -- 存儲完整評估明細與統計快照
      notes TEXT
    );
  `);

  // ── ICD 診斷碼查詢（ICD-9 / ICD-10）────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS icd_codes (
      code           TEXT PRIMARY KEY,
      version        TEXT NOT NULL DEFAULT 'ICD10',  -- 'ICD9' | 'ICD10'
      description_zh TEXT NOT NULL DEFAULT '',
      description_en TEXT NOT NULL DEFAULT '',
      category       TEXT NOT NULL DEFAULT ''
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_icd_version ON icd_codes(version);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_icd_desczh  ON icd_codes(description_zh);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_icd_ver_code ON icd_codes(version, code);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_icd_ver_zh   ON icd_codes(version, description_zh);`);
  try { await db.execute(`ALTER TABLE icd_codes ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0`); } catch { /* 已存在 */ }
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_icd_starred ON icd_codes(version, is_starred);`);

  // ── 上班規則備忘錄 ─────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shift_memos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      category   TEXT    NOT NULL DEFAULT '一般',
      title      TEXT    NOT NULL,
      content    TEXT    NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT    DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // ── 輪序快照（每月池狀態 + 預算投影）────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rotation_snapshots (
      yyyymm          TEXT PRIMARY KEY,
      pools_json      TEXT NOT NULL,
      end_pools_json  TEXT,
      projected_json  TEXT,
      staff_sig       TEXT,
      committed       INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now','localtime')),
      updated_at      TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // ── Debug 操作記錄（保留 7 天，供測試期分析用）──────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS debug_logs (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT    NOT NULL,
      ts      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      level   TEXT    NOT NULL DEFAULT 'info',
      route   TEXT,
      message TEXT    NOT NULL,
      detail  TEXT
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_debug_logs_ts ON debug_logs(ts);`);
  // 自動清除 7 天前的紀錄
  await db.execute(`DELETE FROM debug_logs WHERE ts < datetime('now','-7 days','localtime');`);

  // ── 手術術式（供自費品項快速篩選用）──────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS surgery_types (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT    NOT NULL,
      dept  TEXT,
      notes TEXT
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS surgery_type_items (
      surgery_type_id INTEGER NOT NULL REFERENCES surgery_types(id) ON DELETE CASCADE,
      hospital_code   TEXT    NOT NULL,
      PRIMARY KEY (surgery_type_id, hospital_code)
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sti_surgery ON surgery_type_items(surgery_type_id);`);

  // ── 雙軌同步：補 updated_at 欄位（舊資料庫兼容）────────────
  try { await db.execute(`ALTER TABLE physicians ADD COLUMN updated_at TEXT`); } catch { /* 已存在 */ }
  try { await db.execute(`ALTER TABLE contacts   ADD COLUMN updated_at TEXT`); } catch { /* 已存在 */ }
  await db.execute(`UPDATE physicians SET updated_at = datetime('now','localtime') WHERE updated_at IS NULL`);
  await db.execute(`UPDATE contacts   SET updated_at = datetime('now','localtime') WHERE updated_at IS NULL`);

  // ── 病歷潤飾格式範本 ──────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS note_templates (
      format_key    TEXT PRIMARY KEY,
      format_label  TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      example       TEXT NOT NULL DEFAULT ''
    );
  `);

  // ── 病歷潤飾歷史記錄 ──────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS note_records (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id   TEXT NOT NULL DEFAULT '',
      patient_name TEXT NOT NULL DEFAULT '',
      bed_no       TEXT NOT NULL DEFAULT '',
      format_key   TEXT NOT NULL DEFAULT '',
      format_label TEXT NOT NULL DEFAULT '',
      model        TEXT NOT NULL DEFAULT '',
      input_text   TEXT NOT NULL DEFAULT '',
      output_text  TEXT NOT NULL DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_note_records_patient ON note_records(patient_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_note_records_name    ON note_records(patient_name);`);
}
