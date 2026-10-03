import { getDb } from "@/db";
import { focusRoute, type SearchProvider } from "../types";

/** 品項套組 */
export default {
  key: "sets",
  tables: ["sets"],
  async load() {
    const db = await getDb();
    const rows = await db.select<{ id: number; name: string; surgery_type: string | null; doctor: string }[]>(
      "SELECT s.id, s.name, s.surgery_type, COALESCE(p.name, '') AS doctor FROM sets s LEFT JOIN physicians p ON s.physician_id = p.id");
    return rows.map(r => ({
      type: "套組", label: r.name, sub: [r.surgery_type, r.doctor].filter(Boolean).join(" · "),
      route: focusRoute("/sets", "sets", r.id, { tab: "sets" }),
    }));
  },
} satisfies SearchProvider;
