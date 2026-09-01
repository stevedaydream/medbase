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
          "INSERT INTO physicians (name, department, title, ext, his_account, his_password, notes) VALUES (?,?,?,?,?,?,?)",
          [p.name, p.department, p.title, p.ext, p.his_account, p.his_password, p.notes]
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

  // ⑥ 病歷潤飾格式範本（首次建立 or 遷移到 profile 架構）
  const ntRows = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM note_templates");
  if (ntRows[0].c === 0) {
    for (const t of seedNoteTemplates) {
      await db.execute(
        "INSERT OR IGNORE INTO note_templates (format_key, profile, format_label, system_prompt, example) VALUES (?,?,?,?,?)",
        [t.format_key, 'default', t.format_label, t.system_prompt, t.example]
      );
    }
  }
}

async function initSchema(db: Database) {
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

  // ── 病歷潤飾格式範本（v2：加入 profile 欄位，複合主鍵）────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS note_templates (
      format_key    TEXT NOT NULL,
      profile       TEXT NOT NULL DEFAULT 'default',
      format_label  TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      example       TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (format_key, profile)
    );
  `);
  // 舊版（format_key 為單一 PK）遷移至 v2 複合主鍵
  try {
    await db.select("SELECT profile FROM note_templates LIMIT 1");
  } catch {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS note_templates_v2 (
        format_key    TEXT NOT NULL,
        profile       TEXT NOT NULL DEFAULT 'default',
        format_label  TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        example       TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (format_key, profile)
      )
    `);
    await db.execute(`
      INSERT OR IGNORE INTO note_templates_v2 (format_key, profile, format_label, system_prompt, example)
      SELECT format_key, 'default', format_label, system_prompt, example FROM note_templates
    `);
    await db.execute(`DROP TABLE note_templates`);
    await db.execute(`ALTER TABLE note_templates_v2 RENAME TO note_templates`);
  }

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

  // ── Research 論文專案管理 ─────────────────────────────────────
  await initResearchSchema(db);
}

/**
 * Research 模組（論文專案管理）schema v1。
 *
 * 命名：全表以 `research_` 前綴，與 scheduler_ / acp_ / ahk_ 等子系統一致，
 *       避免 projects / authors 這類泛用名日後與其他模組相撞。
 * 主鍵：TEXT（UUID v4），由 useResearch 的 newId() 產生。
 * 版本：app_settings 的 research_schema_version，日後改欄位據此 migration。
 *
 * 去識別化（規格 §6）：本模組不得存放任何可識別病患資訊，
 * 因此 schema 內刻意沒有姓名／病歷號／生日／住院日期／影像等欄位。
 */
