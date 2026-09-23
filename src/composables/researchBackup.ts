import { getDb, dbWrite } from "@/db";

/**
 * 論文專案：單一人員資料的快照與還原（ADR-012）。
 *
 * 擁有者欄位只在根表（專案、作者名冊、期刊庫）；子表依外鍵追到擁有者的專案。
 * 檢核表範本是共用參考資料，快照只帶被引用的範本，還原時已存在就不動。
 * plugin-sql 預設不開 FK，刪除一律由深到淺手動處理。
 */

type Row = Record<string, unknown>;

export const SNAPSHOT_VERSION = 1;

export interface ResearchSnapshot {
  version: number;
  owner: string;
  exported_at: string;
  tables: Record<string, Row[]>;
}

// 子查詢：某擁有者的專案／投稿／審稿輪次／專案檢核表
const PROJECTS = "SELECT id FROM research_projects WHERE owner_his = ?";
const SUBMISSIONS = `SELECT id FROM research_submissions WHERE project_id IN (${PROJECTS})`;
const ROUNDS = `SELECT id FROM research_review_rounds WHERE submission_id IN (${SUBMISSIONS})`;
const CHECKLISTS = `SELECT id FROM research_project_checklists WHERE project_id IN (${PROJECTS})`;
const TEMPLATES = `SELECT template_id FROM research_project_checklists WHERE project_id IN (${PROJECTS})`;

/** 表名 → 取出該擁有者資料的 WHERE 條件（參數皆為 owner，出現幾次傳幾次） */
const OWNED: { table: string; where: string }[] = [
  { table: "research_projects",                where: "owner_his = ?" },
  { table: "research_authors",                 where: "owner_his = ?" },
  { table: "research_journals",                where: `owner_his = ? OR id IN (SELECT journal_id FROM research_submissions WHERE project_id IN (${PROJECTS})) OR id IN (SELECT journal_id FROM research_project_journals WHERE project_id IN (${PROJECTS}))` },
  { table: "research_project_authors",         where: `project_id IN (${PROJECTS})` },
  { table: "research_project_journals",        where: `project_id IN (${PROJECTS})` },
  { table: "research_submissions",             where: `project_id IN (${PROJECTS})` },
  { table: "research_submission_events",       where: `submission_id IN (${SUBMISSIONS})` },
  { table: "research_review_rounds",           where: `submission_id IN (${SUBMISSIONS})` },
  { table: "research_review_comments",         where: `round_id IN (${ROUNDS})` },
  { table: "research_project_checklists",      where: `project_id IN (${PROJECTS})` },
  { table: "research_project_checklist_items", where: `project_checklist_id IN (${CHECKLISTS})` },
  { table: "research_refs",                    where: `project_id IN (${PROJECTS})` },
  { table: "research_manuscript_sections",     where: `project_id IN (${PROJECTS})` },
  { table: "research_checklist_templates",     where: `id IN (${TEMPLATES})` },
  { table: "research_checklist_template_items", where: `template_id IN (${TEMPLATES})` },
];

/** 共用參考資料：還原時已存在就保留，不覆蓋 */
const SHARED = new Set(["research_checklist_templates", "research_checklist_template_items"]);
/** 有 owner_his 欄位的根表：還原時強制寫成目前擁有者 */
const ROOTS = new Set(["research_projects", "research_authors", "research_journals"]);

const params = (where: string, owner: string) => Array((where.match(/\?/g) ?? []).length).fill(owner);

export async function buildSnapshot(owner: string): Promise<ResearchSnapshot> {
  const db = await getDb();
  const tables: Record<string, Row[]> = {};
  for (const { table, where } of OWNED) {
    tables[table] = await db.select<Row[]>(`SELECT * FROM ${table} WHERE ${where}`, params(where, owner));
  }
  return { version: SNAPSHOT_VERSION, owner, exported_at: new Date().toISOString(), tables };
}

/** 此擁有者在本機是否有任何資料 */
export async function hasLocalData(owner: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    `SELECT (SELECT COUNT(*) FROM research_projects WHERE owner_his = ?) +
            (SELECT COUNT(*) FROM research_authors  WHERE owner_his = ?) AS c`,
    [owner, owner],
  );
  return (rows[0]?.c ?? 0) > 0;
}

/** 刪除此擁有者在本機的全部資料（由深到淺；共用的檢核表範本不刪） */
async function deleteOwned(owner: string): Promise<void> {
  const order = [
    "research_review_comments", "research_review_rounds", "research_submission_events",
    "research_project_checklist_items", "research_project_checklists",
    "research_project_authors", "research_project_journals", "research_refs", "research_manuscript_sections",
    "research_submissions",
  ];
  for (const table of order) {
    const { where } = OWNED.find(o => o.table === table)!;
    await dbWrite(`DELETE FROM ${table} WHERE ${where}`, params(where, owner));
  }
  for (const table of ["research_projects", "research_authors", "research_journals"]) {
    await dbWrite(`DELETE FROM ${table} WHERE owner_his = ?`, [owner]);
  }
}

/** 以快照取代此擁有者在本機的資料，不影響其他人 */
export async function restoreSnapshot(owner: string, snap: ResearchSnapshot): Promise<void> {
  if (!snap || typeof snap !== "object" || !snap.tables) throw new Error("備份格式錯誤");
  if (snap.version > SNAPSHOT_VERSION) throw new Error("備份來自較新版本的 MedBase，請先更新");
  const db = await getDb();
  await deleteOwned(owner);

  // 先寫根表再寫子表，順序同 OWNED
  for (const { table } of OWNED) {
    const rows = snap.tables[table] ?? [];
    if (!rows.length) continue;
    const cols = new Set(
      (await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`)).map(c => c.name),
    );
    for (const raw of rows) {
      const row = ROOTS.has(table) ? { ...raw, owner_his: owner } : raw;
      const keys = Object.keys(row).filter(k => cols.has(k));
      if (!keys.length) continue;
      const verb = SHARED.has(table) ? "INSERT OR IGNORE" : "INSERT OR REPLACE";
      await dbWrite(
        `${verb} INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        keys.map(k => row[k] ?? null),
      );
    }
  }
}

/** 升級前沒有擁有者的資料筆數（專案＋作者＋期刊） */
export async function countUnowned(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    `SELECT (SELECT COUNT(*) FROM research_projects WHERE owner_his IS NULL) +
            (SELECT COUNT(*) FROM research_authors  WHERE owner_his IS NULL) +
            (SELECT COUNT(*) FROM research_journals WHERE owner_his IS NULL) AS c`,
  );
  return rows[0]?.c ?? 0;
}

export async function claimUnowned(owner: string): Promise<void> {
  for (const table of ["research_projects", "research_authors", "research_journals"]) {
    await dbWrite(`UPDATE ${table} SET owner_his = ? WHERE owner_his IS NULL`, [owner]);
  }
}
