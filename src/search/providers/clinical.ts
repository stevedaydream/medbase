import { getDb } from "@/db";
import { focusRoute, type SearchProvider } from "../types";

/** 套組管理：處方、手術處置、疾病常規、檢查處置 */
type Row = { id: number; name: string; a: string | null; b: string | null; c: string | null };
const SOURCES = [
  { table: "prescriptions", tab: "prescriptions", type: "處方", sql: "SELECT id, name, category AS a, NULL AS b, indication AS c FROM prescriptions" },
  { table: "surgery",       tab: "surgery",       type: "手術", sql: "SELECT id, name, category AS a, NULL AS b, indication AS c FROM surgery" },
  { table: "disease",       tab: "disease",       type: "疾病", sql: "SELECT id, name, icd10 AS a, category AS b, NULL AS c FROM disease" },
  { table: "examination",   tab: "examination",   type: "檢查", sql: "SELECT id, name, his_code AS a, category AS b, indication AS c FROM examination" },
];

export default {
  key: "clinical",
  tables: SOURCES.map(s => s.table),
  async load() {
    const db = await getDb();
    const parts = await Promise.all(SOURCES.map(async s => (await db.select<Row[]>(s.sql)).map(r => ({
      type: s.type, label: r.name, sub: [r.a, r.b].filter(Boolean).join(" · "), keywords: r.c ?? "",
      route: focusRoute("/sets", s.table, r.id, { tab: s.tab }),
    }))));
    return parts.flat();
  },
} satisfies SearchProvider;
