import { loadSdm } from "@/composables/useSdm";
import { focusRoute, type SearchProvider } from "../types";

/** SDM 範本（ADR-021） */
export default {
  key: "sdm",
  tables: ["sdm_templates"],
  async load() {
    return (await loadSdm()).map(e => ({
      type: "SDM", label: e.name, sub: [e.spec.dept, e.spec.purposeNote].filter(Boolean).join(" · "),
      keywords: [...e.spec.keywords, ...e.spec.decisions.flatMap(d => [d.name, d.surgeryName, d.examName])].join(" "),
      route: focusRoute("/sets", "sdm", e.uid, { tab: "sdm" }),
    }));
  },
} satisfies SearchProvider;