async function initResearchSchema(db: Database) {
  // ── 論文專案 ────────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_projects (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      title_zh          TEXT,
      study_type        TEXT,
      specialty         TEXT,
      stage             TEXT NOT NULL DEFAULT 'idea',
      deident_confirmed INTEGER NOT NULL DEFAULT 0,
      repo_path         TEXT,
      irb_number        TEXT,
      irb_approved_date TEXT,
      created_at        TEXT DEFAULT (datetime('now','localtime')),
      updated_at        TEXT DEFAULT (datetime('now','localtime')),
      archived          INTEGER DEFAULT 0
    );
  `);

  // ── 作者名冊（跨專案共用）────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_authors (
      id           TEXT PRIMARY KEY,
      name_zh      TEXT NOT NULL,
      name_en      TEXT,
      title        TEXT,
      department   TEXT,
      affiliation  TEXT,
      email        TEXT,
      default_role TEXT,
      orcid        TEXT,
      created_at   TEXT DEFAULT (datetime('now','localtime')),
      updated_at   TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // ── 專案作者（含 IRB 欄位）──────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_project_authors (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      author_id        TEXT NOT NULL REFERENCES research_authors(id)  ON DELETE CASCADE,
      author_order     INTEGER DEFAULT 0,
      is_corresponding INTEGER DEFAULT 0,
      irb_category     TEXT,
      work_months      INTEGER,
      work_scope       TEXT,
      contribution     TEXT
    );
  `);

  // ── 期刊候選庫（跨專案共用）──────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_journals (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      indexing            TEXT,
      impact_factor       REAL,
      quartile            TEXT,
      accepts_case_report INTEGER,
      apc_usd             INTEGER,
      word_limit          INTEGER,
      abstract_limit      INTEGER,
      ref_style           TEXT,
      guide_url           TEXT,
      submission_url      TEXT,
      notes               TEXT,
      updated_at          TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // ── 專案的期刊候選（shortlisted / submitted / rejected_here / ruled_out）
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_project_journals (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      journal_id TEXT NOT NULL REFERENCES research_journals(id) ON DELETE CASCADE,
      status     TEXT DEFAULT 'shortlisted',
      sort_order INTEGER DEFAULT 0,
      notes      TEXT
    );
  `);

  // ── 投稿記錄（一專案可多筆：被拒後換期刊）────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_submissions (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      journal_id     TEXT REFERENCES research_journals(id),
      submitted_date TEXT,
      manuscript_id  TEXT,
      status         TEXT DEFAULT 'preparing',
      decision_date  TEXT,
      apc_paid_usd   INTEGER,
      notes          TEXT
    );
  `);

  // ── 狀態歷程（只新增不修改）──────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_submission_events (
      id            TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES research_submissions(id) ON DELETE CASCADE,
      event_date    TEXT,
      from_status   TEXT,
      to_status     TEXT,
      note          TEXT
    );
  `);

  // ── 送件檢核（範本 → 專案實例）──────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_checklist_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      source_url  TEXT,
      description TEXT
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_checklist_template_items (
      id          TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES research_checklist_templates(id) ON DELETE CASCADE,
      item_no     TEXT,
      section     TEXT,
      description TEXT
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_project_checklists (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL REFERENCES research_checklist_templates(id),
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_project_checklist_items (
      id                   TEXT PRIMARY KEY,
      project_checklist_id TEXT NOT NULL REFERENCES research_project_checklists(id) ON DELETE CASCADE,
      template_item_id     TEXT NOT NULL REFERENCES research_checklist_template_items(id),
      status               TEXT DEFAULT 'pending',
      location             TEXT,
      note                 TEXT
    );
  `);

  // ── 審稿回覆 ────────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_review_rounds (
      id            TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES research_submissions(id) ON DELETE CASCADE,
      round_no      INTEGER DEFAULT 1,
      received_date TEXT,
      due_date      TEXT,
      decision      TEXT
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_review_comments (
      id                TEXT PRIMARY KEY,
      round_id          TEXT NOT NULL REFERENCES research_review_rounds(id) ON DELETE CASCADE,
      reviewer_label    TEXT,
      comment_no        INTEGER,
      comment_text      TEXT,
      response_text     TEXT,
      manuscript_change TEXT,
      status            TEXT DEFAULT 'pending'
    );
  `);

  // ── 引用追蹤（verified=0 代表尚未回原文核對，用來擋幻覺引用）──
  await db.execute(`
    CREATE TABLE IF NOT EXISTS research_refs (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      citation_key TEXT,
      title        TEXT,
      journal      TEXT,
      year         INTEGER,
      doi          TEXT,
      pmid         TEXT,
      verified     INTEGER DEFAULT 0,
      pdf_path     TEXT,
      note         TEXT
    );
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_projects_stage   ON research_projects(stage);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_projects_updated ON research_projects(updated_at);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_pa_project       ON research_project_authors(project_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_pa_author        ON research_project_authors(author_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_pj_project       ON research_project_journals(project_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_sub_project      ON research_submissions(project_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_ev_submission    ON research_submission_events(submission_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_cti_template     ON research_checklist_template_items(template_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_pc_project       ON research_project_checklists(project_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_pci_checklist    ON research_project_checklist_items(project_checklist_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_rr_submission    ON research_review_rounds(submission_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_rc_round         ON research_review_comments(round_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_research_refs_project     ON research_refs(project_id);`);

  await db.execute(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('research_schema_version', '1')`
  );
}
