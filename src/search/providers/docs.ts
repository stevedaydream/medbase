import { docs, loadSession } from "@/composables/useDocTabs";
import { focusRoute, type SearchProvider } from "../types";

/** Markdown 文件：最近開啟的檔案（存在硬碟，不在資料庫） */
export default {
  key: "docs",
  tables: [],
  async load() {
    await loadSession();
    return docs.recent.map(p => ({
      type: "文件", label: p.split(/[\\/]/).pop() ?? p, sub: p, route: focusRoute("/docs", "docs", p),
    }));
  },
} satisfies SearchProvider;
