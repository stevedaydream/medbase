import { getDb } from "@/db";
import { focusRoute, type SearchProvider } from "../types";

/** 規則備忘錄 */
export default {
  key: "shiftMemos",
  tables: ["shift_memos"],
  async load() {
    const db = await getDb();
    const rows = await db.select<{ id: number; category: string; title: string }[]>("SELECT id, category, title FROM shift_memos");
    return rows.map(r => ({ type: "備忘", label: r.title, sub: r.category, route: focusRoute("/shift-memos", "shiftMemos", r.id) }));
  },
} satisfies SearchProvider;
