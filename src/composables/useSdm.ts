import { getDb, dbWrite } from "@/db";
import { parseSdmSpec, normalizeSdm, type SdmEntry, type SdmSpec } from "@/shared/sdm/types";
import { touchTable, markDeleted, nowLocal } from "@/composables/useTableSync";

/** SDM 範本（ADR-021）：讀寫 sdm_templates，存檔後自動同步全院 */
export const SDM_TABLE = "sdm";
const EDITOR_KEY = "sdm_editor_name";

interface Row { id: number; uid: string | null; name: string; spec: string | null }

export async function loadSdm(): Promise<SdmEntry[]> {
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT id, uid, name, spec FROM sdm_templates ORDER BY name");
  return rows.map(r => ({ uid: r.uid ?? String(r.id), name: r.name, spec: parseSdmSpec(r.spec) }));
}

/** 存檔：寫入最後修改人與時間，回傳 uid */
export async function saveSdm(e: { uid: string | null; name: string; spec: SdmSpec }, editor: string): Promise<string> {
  const spec = { ...normalizeSdm(e.spec), updatedBy: editor.trim(), updatedAt: nowLocal() };
  const json = JSON.stringify(spec);
  if (e.uid) {
    await dbWrite("UPDATE sdm_templates SET name=?, spec=? WHERE uid=?", [e.name.trim(), json, e.uid]);
    await touchTable(SDM_TABLE);
    return e.uid;
  }
  const res = await dbWrite("INSERT INTO sdm_templates (name, spec) VALUES (?, ?)", [e.name.trim(), json]);
  const db = await getDb();
  const r = await db.select<{ uid: string }[]>("SELECT uid FROM sdm_templates WHERE id=?", [res.lastInsertId]);
  await touchTable(SDM_TABLE);
  return r[0]?.uid ?? "";
}

export async function deleteSdm(uid: string): Promise<void> {
  await markDeleted(SDM_TABLE, uid);
  await dbWrite("DELETE FROM sdm_templates WHERE uid=?", [uid]);
  await touchTable(SDM_TABLE);
}

/** 這台電腦記住的修改人姓名 */
export async function getEditorName(): Promise<string> {
  const db = await getDb();
  return (await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", [EDITOR_KEY]))[0]?.value ?? "";
}

export async function setEditorName(name: string): Promise<void> {
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [EDITOR_KEY, name.trim()]);
}
