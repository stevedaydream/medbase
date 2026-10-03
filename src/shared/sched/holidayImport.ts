/**
 * 國定假日匯入（政府行政機關辦公日曆，資料來源 ruyut/TaiwanCalendar）。
 * 只新增缺少的日期，不覆蓋既有名稱與抽籤結果；春節連假只提供預設區間，由使用者確認。
 */
import type { HolidayDoc } from "./types";

export interface TwCalDay { date: string; week: string; isHoliday: boolean; description?: string }

export interface HolidayImportPlan {
  year: string;
  days: { date: string; name: string }[];   // 要新增的國定假日（含落在週末的節日與補假）
  workdays: string[];                         // 要新增的補班日（週末要上班）
  cny: { from: string; to: string } | null;   // 春節連假預設區間；該年已有春節區間時為 null
  existing: number;                           // 已存在而略過的國定假日數
}

export const TW_CALENDAR_URL = (year: string) => `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;

const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const isWeekend = (d: TwCalDay) => d.week === "六" || d.week === "日";
/** 一般週末的說明（不是節日） */
const PLAIN_WEEKEND = ["休息日", "例假日"];

export function planHolidayImport(h: HolidayDoc, year: string, data: TwCalDay[]): HolidayImportPlan {
  const list = data.filter(d => String(d.date).startsWith(year)).sort((a, b) => a.date.localeCompare(b.date));
  const days: HolidayImportPlan["days"] = [];
  const workdays: string[] = [];
  let existing = 0;
  for (const d of list) {
    const date = iso(String(d.date));
    const name = (d.description ?? "").trim();
    if (d.isHoliday && name && !PLAIN_WEEKEND.includes(name)) {
      if (date in h.days) existing++;
      else days.push({ date, name });
    } else if (!d.isHoliday && isWeekend(d) && !h.workdays.includes(date)) {
      workdays.push(date);
    }
  }

  // 春節連假：含「農曆除夕」那段連續放假日（含週末）
  let cny: HolidayImportPlan["cny"] = null;
  const eve = list.findIndex(d => (d.description ?? "").includes("除夕"));
  const hasCny = h.cny.some(r => r.from.startsWith(year) || r.to.startsWith(year));
  if (eve >= 0 && !hasCny) {
    let a = eve, b = eve;
    while (a > 0 && list[a - 1].isHoliday) a--;
    while (b < list.length - 1 && list[b + 1].isHoliday) b++;
    cny = { from: iso(list[a].date), to: iso(list[b].date) };
  }
  return { year, days, workdays, cny, existing };
}

/** 套用匯入（回傳新的 HolidayDoc；cny 傳 null 表示不加春節區間） */
export function applyHolidayImport(h: HolidayDoc, plan: HolidayImportPlan, cny: { from: string; to: string } | null): HolidayDoc {
  const out: HolidayDoc = { days: { ...h.days }, workdays: [...h.workdays], cny: [...h.cny] };
  for (const d of plan.days) if (!(d.date in out.days)) out.days[d.date] = d.name;
  for (const w of plan.workdays) if (!out.workdays.includes(w)) out.workdays.push(w);
  out.workdays.sort();
  if (cny && cny.from && cny.to && cny.to >= cny.from) out.cny = [...out.cny, cny].sort((a, b) => a.from.localeCompare(b.from));
  return out;
}

/** 這次匯入影響的最早日期（重算預填的起點） */
export function earliestDate(plan: HolidayImportPlan, cny: { from: string } | null): string | null {
  const all = [...plan.days.map(d => d.date), ...plan.workdays, ...(cny ? [cny.from] : [])].sort();
  return all[0] ?? null;
}
