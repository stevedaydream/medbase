import { getDb } from "@/db";
import { focusRoute, type SearchProvider } from "../types";

/** ACP 評估集 */
export default {
  key: "acp",
  tables: ["acp_sets"],
  async load() {
    const db = await getDb();
    const rows = await db.select<{ id: number; name: string }[]>("SELECT id, name FROM acp_sets");
    return rows.map(r => ({ type: "ACP", label: r.name, sub: "ACP 評估集", route: focusRoute("/acp", "acp", r.id) }));
  },
} satisfies SearchProvider;
