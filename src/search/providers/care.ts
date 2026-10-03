import { getDb } from "@/db";
import { loadHandbook } from "@/composables/useHandbook";
import { SECTION_LABELS, type HbSection } from "@/shared/handbook/types";
import type { SearchProvider } from "../types";

/** 處置及臨床工具：數值判讀卡、工作手冊（頁面原本就支援 ?c= 與 ?e= 直接開啟） */
const TAB_OF: Record<HbSection, string> = { oncall: "symptom", drug: "drug", surgical: "manual", admin: "manual" };

export default {
  key: "care",
  tables: ["emergency_protocols", "handbook"],
  async load() {
    const db = await getDb();
    const cards = await db.select<{ uid: string; name: string }[]>("SELECT uid, name FROM emergency_protocols WHERE uid IS NOT NULL");
    const hb = await loadHandbook();
    return [
      ...cards.map(c => ({ type: "判讀", label: c.name, sub: "數值判讀", route: `/care?tab=value&c=${encodeURIComponent(c.uid)}` })),
      ...hb.map(e => ({
        type: "手冊", label: e.name, sub: [SECTION_LABELS[e.spec.section], e.spec.category].filter(Boolean).join(" · "),
        keywords: e.spec.keywords.join(" "),
        route: `/care?tab=${TAB_OF[e.spec.section] ?? "symptom"}&e=${encodeURIComponent(e.uid)}`,
      })),
    ];
  },
} satisfies SearchProvider;
