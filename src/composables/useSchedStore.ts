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
  type Duty84Doc, type CnyDoc, type MonthDoc, type PrebookDoc, type NoticeItem, type LogDoc, newId,
} from "@/utils/sched/types";
import { emptyHolidays, nextYm, ymParts } from "@/utils/sched/calendar";
import { recomputeFrom, newMonthFrom, type SchedSnapshot, type Notice } from "@/utils/sched/engine/prefill";
import { parseMonthSheet, parse84 } from "@/utils/sched/excelImport";
import { useSchedSession } from "@/composables/useSchedSession";
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
  notices: NoticeItem[];
  months: Record<string, MonthDoc>;
  prebooks: Record<string, PrebookDoc>;
  logs: Record<string, LogDoc>;
}

export type GlobalKey = "people" | "shifts" | "quotaItems" | "rules" | "holidays" | "holidayDuty" | "duty84" | "cny" | "notices";

const defaults = (): Omit<SchedState, "loaded" | "months" | "prebooks" | "logs"> => ({
  people: [],
  shifts: structuredClone(DEFAULT_SHIFTS),
  quotaItems: structuredClone(DEFAULT_QUOTA_ITEMS),
  rules: structuredClone(DEFAULT_RULES),
  holidays: emptyHolidays(),
  holidayDuty: {},
  duty84: { log: [], removedDates: [], addedDates: [] },
  cny: { lastD: {}, log: [] },
  notices: [],
});

const state = reactive<SchedState>({ loaded: false, months: {}, prebooks: {}, logs: {}, ...defaults() });
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ key: string; json: string }[]>("SELECT key, json FROM sched_docs");
  const d = defaults();
  Object.assign(state, d);
  state.months = {};
  state.prebooks = {};
  state.logs = {};
  for (const r of rows) {
    const val = JSON.parse(r.json);
    if (r.key.startsWith("month:")) state.months[r.key.slice(6)] = val;
    else if (r.key.startsWith("prebook:")) state.prebooks[r.key.slice(8)] = val;
    else if (r.key.startsWith("log:")) state.logs[r.key.slice(4)] = val;
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

const LOG_LIMIT = 2000;

/** 目前操作者（寫操作紀錄用） */
export function actorName(): string {
  return useSchedSession().name || "排班者";
}

/** 操作紀錄：scope 為月份（YYYYMM）或 "global"；actor 預設為 system */
export async function appendLog(scope: string, action: string, detail: string, actor = "system"): Promise<void> {
  const doc = state.logs[scope] ?? { key: scope, entries: [] };
  doc.entries.push({ at: new Date().toISOString(), actor, action, detail });
  if (doc.entries.length > LOG_LIMIT) doc.entries.splice(0, doc.entries.length - LOG_LIMIT);
  state.logs[scope] = doc;
  await writeDoc(`log:${scope}`, doc);
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
  await appendLog("global", "Excel 匯入",
    `起點 ${baseSheet}${extraSheets.length ? `，預班 ${extraSheets.join("、")}` : ""}；新增人員 ${out.report.created.length}、更新 ${out.report.updated.length}`,
    actorName());
  const rc = await recompute(null, "Excel 匯入後重新輪序");
  out.report.warnings.push(...rc.warnings);
  if (rc.notices.length) out.report.warnings.push(`系統預填覆蓋了 ${rc.notices.length} 筆預班（已寫入通知）`);
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

// ── 重算與月份 ────────────────────────────────────────────────────────
export function snapshot(): SchedSnapshot {
  return clone({
    people: state.people, shifts: state.shifts, quotaItems: state.quotaItems, holidays: state.holidays,
    holidayDuty: state.holidayDuty, duty84: state.duty84, cny: state.cny, months: state.months, prebooks: state.prebooks,
  });
}

export function sortedYms(): string[] {
  return Object.keys(state.months).sort();
}

/** 最早的「開放預班」月份 */
export function firstOpenYm(): string | null {
  return sortedYms().find(ym => state.months[ym].status === "open")
    ?? Object.keys(state.prebooks).filter(ym => !state.months[ym]).sort()[0]
    ?? null;
}

function noticeText(n: Notice): string {
  const { m } = ymParts(n.ym);
  return `${m}/${n.day} 的預班「${n.oldValue}」已改為「${n.newValue}」：${n.reason}`;
}

/**
 * 人力結構改變後，自 fromYm（預設最早的開放月份）起往後重算預填、8-4、春節、V 交接。
 * 只寫回有變動的文件；覆蓋員工預約產生的通知存入 notices。
 */
export async function recompute(fromYm: string | null, reason: string): Promise<{ notices: Notice[]; warnings: string[] }> {
  await ensureSchedLoaded();
  const open = firstOpenYm();
  const from = [fromYm, open].filter((x): x is string => !!x).sort().pop() ?? null;
  if (!from) return { notices: [], warnings: [] };
  const now = new Date().toISOString();
  const r = recomputeFrom(snapshot(), from, now, reason);

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const [ym, m] of Object.entries(r.months)) if (!same(m, state.months[ym])) await saveMonth(m);
  for (const [ym, p] of Object.entries(r.prebooks)) if (!same(p, state.prebooks[ym])) await savePrebook(p);
  if (!same(r.duty84, state.duty84)) { state.duty84 = r.duty84; await saveGlobal("duty84"); }
  if (!same(r.cny, state.cny)) { state.cny = r.cny; await saveGlobal("cny"); }
  if (r.notices.length) {
    state.notices.push(...r.notices.map(n => ({
      id: newId(), personId: n.personId, at: now, text: noticeText(n), read: false, sent: false,
    })));
    await saveGlobal("notices");
  }
  // 每個被重算的開放月份各記一筆系統紀錄
  const nm = (id: string | null | undefined) => personById(id)?.name ?? "—";
  for (const [ym, m] of Object.entries(r.months)) {
    if (ym < from || m.status !== "open") continue;
    const sys = Object.values(r.prebooks[ym]?.cells ?? {}).filter(c => c.src === "sys").length;
    const ns = r.notices.filter(n => n.ym === ym);
    const vs = state.quotaItems.filter(i => i.enabled).map(i => `${i.name}=${nm(m.markers[i.id]?.v)}`).join("、");
    const parts = [`原因：${reason}`, `預填 ${sys} 格`, `餘數起點 V：${vs}`];
    if (ns.length) parts.push(`覆蓋預班 ${ns.length} 筆（${ns.map(n => `${nm(n.personId)} ${n.day} 日 ${n.oldValue}→${n.newValue}`).join("、")}），已通知`);
    const ws = r.warnings.filter(w => w.startsWith(ym)).map(w => w.slice(ym.length + 1));
    if (ws.length) parts.push(`提示：${ws.join("；")}`);
    await appendLog(ym, "重新計算預填", parts.join("；"));
  }
  return { notices: r.notices, warnings: r.warnings };
}

/** 新增最後一個月份的下一個月（開放預班），沿用上月人員設定，並重算預填 */
export async function addNextMonth(): Promise<string> {
  await ensureSchedLoaded();
  const yms = sortedYms();
  const last = yms[yms.length - 1];
  if (!last) throw new Error("尚無任何月份，請先匯入起點月份");
  const ym = nextYm(last);
  await saveMonth(newMonthFrom(state.months[last], ym));
  if (!state.prebooks[ym]) await savePrebook({ ym, cells: {} });
  await appendLog(ym, "新增月份", `沿用 ${last} 的人員設定與人力表`, actorName());
  await recompute(ym, "新增月份");
  return ym;
}

export function useSchedStore() {
  return state;
}
