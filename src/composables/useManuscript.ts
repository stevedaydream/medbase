import { getDb, dbWrite } from "@/db";
import { newId } from "@/composables/useResearch";
import { requireOwner, markChanged } from "@/composables/useResearchSession";
import type { SectionFormat } from "@/shared/manuscriptMarkdown";

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
  /** text＝舊的純文字、md＝Markdown（ADR-019） */
  format: SectionFormat;
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
export async function replaceSections(projectId: string, sections: { title: string; body: string; format?: SectionFormat }[]): Promise<void> {
  const owner = requireOwner();
  await dbWrite(`DELETE FROM research_manuscript_sections WHERE project_id = ? AND ${OWNED_PROJECT}`, [projectId, owner]);
  const db = await getDb();
  const owned = await db.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM research_projects WHERE id = ? AND owner_his = ?", [projectId, owner]);
  if (!owned[0]?.c) throw new Error("找不到此專案");
  for (let i = 0; i < sections.length; i++) {
    await dbWrite(
      "INSERT INTO research_manuscript_sections (id, project_id, sort_order, title, body, format, updated_at) VALUES (?,?,?,?,?,?,datetime('now','localtime'))",
      [newId(), projectId, i + 1, sections[i].title.trim() || `段落 ${i + 1}`, sections[i].body, sections[i].format ?? "md"],
    );
  }
  await touch(projectId);
}

/** 附加段落到最後 */
export async function appendSections(projectId: string, sections: { title: string; body: string; format?: SectionFormat }[]): Promise<void> {
  const existing = await listSections(projectId);
  let order = existing.reduce((m, s) => Math.max(m, s.sort_order), 0);
  for (const s of sections) {
    await dbWrite(
      "INSERT INTO research_manuscript_sections (id, project_id, sort_order, title, body, format, updated_at) VALUES (?,?,?,?,?,?,datetime('now','localtime'))",
      [newId(), projectId, ++order, s.title.trim() || `段落 ${order}`, s.body, s.format ?? "md"],
    );
  }
  await touch(projectId);
}

export async function updateSection(id: string, projectId: string, patch: { title?: string; body?: string; format?: SectionFormat }): Promise<void> {
  const cols = (["title", "body", "format"] as const).filter(k => patch[k] !== undefined);
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

// ── 稿件圖片（ADR-019）────────────────────────────────────────────
// base64 存在 research_manuscript_assets，隨個人備份上傳；存檔前縮小，避免備份過大

export interface ManuscriptAsset { id: string; project_id: string; name: string; mime: string; width: number | null; height: number | null; data: string }

const MAX_EDGE = 1600;
const MAX_BYTES = 1_500_000;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** 縮到長邊 1600px；照片轉 JPEG、圖表（PNG）保留透明度，仍太大時再降品質 */
async function compress(file: Blob): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("無法讀取圖片")); i.src = url; });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const original = new Uint8Array(await file.arrayBuffer());
    if (scale === 1 && original.length <= MAX_BYTES && /^image\/(png|jpeg|gif)$/.test(file.type)) {
      return { bytes: original, mime: file.type, width: w, height: h };
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const png = file.type === "image/png" || file.type === "image/gif" || file.type === "image/svg+xml";
    if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    const toBlob = (type: string, q?: number) => new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("圖片轉換失敗")), type, q));
    let out = await toBlob(png ? "image/png" : "image/jpeg", 0.85);
    if (out.size > MAX_BYTES) out = await toBlob("image/jpeg", 0.75);
    return { bytes: new Uint8Array(await out.arrayBuffer()), mime: out.type, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function saveAsset(projectId: string, file: Blob, name = ""): Promise<string> {
  const owner = requireOwner();
  const db = await getDb();
  const owned = await db.select<{ c: number }[]>("SELECT COUNT(*) AS c FROM research_projects WHERE id = ? AND owner_his = ?", [projectId, owner]);
  if (!owned[0]?.c) throw new Error("找不到此專案");
  const c = await compress(file);
  const id = newId();
  await dbWrite(
    "INSERT INTO research_manuscript_assets (id, project_id, name, mime, width, height, data) VALUES (?,?,?,?,?,?,?)",
    [id, projectId, name, c.mime, c.width, c.height, b64(c.bytes)],
  );
  await touch(projectId);
  return id;
}

export async function loadAsset(id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const db = await getDb();
  const rows = await db.select<ManuscriptAsset[]>(
    `SELECT * FROM research_manuscript_assets WHERE id = ? AND ${OWNED_PROJECT}`, [id, requireOwner()]);
  const r = rows[0];
  return r ? { bytes: unb64(r.data), mime: r.mime } : null;
}

/** 刪除沒有任何段落引用的圖片（整理稿件時呼叫） */
export async function pruneAssets(projectId: string): Promise<number> {
  const db = await getDb();
  const owner = requireOwner();
  const assets = await db.select<{ id: string }[]>(`SELECT id FROM research_manuscript_assets WHERE project_id = ? AND ${OWNED_PROJECT}`, [projectId, owner]);
  const bodies = (await listSections(projectId)).map(s => s.body).join("\n");
  const unused = assets.filter(a => !bodies.includes(`ms-asset:${a.id}`));
  for (const a of unused) await dbWrite(`DELETE FROM research_manuscript_assets WHERE id = ? AND ${OWNED_PROJECT}`, [a.id, owner]);
  if (unused.length) await touch(projectId);
  return unused.length;
}
