import type { SearchProvider } from "../types";

/** Excel 排班表範本：入口本身（內容在雲端，開啟時才讀取） */
export default {
  key: "excelTemplate",
  tables: [],
  async load() {
    return [{
      type: "功能", label: "Excel 排班表範本", sub: "排班表 → 匯出 → 下載 Excel 副本（換電腦用）",
      keywords: "excel 範本 副本 下載 換電腦 值班表 xlsm", route: "/schedule",
    }];
  },
} satisfies SearchProvider;
