/**
 * Research 模組（論文專案管理）資料層。
 *
 * 沿用既有做法：前端直接走 @tauri-apps/plugin-sql，讀用 getDb().select()、
 * 寫一律走 dbWrite()（見 project_conventions.md §3）。本模組不新增 Rust command。
 *
 * 規格 §4「查詢走 SQL，不在前端做全表過濾」：篩選條件全部下推到 WHERE。
 */

import { getDb, dbWrite } from "@/db";

// ── 常數 ────────────────────────────────────────────────────────────

export type Stage =
  | "idea" | "irb" | "drafting" | "submitted"
  | "under_review" | "revision" | "accepted" | "published" | "rejected";

/** 語意色只有三種（規格 §4）：中性＝進行中、警示＝需行動、成功＝已完成 */
export type StageTone = "neutral" | "warn" | "success";

export interface StageMeta { key: Stage; label: string; tone: StageTone }

/** 主線階段，UI 進度條依此順序繪製 */
export const STAGE_FLOW: StageMeta[] = [
  { key: "idea",         label: "構想",   tone: "neutral" },
  { key: "irb",          label: "IRB",    tone: "neutral" },
  { key: "drafting",     label: "撰稿",   tone: "neutral" },
  { key: "submitted",    label: "已投稿", tone: "neutral" },
  { key: "under_review", label: "審稿中", tone: "neutral" },
  { key: "revision",     label: "修改中", tone: "warn"    },
  { key: "accepted",     label: "已接受", tone: "success" },
  { key: "published",    label: "已刊登", tone: "success" },
];

/** rejected 是分支不是終點：拒稿後可回到 submitted 換期刊（規格 §2.2） */
export const STAGE_REJECTED: StageMeta = { key: "rejected", label: "被拒", tone: "warn" };

export const ALL_STAGES: StageMeta[] = [...STAGE_FLOW, STAGE_REJECTED];

export function stageMeta(stage: string): StageMeta {
  return ALL_STAGES.find(s => s.key === stage) ?? { key: "idea", label: stage, tone: "neutral" };
}

export function stageIndex(stage: string): number {
  return STAGE_FLOW.findIndex(s => s.key === stage);
}

export const STUDY_TYPES = [
  { key: "case_report",   label: "個案報告" },
  { key: "case_series",   label: "系列個案" },
  { key: "retrospective", label: "回溯性研究" },
  { key: "prospective",   label: "前瞻性研究" },
  { key: "review",        label: "文獻回顧" },
  { key: "other",         label: "其他" },
];

export function studyTypeLabel(key: string | null): string {
  return STUDY_TYPES.find(t => t.key === key)?.label ?? "—";
}

/** IRB 表格的角色分類（規格 §2.4） */
export const IRB_CATEGORIES = ["主持人", "協同主持人", "研究護理師", "研究助理"];

/** 停滯門檻（規格 §3.1） */
const STALL_UNDER_REVIEW_DAYS = 90;
const STALL_ANY_STAGE_DAYS    = 180;

// ── 型別 ────────────────────────────────────────────────────────────

export interface ResearchProject {
  id: string;
  title: string;
  title_zh: string | null;
  study_type: string | null;
  specialty: string | null;
  stage: Stage;
  deident_confirmed: number;
  repo_path: string | null;
  irb_number: string | null;
  irb_approved_date: string | null;
  created_at: string;
  updated_at: string;
  archived: number;
}

export interface ProjectListRow extends ResearchProject {
  /** 目前（最近一次）投稿的期刊名稱；尚未投稿為 null */
  journal_name: string | null;
  /** 距上次狀態變更天數 */
  days_since_update: number;
}

export interface ResearchAuthor {
  id: string;
  name_zh: string;
  name_en: string | null;
  title: string | null;
  department: string | null;
  affiliation: string | null;
  email: string | null;
  default_role: string | null;
  orcid: string | null;
}

export interface ProjectAuthorRow {
  id: string;
  project_id: string;
  author_id: string;
  author_order: number;
  is_corresponding: number;
  irb_category: string | null;
  work_months: number | null;
  work_scope: string | null;
  contribution: string | null;
  // 從 research_authors join 進來
  name_zh: string;
  name_en: string | null;
  title: string | null;
  department: string | null;
  affiliation: string | null;
  default_role: string | null;
}

export interface ProjectFilter {
  search?: string;
  stage?: string;
  studyType?: string;
  archived?: boolean;
}

