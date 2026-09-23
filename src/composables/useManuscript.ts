import { getDb, dbWrite } from "@/db";
import { newId } from "@/composables/useResearch";
import { requireOwner, markChanged } from "@/composables/useResearchSession";

/**
 * 稿件草稿：每個專案的稿件依段落（區塊）分開存，純文字。
 * 只能讀寫登入者自己專案的稿件；每次寫入後觸發個人雲端備份（ADR-012）。
 */

export interface ManuscriptSection {
  id: string;
  project_id: string;
  sort_order: number;
  title: string;
  body: string;
  updated_at: string;
}

/** 依研究類型預設的段落。個案報告參照 CARE，其餘採 IMRaD */
export function defaultSections(studyType: string | null): string[] {
  if (studyType === "case_report" || studyType === "case_series") {
    return ["Title", "Abstract", "Introduction", "Case Presentation", "Discussion", "Conclusion", "References"];
  }
  if (studyType === "review") {
    return ["Title", "Abstract", "Introduction", "Main Text", "Conclusion", "References"];
  }
  return ["Title", "Abstract", "Introduction", "Methods", "Results", "Discussion", "Conclusion", "References"];
}

export { wordCount } from "@/shared/manuscriptFiles";

const OWNED_PROJECT = "project_id IN (SELECT id FROM research_projects WHERE owner_his = ?)";

async function touch(projectId: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  await dbWrite("UPDATE research_projects SET updated_at = ? WHERE id = ? AND owner_his = ?", [ts, projectId, requireOwner()]);
  await markChanged();
}

export async function listSections(projectId: string): Promise<ManuscriptSection[]> {
  const db = await getDb();
  return db.select<ManuscriptSection[]>(
    `SELECT * FROM research_manuscript_sections WHERE project_id = ? AND ${OWNED_PROJECT} ORDER BY sort_order, rowid`,
    [projectId, requireOwner()],
  );
}

/** 以一組段落整批取代（建立預設段落、匯入時使用） */
export async function replaceSections(projectId: string, sections: { title: string; body: string }[]): Promise<void> {
  const owner = requireOwner();
  await dbWrite(`DELETE FROM research_manuscript_sections WHERE project_id = ? AND ${OWNED_PROJECT}`, [projectId, owner]);
  const db = await getDb();
  const owned = await db.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM research_projects WHERE id = ? AND owner_his = ?", [projectId, owner]);
  if (!owned[0]?.c) throw new Error("找不到此專案");
  for (let i = 0; i < sections.length; i++) {
    await dbWrite(
      "INSERT INTO research_manuscript_sections (id, project_id, sort_order, title, body, updated_at) VALUES (?,?,?,?,?,datetime('now','localtime'))",
      [newId(), projectId, i + 1, sections[i].title.trim() || `段落 ${i + 1}`, sections[i].body],
    );
  }
  await touch(projectId);
}

/** 附加段落到最後 */
export async function appendSections(projectId: string, sections: { title: string; body: string }[]): Promise<void> {
  const existing = await listSections(projectId);
  let order = existing.reduce((m, s) => Math.max(m, s.sort_order), 0);
  for (const s of sections) {
    await dbWrite(
      "INSERT INTO research_manuscript_sections (id, project_id, sort_order, title, body, updated_at) VALUES (?,?,?,?,?,datetime('now','localtime'))",
      [newId(), projectId, ++order, s.title.trim() || `段落 ${order}`, s.body],
    );
  }
  await touch(projectId);
}

export async function updateSection(id: string, projectId: string, patch: { title?: string; body?: string }): Promise<void> {
  const cols = (["title", "body"] as const).filter(k => patch[k] !== undefined);
  if (!cols.length) return;
  await dbWrite(
    `UPDATE research_manuscript_sections SET ${cols.map(c => `${c} = ?`).join(", ")}, updated_at = datetime('now','localtime')
      WHERE id = ? AND ${OWNED_PROJECT}`,
    [...cols.map(c => patch[c]), id, requireOwner()],
  );
  await touch(projectId);
}

export async function deleteSection(id: string, projectId: string): Promise<void> {
  await dbWrite(`DELETE FROM research_manuscript_sections WHERE id = ? AND ${OWNED_PROJECT}`, [id, requireOwner()]);
  await touch(projectId);
}

/** 依給定順序重排（1 起算） */
export async function reorderSections(projectId: string, orderedIds: string[]): Promise<void> {
  const owner = requireOwner();
  for (let i = 0; i < orderedIds.length; i++) {
    await dbWrite(
      `UPDATE research_manuscript_sections SET sort_order = ? WHERE id = ? AND ${OWNED_PROJECT}`,
      [i + 1, orderedIds[i], owner],
    );
  }
  await touch(projectId);
}
