/**
 * 排班 v3 文件庫（ADR-014）：本機 SQLite sched_docs 的單例狀態。
 * 每份文件整份 JSON 存取；雲端同步（第四階段）以 version／cloud_version 比對。
 */
import { reactive } from "vue";
import * as XLSX from "xlsx";
import { getDb, dbWrite } from "@/db";
import {
  DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, clone,
  type Person, type ShiftDef, type QuotaItem, type RuleParams, type HolidayDoc, type HolidayDutyDoc,
  type Duty84Doc, type CnyDoc, type MonthDoc, type PrebookDoc,
} from "@/utils/sched/types";
import { emptyHolidays } from "@/utils/sched/calendar";
import { parseMonthSheet, parse84 } from "@/utils/sched/excelImport";
import { buildImport, type ImportReport, type LegacyUser, type PhysicianHis } from "@/utils/sched/importApply";

export interface SchedState {
  loaded: boolean;
  people: Person[];
  shifts: ShiftDef[];
  quotaItems: QuotaItem[];
  rules: RuleParams;
  holidays: HolidayDoc;
  holidayDuty: HolidayDutyDoc;
  duty84: Duty84Doc;
  cny: CnyDoc;
  months: Record<string, MonthDoc>;
  prebooks: Record<string, PrebookDoc>;
}

export type GlobalKey = "people" | "shifts" | "quotaItems" | "rules" | "holidays" | "holidayDuty" | "duty84" | "cny";

const defaults = (): Omit<SchedState, "loaded" | "months" | "prebooks"> => ({
  people: [],
  shifts: structuredClone(DEFAULT_SHIFTS),
  quotaItems: structuredClone(DEFAULT_QUOTA_ITEMS),
  rules: structuredClone(DEFAULT_RULES),
  holidays: emptyHolidays(),
  holidayDuty: {},
  duty84: { log: [], removedDates: [], addedDates: [] },
  cny: { lastD: {}, log: [] },
});

const state = reactive<SchedState>({ loaded: false, months: {}, prebooks: {}, ...defaults() });
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ key: string; json: string }[]>("SELECT key, json FROM sched_docs");
  const d = defaults();
  Object.assign(state, d);
  state.months = {};
  state.prebooks = {};
  for (const r of rows) {
    const val = JSON.parse(r.json);
    if (r.key.startsWith("month:")) state.months[r.key.slice(6)] = val;
    else if (r.key.startsWith("prebook:")) state.prebooks[r.key.slice(8)] = val;
    else if (r.key in d) (state as unknown as Record<string, unknown>)[r.key] = val;
  }
  state.loaded = true;
}

export function ensureSchedLoaded(): Promise<void> {
  if (state.loaded) return Promise.resolve();
  loading ??= load().finally(() => { loading = null; });
  return loading;
}

export async function reloadSched(): Promise<void> {
  state.loaded = false;
  await ensureSchedLoaded();
}

async function writeDoc(key: string, value: unknown): Promise<void> {
  await dbWrite(
    `INSERT INTO sched_docs (key, json, version, dirty) VALUES (?, ?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET json = excluded.json, version = excluded.version, dirty = 1`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
}

export function saveGlobal(key: GlobalKey): Promise<void> {
  return writeDoc(key, state[key]);
}

export function saveMonth(doc: MonthDoc): Promise<void> {
  state.months[doc.ym] = doc;
  return writeDoc(`month:${doc.ym}`, doc);
}

export function savePrebook(doc: PrebookDoc): Promise<void> {
  state.prebooks[doc.ym] = doc;
  return writeDoc(`prebook:${doc.ym}`, doc);
}

export function personById(id: string | null | undefined): Person | undefined {
  return id ? state.people.find(p => p.id === id) : undefined;
}

// ── Excel 匯入（super）────────────────────────────────────────────────
export async function importFromWorkbook(
  wb: XLSX.WorkBook, baseSheet: string | null, extraSheets: string[],
): Promise<ImportReport> {
  await ensureSchedLoaded();
  const codes = state.shifts.map(s => s.code);
  const db = await getDb();
  const legacyUsers = await db.select<LegacyUser[]>(
    "SELECT name, employee_id, role, is_active FROM scheduler_users",
  ).catch(() => [] as LegacyUser[]);
  const physicians = await db.select<PhysicianHis[]>(
    "SELECT name, his_account FROM physicians",
  ).catch(() => [] as PhysicianHis[]);

  const holidays = clone(state.holidays);
  await migrateLegacyHolidays(holidays);

  if (!baseSheet) throw new Error("請選擇起點月份工作表");
  const out = buildImport({
    base: parseMonthSheet(wb, baseSheet, codes),
    extras: extraSheets.map(s => parseMonthSheet(wb, s, codes)),
    p84: parse84(wb),
    people: clone(state.people),
    holidays,
    holidayDuty: clone(state.holidayDuty),
    legacyUsers, physicians,
    now: new Date().toISOString(),
  });

  state.people = out.people;
  state.holidays = out.holidays;
  state.holidayDuty = out.holidayDuty;
  await saveGlobal("people");
  await saveGlobal("holidays");
  await saveGlobal("holidayDuty");
  if (out.duty84) {
    state.duty84 = out.duty84;
    await saveGlobal("duty84");
  }
  for (const m of out.months) await saveMonth(m);
  for (const p of out.prebooks) await savePrebook(p);
  return out.report;
}

/** 舊排班頁的國定假日（app_settings.scheduler_holidays_YYYY，holiday／c0 類）併入 */
async function migrateLegacyHolidays(h: HolidayDoc): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key LIKE 'scheduler_holidays_%'",
  ).catch(() => []);
  for (const r of rows) {
    try {
      const list = JSON.parse(r.value) as ({ date: string; description?: string; type?: string } | string)[];
      for (const e of list) {
        const ent = typeof e === "string" ? { date: e, type: "holiday" } : e;
        const dw = new Date(ent.date).getDay();
        const desc = ent.description ?? "";
        const isWeekendMark = (dw === 6 || dw === 0) && (!desc || desc === "休息日" || desc === "例假日");
        if (ent.type === "a0" || ent.type === "b0" || isWeekendMark) continue;
        if (!(ent.date in h.days)) h.days[ent.date] = desc || "國定假日";
      }
    } catch { /* 格式不符略過 */ }
  }
}

export function useSchedStore() {
  return state;
}