// ── 工具 ────────────────────────────────────────────────────────────

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 後備：非 secure context 時 randomUUID 不存在
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 今天，YYYY-MM-DD */
export function today(): string {
  return nowLocal().slice(0, 10);
}

/**
 * 停滯判定（規格 §3.1）：under_review 超過 90 天，或任何階段超過 180 天沒動。
 * 已完成（accepted / published）與已封存不算停滯。
 */
export function isStalled(row: ProjectListRow): boolean {
  if (row.archived) return false;
  if (row.stage === "accepted" || row.stage === "published") return false;
  if (row.stage === "under_review" && row.days_since_update > STALL_UNDER_REVIEW_DAYS) return true;
  return row.days_since_update > STALL_ANY_STAGE_DAYS;
}

/**
 * 輕量病患識別資訊偵測（規格 §6.3）。
 * 只警告不阻擋 —— 誤判擋掉正常內容比漏警告更討厭。
 */
export function phiWarning(text: string | null | undefined): string | null {
  if (!text) return null;
  if (/(?<!\d)\d{7,10}(?!\d)/.test(text))            return "偵測到疑似病歷號的連續數字，請確認未輸入病患識別資訊";
  if (/(?<![A-Za-z])[A-Za-z]\d{9}(?!\d)/.test(text)) return "偵測到疑似身分證字號格式，請確認未輸入病患識別資訊";
  return null;
}

/**
 * 組出可直接貼進醫院 IRB 表格的工作範圍文字（規格 §3.3）。
 * 樣板：{name}（工作月數：{work_months}）\n{irb_category}；{work_scope}
 */
export function buildIrbText(rows: ProjectAuthorRow[]): string {
  return rows
    .slice()
    .sort((a, b) => (a.author_order ?? 0) - (b.author_order ?? 0))
    .map(r => {
      const months = r.work_months ?? "";
      const body   = [r.irb_category, r.work_scope].filter(Boolean).join("；");
      return `${r.name_zh}（工作月數：${months}）\n${body}`;
    })
    .join("\n\n");
}

// ── 專案 CRUD ───────────────────────────────────────────────────────

export async function listProjects(filter: ProjectFilter = {}): Promise<ProjectListRow[]> {
  const db = await getDb();
  const search    = (filter.search ?? "").trim();
  const like      = `%${search}%`;
  const stage     = filter.stage ?? "";
  const studyType = filter.studyType ?? "";
  const archived  = filter.archived ? 1 : 0;

  return db.select<ProjectListRow[]>(
    `SELECT p.*,
            (SELECT j.name
               FROM research_submissions s
               LEFT JOIN research_journals j ON j.id = s.journal_id
              WHERE s.project_id = p.id
              ORDER BY COALESCE(s.submitted_date, '') DESC
              LIMIT 1)                                                     AS journal_name,
            CAST(julianday('now','localtime') - julianday(p.updated_at)
                 AS INTEGER)                                               AS days_since_update
       FROM research_projects p
      WHERE p.archived = ?
        AND (? = ''  OR p.stage = ?)
        AND (? = ''  OR p.study_type = ?)
        AND (? = ''  OR p.title LIKE ? OR IFNULL(p.title_zh,'') LIKE ?
                     OR IFNULL(p.irb_number,'') LIKE ?)
      ORDER BY p.updated_at DESC`,
    [archived, stage, stage, studyType, studyType, search, like, like, like]
  );
}

export async function getProject(id: string): Promise<ResearchProject | null> {
  const db = await getDb();
  const rows = await db.select<ResearchProject[]>(
    "SELECT * FROM research_projects WHERE id = ?", [id]
  );
  return rows[0] ?? null;
}

export interface NewProjectInput {
  title: string;
  title_zh?: string | null;
  study_type?: string | null;
  specialty?: string | null;
  stage?: Stage;
  deident_confirmed: boolean;
  repo_path?: string | null;
  irb_number?: string | null;
  irb_approved_date?: string | null;
}

