/**
 * 計算工具總表（處置及臨床工具）：公式（handbook/formulas.ts）與互動式臨床工具（clinicalCalc）。
 * 依症狀頁以 id 連結；桌機與手機共用。
 */
import { FORMULAS } from "./handbook/formulas";

export interface ToolRef {
  id: string;
  name: string;
  /** formula＝單純公式計算；calc＝互動式工具（ABG、FiO₂ 等，ToolsView） */
  kind: "formula" | "calc";
  /** calc 工具在 ToolsView 的分頁 id */
  calcId?: string;
  desc: string;
}

export const CALC_TOOLS: ToolRef[] = [
  { id: "abg", name: "ABG 判讀", kind: "calc", calcId: "abg", desc: "pH、PaCO2、HCO3 酸鹼分析" },
  { id: "fio2", name: "FiO₂ 換算", kind: "calc", calcId: "fio2", desc: "氧氣裝置與 P/F ratio" },
  { id: "insulin", name: "血糖／胰島素校正", kind: "calc", calcId: "glucose", desc: "校正劑量試算" },
  { id: "nutrition", name: "每日營養", kind: "calc", calcId: "nutrition", desc: "熱量與蛋白質需求" },
];

export const ALL_TOOLS: ToolRef[] = [
  ...FORMULAS.map(f => ({ id: f.id, name: f.name, kind: "formula" as const, desc: f.formula })),
  ...CALC_TOOLS,
];

export const toolById = (id: string) => ALL_TOOLS.find(t => t.id === id) ?? null;
