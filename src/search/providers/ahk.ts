import { getDb } from "@/db";
import { focusRoute, type SearchProvider } from "../types";

/** AHK 腳本 */
export default {
  key: "ahk",
  tables: ["ahk_scripts"],
  async load() {
    const db = await getDb();
    const rows = await db.select<{ id: number; name: string; description: string | null; filename: string | null }[]>(
      "SELECT id, name, description, filename FROM ahk_scripts");
    return rows.map(r => ({
      type: "AHK", label: r.name, sub: r.description ?? "", keywords: r.filename ?? "",
      route: focusRoute("/ahk", "ahk", r.id),
    }));
  },
} satisfies SearchProvider;
