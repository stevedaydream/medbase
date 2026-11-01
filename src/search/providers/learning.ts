import { LEARNING_ENTRIES, COMPLAINTS } from "@/shared/learning";
import type { SearchProvider } from "../types";

export default {
  key: "learning",
  tables: [],
  async load() {
    return [{ type: "功能", label: "學習資源", sub: "新進人員 · OSCE 八大主訴與診斷延伸閱讀",
      keywords: "學習 新進人員 教育 訓練 OSCE 八大主訴", route: "/learning" },
    ...LEARNING_ENTRIES.map(entry => ({ type: "學習", label: entry.title,
      sub: `${entry.kind === "original" ? "原表轉寫" : entry.kind === "reading" ? "診斷延伸閱讀" : "完整文件"} · ${entry.complaints.map(id => COMPLAINTS.find(c => c.id === id)?.label).join("、")}`,
      keywords: `OSCE 新進人員 ${entry.markdown}`, route: `/learning?entry=${encodeURIComponent(entry.id)}` }))];
  },
} satisfies SearchProvider;
