import { getDb, dbWrite } from "@/db";
import { parseSpec, emptySpec, type EmCard, type EmSpec } from "@/shared/emergency/types";
import { SEED_CARDS, DEMO_NAMES } from "@/shared/emergency/seed";

/**
 * 危急處置卡（ADR-017）：讀寫 emergency_protocols（spec 欄位存整張卡）。
 * 第一次載入時遷移：刪除舊示範卡、舊格式轉成一般卡（草稿）、加入首批文獻版卡片。
 */
interface Row {
  id: number; uid: string | null; name: string; spec: string | null;
  triggers: string | null; immediate_actions: string | null; critical_meds: string | null;
  timers: string | null; contacts: string | null; notes: string | null;
}

const MIGRATED = "emergency_v2_migrated";
const arr = <T>(s: string | null): T[] => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

/** 舊格式（triggers／immediate_actions…）→ 一般卡 */
function fromLegacy(r: Row): EmSpec {
  const s = emptySpec("general");
  s.keywords = arr<string>(r.triggers);
  s.general.actions = arr<string>(r.immediate_actions);
  s.general.meds = arr<{ name: string; dose: string; color?: string }>(r.critical_meds)
    .map(m => ({ name: m.name, dose: m.dose, alert: m.color === "red" }));
  s.general.rechecks = arr<{ label: string; seconds: number }>(r.timers)
    .map(t => ({ label: t.label, minutes: Math.max(1, Math.round(t.seconds / 60)) }));
  s.contacts = arr<{ label: string; ext: string }>(r.contacts);
  s.notes = r.notes ?? "";
  return s;
}

let migrating: Promise<void> | null = null;
async function migrate(): Promise<void> {
  const db = await getDb();
  const done = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", [MIGRATED]);
  if (done.length) return;
  const rows = await db.select<Row[]>("SELECT * FROM emergency_protocols");
  for (const r of rows) {
    if (r.spec) continue;
    if (DEMO_NAMES.includes(r.name)) await dbWrite("DELETE FROM emergency_protocols WHERE id=?", [r.id]);
    else await dbWrite("UPDATE emergency_protocols SET spec=? WHERE id=?", [JSON.stringify(fromLegacy(r)), r.id]);
  }
  const names = new Set(rows.filter(r => !DEMO_NAMES.includes(r.name) || r.spec).map(r => r.name));
  for (const c of SEED_CARDS) {
    if (!names.has(c.name)) await dbWrite("INSERT INTO emergency_protocols (name, spec) VALUES (?, ?)", [c.name, JSON.stringify(c.spec)]);
  }
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, '1')", [MIGRATED]);
}

export async function loadEmergencyCards(): Promise<EmCard[]> {
  await (migrating ??= migrate().finally(() => { migrating = null; }));
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM emergency_protocols ORDER BY name");
  return rows.map(r => ({ uid: r.uid ?? String(r.id), name: r.name, spec: parseSpec(r.spec) ?? fromLegacy(r) }));
}

export async function saveEmergencyCard(card: { uid: string | null; name: string; spec: EmSpec }): Promise<string> {
  const json = JSON.stringify(card.spec);
  if (card.uid) {
    await dbWrite("UPDATE emergency_protocols SET name=?, spec=? WHERE uid=?", [card.name.trim(), json, card.uid]);
    return card.uid;
  }
  const res = await dbWrite("INSERT INTO emergency_protocols (name, spec) VALUES (?, ?)", [card.name.trim(), json]);
  const db = await getDb();
  const r = await db.select<{ uid: string }[]>("SELECT uid FROM emergency_protocols WHERE id=?", [res.lastInsertId]);
  return r[0]?.uid ?? "";
}

export async function deleteEmergencyCard(uid: string): Promise<void> {
  await dbWrite("DELETE FROM emergency_protocols WHERE uid=?", [uid]);
}
