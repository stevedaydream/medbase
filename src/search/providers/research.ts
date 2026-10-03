import { getDb } from "@/db";
import { useResearchSession } from "@/composables/useResearchSession";
import type { SearchProvider } from "../types";

/** 論文專案：只在已用 PIN 登入時搜尋，而且只列登入者自己的專案（ADR-012） */
export default {
  key: "research",
  tables: ["research_projects"],
  async load() {
    const s = useResearchSession();
    if (!s.unlocked || !s.his) return [];
    const db = await getDb();
    const rows = await db.select<{ id: string; title: string; title_zh: string | null; specialty: string | null }[]>(
      "SELECT id, title, title_zh, specialty FROM research_projects WHERE owner_his = ?", [s.his]);
    return rows.map(r => ({
      type: "論文", label: r.title_zh || r.title, sub: [r.title_zh ? r.title : "", r.specialty].filter(Boolean).join(" · "),
      route: `/research/${encodeURIComponent(r.id)}`,
    }));
  },
} satisfies SearchProvider;