/** 未勾選去識別化確認不得建立（規格 §6.2） */
export async function createProject(input: NewProjectInput): Promise<string> {
  if (!input.deident_confirmed) throw new Error("必須先勾選去識別化確認才能建立專案");
  if (!input.title.trim())      throw new Error("論文標題不可空白");

  const id = newId();
  const ts = nowLocal();
  await dbWrite(
    `INSERT INTO research_projects
       (id, title, title_zh, study_type, specialty, stage, deident_confirmed,
        repo_path, irb_number, irb_approved_date, created_at, updated_at, archived)
     VALUES (?,?,?,?,?,?,1,?,?,?,?,?,0)`,
    [
      id, input.title.trim(), input.title_zh || null, input.study_type || null,
      input.specialty || null, input.stage ?? "idea",
      input.repo_path || null, input.irb_number || null, input.irb_approved_date || null,
      ts, ts,
    ]
  );
  return id;
}

const PROJECT_EDITABLE = [
  "title", "title_zh", "study_type", "specialty", "stage",
  "repo_path", "irb_number", "irb_approved_date", "archived",
] as const;

export async function updateProject(
  id: string,
  patch: Partial<Record<(typeof PROJECT_EDITABLE)[number], unknown>>
): Promise<void> {
  const cols = Object.keys(patch).filter(
    c => (PROJECT_EDITABLE as readonly string[]).includes(c)
  );
  if (!cols.length) return;
  const sets = cols.map(c => `${c} = ?`).join(", ");
  const vals = cols.map(c => (patch as Record<string, unknown>)[c] ?? null);
  await dbWrite(
    `UPDATE research_projects SET ${sets}, updated_at = ? WHERE id = ?`,
    [...vals, nowLocal(), id]
  );
}

export async function setStage(id: string, stage: Stage): Promise<void> {
  await updateProject(id, { stage });
}

export async function setArchived(id: string, archived: boolean): Promise<void> {
  await updateProject(id, { archived: archived ? 1 : 0 });
}

/** 硬刪除。子表全部 ON DELETE CASCADE，但 plugin-sql 預設不開 FK，故手動清。 */
export async function deleteProject(id: string): Promise<void> {
  const subs = await (await getDb()).select<{ id: string }[]>(
    "SELECT id FROM research_submissions WHERE project_id = ?", [id]
  );
  for (const s of subs) {
    const rounds = await (await getDb()).select<{ id: string }[]>(
      "SELECT id FROM research_review_rounds WHERE submission_id = ?", [s.id]
    );
    for (const r of rounds) {
      await dbWrite("DELETE FROM research_review_comments WHERE round_id = ?", [r.id]);
    }
    await dbWrite("DELETE FROM research_review_rounds     WHERE submission_id = ?", [s.id]);
    await dbWrite("DELETE FROM research_submission_events WHERE submission_id = ?", [s.id]);
  }
  const lists = await (await getDb()).select<{ id: string }[]>(
    "SELECT id FROM research_project_checklists WHERE project_id = ?", [id]
  );
  for (const l of lists) {
    await dbWrite("DELETE FROM research_project_checklist_items WHERE project_checklist_id = ?", [l.id]);
  }
  await dbWrite("DELETE FROM research_project_checklists WHERE project_id = ?", [id]);
  await dbWrite("DELETE FROM research_submissions        WHERE project_id = ?", [id]);
  await dbWrite("DELETE FROM research_project_journals   WHERE project_id = ?", [id]);
  await dbWrite("DELETE FROM research_project_authors    WHERE project_id = ?", [id]);
  await dbWrite("DELETE FROM research_refs               WHERE project_id = ?", [id]);
  await dbWrite("DELETE FROM research_projects           WHERE id = ?",         [id]);
}

// ── 作者名冊 CRUD（跨專案共用）──────────────────────────────────────

export async function listAuthors(): Promise<ResearchAuthor[]> {
  const db = await getDb();
  return db.select<ResearchAuthor[]>(
    "SELECT * FROM research_authors ORDER BY name_zh"
  );
}

export type AuthorInput = Omit<ResearchAuthor, "id">;

