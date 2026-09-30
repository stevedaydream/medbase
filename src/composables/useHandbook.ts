import { getDb, dbWrite } from "@/db";
import { parseHbSpec, emptyHbSpec, type HbEntry, type HbSpec } from "@/shared/handbook/types";
import { HANDBOOK_SEED, HANDBOOK_SEED_VERSION } from "@/shared/handbook/seed";
import { addSeedBatches } from "@/composables/useSeedBatches";
import { touchTable, markDeleted } from "@/composables/useTableSync";

/** 隨身工作手冊（ADR-018）：讀寫 handbook；第一次載入時加入首批內容（固定 uid、最舊時間戳，雲端已有時以雲端為準） */
export const HB_TABLE = "handbook";
const SEEDED = "handbook_v1_seeded";

interface Row { id: number; uid: string | null; name: string; spec: string | null }

let seeding: Promise<void> | null = null;
async function seed(): Promise<void> {
  const db = await getDb();
  // 舊版程式（handbook_v1_seeded）已加入第 1 批
  const had = (await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", [SEEDED])).length > 0;
  const added = await addSeedBatches({
    syncTable: HB_TABLE, localTable: "handbook", versionKey: "handbook_seed_version",
    assumed: had ? 1 : 0, version: HANDBOOK_SEED_VERSION, seeds: HANDBOOK_SEED,
  });
  if (added) await touchTable(HB_TABLE);
}

export async function loadHandbook(): Promise<HbEntry[]> {
  await (seeding ??= seed().finally(() => { seeding = null; }));
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT id, uid, name, spec FROM handbook ORDER BY name");
  return rows.map(r => ({ uid: r.uid ?? String(r.id), name: r.name, spec: parseHbSpec(r.spec) ?? emptyHbSpec() }));
}

export async function saveHandbookEntry(e: { uid: string | null; name: string; spec: HbSpec }): Promise<string> {
  const json = JSON.stringify(e.spec);
  if (e.uid) {
    await dbWrite("UPDATE handbook SET name=?, spec=? WHERE uid=?", [e.name.trim(), json, e.uid]);
    await touchTable(HB_TABLE);
    return e.uid;
  }
  const res = await dbWrite("INSERT INTO handbook (name, spec) VALUES (?, ?)", [e.name.trim(), json]);
  const db = await getDb();
  const r = await db.select<{ uid: string }[]>("SELECT uid FROM handbook WHERE id=?", [res.lastInsertId]);
  await touchTable(HB_TABLE);
  return r[0]?.uid ?? "";
}

export async function deleteHandbookEntry(uid: string): Promise<void> {
  await markDeleted(HB_TABLE, uid);
  await dbWrite("DELETE FROM handbook WHERE uid=?", [uid]);
  await touchTable(HB_TABLE);
}
