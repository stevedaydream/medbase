import type { SearchProvider } from "../types";
import { toolById } from "@/shared/tools";

export default {
  key: "child-pugh",
  tables: [],
  async load() {
    const tool = toolById("child-pugh")!;
    return [{
      type: "工具", label: tool.name, sub: tool.desc,
      keywords: "Child Pugh CTP 肝臟 肝功能 肝硬化 指數 評分 分級",
      route: "/care?tab=tools&t=child-pugh",
    }];
  },
} satisfies SearchProvider;