export async function createAuthor(input: AuthorInput): Promise<string> {
  if (!input.name_zh.trim()) throw new Error("姓名不可空白");
  const id = newId();
  const ts = nowLocal();
  await dbWrite(
    `INSERT INTO research_authors
       (id, name_zh, name_en, title, department, affiliation, email, default_role, orcid, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.name_zh.trim(), input.name_en || null, input.title || null,
      input.department || null, input.affiliation || null, input.email || null,
      input.default_role || null, input.orcid || null, ts, ts,
    ]
  );
  return id;
}

export async function updateAuthor(id: string, input: AuthorInput): Promise<void> {
  await dbWrite(
    `UPDATE research_authors
        SET name_zh=?, name_en=?, title=?, department=?, affiliation=?,
            email=?, default_role=?, orcid=?, updated_at=?
      WHERE id=?`,
    [
      input.name_zh.trim(), input.name_en || null, input.title || null,
      input.department || null, input.affiliation || null, input.email || null,
      input.default_role || null, input.orcid || null, nowLocal(), id,
    ]
  );
}

/** 名冊刪除會連帶把該作者從所有專案移除 */
export async function deleteAuthor(id: string): Promise<void> {
  await dbWrite("DELETE FROM research_project_authors WHERE author_id = ?", [id]);
  await dbWrite("DELETE FROM research_authors         WHERE id = ?",        [id]);
}

/** 這位作者被幾篇論文掛名（刪除前提示用） */
export async function authorUsage(id: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) AS c FROM research_project_authors WHERE author_id = ?", [id]
  );
  return rows[0]?.c ?? 0;
}

// ── 專案作者 ────────────────────────────────────────────────────────

export async function listProjectAuthors(projectId: string): Promise<ProjectAuthorRow[]> {
  const db = await getDb();
  return db.select<ProjectAuthorRow[]>(
    `SELECT pa.*,
            a.name_zh, a.name_en, a.title, a.department, a.affiliation, a.default_role
       FROM research_project_authors pa
       JOIN research_authors a ON a.id = pa.author_id
      WHERE pa.project_id = ?
      ORDER BY pa.author_order, a.name_zh`,
    [projectId]
  );
}

/** 加入專案時以名冊的 default_role 預帶 irb_category（規格 §2.3） */
export async function addProjectAuthor(projectId: string, authorId: string): Promise<void> {
  const db = await getDb();
  const dup = await db.select<{ c: number }[]>(
    "SELECT COUNT(*) AS c FROM research_project_authors WHERE project_id=? AND author_id=?",
    [projectId, authorId]
  );
  if ((dup[0]?.c ?? 0) > 0) throw new Error("這位作者已在本專案的名單中");

  const maxRow = await db.select<{ m: number | null }[]>(
    "SELECT MAX(author_order) AS m FROM research_project_authors WHERE project_id = ?",
    [projectId]
  );
  const author = await db.select<{ default_role: string | null }[]>(
    "SELECT default_role FROM research_authors WHERE id = ?", [authorId]
  );

  await dbWrite(
    `INSERT INTO research_project_authors
       (id, project_id, author_id, author_order, is_corresponding, irb_category)
     VALUES (?,?,?,?,0,?)`,
    [newId(), projectId, authorId, (maxRow[0]?.m ?? 0) + 1, author[0]?.default_role || null]
  );
  await touchProject(projectId);
}

const PROJECT_AUTHOR_EDITABLE = [
  "author_order", "is_corresponding", "irb_category",
  "work_months", "work_scope", "contribution",
] as const;

export async function updateProjectAuthor(
  id: string,
  projectId: string,
  patch: Partial<Record<(typeof PROJECT_AUTHOR_EDITABLE)[number], unknown>>
): Promise<void> {
  const cols = Object.keys(patch).filter(
    c => (PROJECT_AUTHOR_EDITABLE as readonly string[]).includes(c)
  );
  if (!cols.length) return;
  const sets = cols.map(c => `${c} = ?`).join(", ");
  const vals = cols.map(c => (patch as Record<string, unknown>)[c] ?? null);
  await dbWrite(`UPDATE research_project_authors SET ${sets} WHERE id = ?`, [...vals, id]);
  await touchProject(projectId);
}

export async function removeProjectAuthor(id: string, projectId: string): Promise<void> {
  await dbWrite("DELETE FROM research_project_authors WHERE id = ?", [id]);
  await touchProject(projectId);
}

/** 拖曳排序後整批寫回 author_order（1 = first author） */
export async function reorderProjectAuthors(projectId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await dbWrite(
      "UPDATE research_project_authors SET author_order = ? WHERE id = ?",
      [i + 1, orderedIds[i]]
    );
  }
  await touchProject(projectId);
}

/** 子表變動時更新專案 updated_at，讓清單的「距上次變更」與停滯判定準確 */
async function touchProject(projectId: string): Promise<void> {
  await dbWrite(
    "UPDATE research_projects SET updated_at = ? WHERE id = ?",
    [nowLocal(), projectId]
  );
}
