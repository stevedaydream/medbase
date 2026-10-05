import type { SearchProvider } from "../types";

/** 資料垃圾桶（ADR-028）：入口本身（內容在雲端，開啟時才讀取） */
export default {
  key: "trash",
  tables: [],
  async load() {
    return [{
      type: "功能", label: "垃圾桶", sub: "刪除的資料保留 30 天，可還原",
      keywords: "垃圾桶 回收 還原 復原 誤刪 刪除", route: "/data?tab=trash",
    }];
  },
} satisfies SearchProvider;
