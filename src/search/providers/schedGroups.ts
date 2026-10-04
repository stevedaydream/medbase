import { ensureSchedLoaded, schedGroups, useSchedStore } from "@/composables/useSchedStore";
import { personGroup } from "@/shared/sched/groups";
import type { SearchProvider } from "../types";

/** 排班群組（ADR-025）：只列群組名稱與人數，不含班表內容（sched_docs 不進全域搜尋） */
export default {
  key: "schedGroups",
  tables: [],
  async load() {
    await ensureSchedLoaded();
    const people = useSchedStore().people;
    return schedGroups().map(g => ({
      type: "排班群組", label: g.name, sub: `${g.id} · ${people.filter(p => personGroup(p) === g.id && p.active).length} 人`,
      keywords: "排班 班表 群組 病房", route: "/schedule",
    }));
  },
} satisfies SearchProvider;
