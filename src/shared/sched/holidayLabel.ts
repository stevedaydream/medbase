import type { HolidayDoc } from "./types";
import { inCny } from "./calendar";

/** 國定假日簡寫（月曆格子放不下全名）；不在表內的取前 2 個字 */
export const HOLIDAY_SHORT: Record<string, string> = {
  開國紀念日: "元旦",
  農曆除夕: "除夕",
  小年夜: "小年夜",
  春節: "春節",
  和平紀念日: "228",
  兒童節: "兒童",
  清明節: "清明",
  勞動節: "勞動",
  端午節: "端午",
  中秋節: "中秋",
  "孔子誕辰紀念日/教師節": "教師",
  國慶日: "國慶",
  臺灣光復暨金門古寧頭大捷紀念日: "光復",
  行憲紀念日: "行憲",
  補假: "補假",
  國定假日: "國定",
};

export function holidayShort(name: string): string {
  const n = name.trim();
  return HOLIDAY_SHORT[n] ?? n.slice(0, 2);
}

/** 月曆上某天的標記：國定假日與春節輪值區間（紅）、補班日（一般顏色） */
export interface DayMark { label: string; red: boolean }

export function dayMark(h: HolidayDoc, date: string): DayMark | null {
  const name = h.days[date];
  if (name) return { label: holidayShort(name), red: true };
  if (inCny(h, date)) return { label: "春節", red: true };
  if (h.workdays.includes(date)) return { label: "補班", red: false };
  return null;
}
