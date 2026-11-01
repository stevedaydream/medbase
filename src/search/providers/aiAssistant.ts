import type { SearchProvider } from "../types";

export default {
  key: "ai-assistant",
  tables: [],
  async load() {
    return [{
      type: "功能", label: "AI 行政助手", sub: "聊天、病例討論、公假心得與 Word 匯出",
      keywords: "AI Gemini 聊天 病例討論 公假 心得 進修 Word docx 病歷潤飾",
      route: "/note-polish",
    }];
  },
} satisfies SearchProvider;
