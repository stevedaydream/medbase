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
  type Duty84Doc, type CnyDoc, type MonthDoc, type PrebookDoc, type NoticeItem, type LogDoc, type DebtRec, type LockInfo, type EstDoc,
} from "@/shared/sched/types";
import { emptyHolidays } from "@/shared/sched/calendar";
import { opRecompute, opStartMonth, opEnsureMonths, opFirstMonth, isEmptyPatch, type OpsState, type OpPatch } from "@/shared/sched/ops";
import { parseMonthSheet, parse84 } from "@/utils/sched/excelImport";
import { useSchedSession } from "@/composables/useSchedSession";
import {
  DEFAULT_GROUP, GROUP_ID, groupKey, splitKey, groupList, personGroup, stripSharedRota, type SchedGroup,
} from "@/shared/sched/groups";
import { buildImport, type ImportReport, type LegacyUser, type PhysicianHis } from "@/utils/sched/importApply";
import {
  leaveLedger, monthInputs, normalizeLeaveRules, type LeaveRules, type LeaveOpenDoc, type OvertimeDoc, type LeaveLedger,
} from "@/shared/sched/leave";

export interface SchedState {
  loaded: boolean;
  /** 目前載入的排班群組（ADR-025）；群組文件只載入這個群組的 */
  group: string;
  groups: SchedGroup[];
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
  locks: Record<string, LockInfo | null>;
  ests: Record<string, EstDoc>;
  debts: DebtRec[];
  /** 假勤（ADR-027）：參數與期初餘額（共用）、每月加班登記（依群組） */
  leaveRules: Partial<LeaveRules> | null;
  leaveOpen: LeaveOpenDoc;
  overtimes: Record<string, OvertimeDoc>;
}

export type GlobalKey = "people" | "groups" | "leaveRules" | "leaveOpen" | "shifts" | "quotaItems" | "rules" | "holidays" | "holidayDuty" | "duty84" | "cny" | "notices" | "debts";

const defaults = (): Omit<SchedState, "loaded" | "group" | "months" | "prebooks" | "logs" | "locks" | "ests" | "overtimes"> => ({
  groups: [],
  leaveRules: null,
  leaveOpen: {},
  people: [],
  shifts: structuredClone(DEFAULT_SHIFTS),
  quotaItems: structuredClone(DEFAULT_QUOTA_ITEMS),
  rules: structuredClone(DEFAULT_RULES),
  holidays: emptyHolidays(),
  holidayDuty: {},
  duty84: { log: [], removedDates: [], addedDates: [] },
  cny: { lastD: {}, log: [] },
  notices: [],
  debts: [],
});

const state = reactive<SchedState>({ loaded: false, group: DEFAULT_GROUP, months: {}, prebooks: {}, logs: {}, locks: {}, ests: {}, overtimes: {}, ...defaults() });
let loading: Promise<void> | null = null;

type DocState = Omit<SchedState, "loaded">;

/** 由本機文件組出某群組的狀態（共用文件＋該群組的文件） */
function stateFromRows(rows: { key: string; json: string }[], group: string): DocState {
  const s: DocState = { group, months: {}, prebooks: {}, logs: {}, locks: {}, ests: {}, overtimes: {}, ...defaults() };
  for (const r of rows) putDoc(s, r.key, JSON.parse(r.json));
  return s;
}

/** 文件內容放進狀態；不屬於該群組的群組文件略過 */
function putDoc(s: DocState, key: string, val: unknown) {
  const { group, base } = splitKey(key);
  if (group !== null && group !== s.group) return;
  if (base.startsWith("month:")) s.months[base.slice(6)] = val as MonthDoc;
  else if (base.startsWith("prebook:")) s.prebooks[base.slice(8)] = val as PrebookDoc;
  else if (base.startsWith("log:")) s.logs[base.slice(4)] = val as LogDoc;
  else if (base.startsWith("lock:")) s.locks[base.slice(5)] = val as LockInfo | null;
  else if (base.startsWith("est:")) s.ests[base.slice(4)] = val as EstDoc;
  else if (base.startsWith("overtime:")) s.overtimes[base.slice(9)] = val as OvertimeDoc;
  else if (base in defaults()) (s as unknown as Record<string, unknown>)[base] = val;
}

async function allRows(): Promise<{ key: string; json: string }[]> {
  const db = await getDb();
  return db.select<{ key: string; json: string }[]>("SELECT key, json FROM sched_docs");
}

async function load(): Promise<void> {
  Object.assign(state, stateFromRows(await allRows(), state.group));
  state.loaded = true;
}

/** 文件內容放進記憶體狀態（雲端下載用） */
function applyToState(key: string, val: unknown) {
  putDoc(state, key, val);
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

const dirtyListeners = new Set<() => void>();
/** 本機有文件變更時通知（自動同步用） */
export function onSchedDirty(fn: () => void): () => void {
  dirtyListeners.add(fn);
  return () => dirtyListeners.delete(fn);
}

/** 寫入群組文件（預設為目前群組；共用文件不加前綴） */
function writeDoc(base: string, value: unknown, group = state.group): Promise<void> {
  return writeRaw(groupKey(group, base), value);
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  await dbWrite(
    `INSERT INTO sched_docs (key, json, version, dirty) VALUES (?, ?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET json = excluded.json, version = excluded.version, dirty = 1`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
  dirtyListeners.forEach(fn => fn());
}

// ── 同步用（useSchedSync）──────────────────────────────────────────────
export interface LocalDocMeta { key: string; json: string; version: string; cloud_version: string | null; dirty: number }

export async function localDocs(): Promise<LocalDocMeta[]> {
  const db = await getDb();
  return db.select<LocalDocMeta[]>("SELECT key, json, version, cloud_version, dirty FROM sched_docs");
}

/**
 * 以雲端內容覆蓋本機；expectVersion 有值時只在本機版本未再變動時才覆蓋（避免蓋掉同步期間的新修改）。
 * 回傳是否已套用。
 */
export async function applyCloudDoc(key: string, json: string, cloudVersion: string, expectVersion?: string): Promise<boolean> {
  const r = expectVersion
    ? await dbWrite("UPDATE sched_docs SET json = ?, version = ?, cloud_version = ?, dirty = 0 WHERE key = ? AND version = ?", [json, cloudVersion, cloudVersion, key, expectVersion])
    : await dbWrite(
      `INSERT INTO sched_docs (key, json, version, cloud_version, dirty) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(key) DO UPDATE SET json = excluded.json, version = excluded.version, cloud_version = excluded.cloud_version, dirty = 0`,
      [key, json, cloudVersion, cloudVersion]);
  if (expectVersion && !r.rowsAffected) return false;
  applyToState(key, JSON.parse(json));
  return true;
}

/** 上傳成功：記下雲端版本；本機若在上傳期間又改過則保持 dirty */
export async function markSynced(key: string, sentVersion: string, cloudVersion: string): Promise<void> {
  await dbWrite("UPDATE sched_docs SET cloud_version = ?, dirty = CASE WHEN version = ? THEN 0 ELSE dirty END WHERE key = ?", [cloudVersion, sentVersion, key]);
}

export function saveLock(ym: string, info: LockInfo | null): Promise<void> {
  state.locks[ym] = info;
  return writeDoc(`lock:${ym}`, info);
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
export function appendLog(scope: string, action: string, detail: string, actor = "system"): Promise<void> {
  return appendLogTo(state, scope, action, detail, actor);
}

async function appendLogTo(s: DocState, scope: string, action: string, detail: string, actor: string): Promise<void> {
  const doc = s.logs[scope] ?? { key: scope, entries: [] };
  doc.entries.push({ at: new Date().toISOString(), actor, action, detail });
  if (doc.entries.length > LOG_LIMIT) doc.entries.splice(0, doc.entries.length - LOG_LIMIT);
  s.logs[scope] = doc;
  await writeDoc(`log:${scope}`, doc, s.group);
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

  // 匯入的名單歸到目前群組（ADR-025）：尚未分組的人設為目前群組，已屬其他群組的提示
  const inRoster = new Set(out.months.flatMap(m => m.roster.map(r => r.personId)));
  for (const p of out.people) {
    if (!inRoster.has(p.id)) continue;
    if (!p.group) p.group = state.group;
    else if (p.group !== state.group) out.report.warnings.push(`${p.name} 屬於「${groupName(p.group)}」，但出現在匯入的名單中`);
  }
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
  const rc = await recompute(null, "Excel 匯入後重新輪序", { allGroups: true });
  out.report.warnings.push(...rc.warnings);
  if (rc.notices) out.report.warnings.push(`系統預填覆蓋了 ${rc.notices} 筆預班（已寫入通知）`);
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
function snapshotOf(s: DocState): OpsState {
  return clone({
    people: s.people, shifts: s.shifts, quotaItems: s.quotaItems, holidays: s.holidays,
    holidayDuty: s.holidayDuty, duty84: s.duty84, cny: s.cny, months: s.months, prebooks: s.prebooks,
    rules: s.rules, debts: s.debts,
  });
}

export function snapshot(): OpsState {
  return snapshotOf(state);
}

const isSuper = () => useSchedSession().role === "super";
const ROTA_PENDING = "8-4／春節輪值有變動，需由 super 重新計算後才會存回";

/**
 * 存回 ops 產生的變更：文件、通知、操作紀錄、員工用的 est 文件。
 * 非 super 不寫共用的 8-4／春節（ADR-025），有變動時回傳提示。
 */
export function applyPatch(p: OpPatch): Promise<string[]> {
  return writePatch(state, p);
}

async function writePatch(s: DocState, p0: OpPatch): Promise<string[]> {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const { patch: p, changed } = isSuper() ? { patch: p0, changed: false } : stripSharedRota(p0);
  for (const m of p.months) { s.months[m.ym] = m; await writeDoc(`month:${m.ym}`, m, s.group); }
  for (const pb of p.prebooks) { s.prebooks[pb.ym] = pb; await writeDoc(`prebook:${pb.ym}`, pb, s.group); }
  // 共用文件一律寫到目前的記憶體狀態（重算其他群組時也是）
  if (p.duty84) { state.duty84 = p.duty84; await saveGlobal("duty84"); }
  if (p.cny) { state.cny = p.cny; await saveGlobal("cny"); }
  if (p.debts) { s.debts = p.debts; await writeDoc("debts", s.debts, s.group); }
  if (p.notices.length) { state.notices.push(...p.notices); await saveGlobal("notices"); }
  for (const e of p.ests) {
    const prev = s.ests[e.ym];
    if (prev && same({ ...prev, updatedAt: "" }, { ...e, updatedAt: "" })) continue;
    s.ests[e.ym] = e;
    await writeDoc(`est:${e.ym}`, e, s.group);
  }
  for (const l of p.logs) await appendLogTo(s, l.scope, l.action, l.detail, l.actor);
  return changed ? [ROTA_PENDING] : [];
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


/**
 * 人力結構改變後，自 fromYm（預設最早的開放月份）起往後重算預填、8-4、春節、V 交接。
 * 只寫回有變動的文件；覆蓋員工預約產生的通知存入 notices。
 * allGroups：共用資料（人員、假日、8-4、春節）變更時，super 一併重算其他群組（ADR-025）。
 */
export async function recompute(fromYm: string | null, reason: string, opts: { allGroups?: boolean } = {}): Promise<{ notices: number; warnings: string[] }> {
  await ensureSchedLoaded();
  const now = new Date().toISOString();
  let notices = 0;
  const warnings: string[] = [];
  const from = laterYm(fromYm, firstOpenYm());
  if (from) {
    const p = opRecompute(snapshot(), from, reason, now);
    warnings.push(...p.warnings, ...await applyPatch(p));
    notices += p.notices.length;
  }
  if (opts.allGroups && isSuper()) {
    const rows = await allRows();
    for (const g of schedGroups()) {
      if (g.id === state.group) continue;
      const s = stateFromRows(rows, g.id);
      Object.assign(s, { people: state.people, holidays: state.holidays, duty84: state.duty84, cny: state.cny });
      const gFrom = laterYm(fromYm, Object.keys(s.months).sort().find(ym => s.months[ym].status === "open") ?? null);
      if (!gFrom) continue;
      const p = opRecompute(snapshotOf(s), gFrom, `${reason}（${groupName(state.group)} 帶動）`, now);
      await writePatch(s, p);
      notices += p.notices.length;
      warnings.push(...p.warnings.map(w => `${g.name}：${w}`));
    }
  }
  return { notices, warnings };
}

/** 兩者取較晚的月份；開放月份不存在時為 null */
function laterYm(fromYm: string | null, open: string | null): string | null {
  return [fromYm, open].filter((x): x is string => !!x).sort().pop() ?? null;
}

/** 自動維持開放範圍（ADR-020）：建立缺少的月份、同步遠期名單、進入近期的月份預填；回傳是否有變動 */
export async function ensureMonths(): Promise<boolean> {
  await ensureSchedLoaded();
  const p = opEnsureMonths(snapshot(), new Date(), actorName(), new Date().toISOString());
  if (isEmptyPatch(p)) return false;
  await applyPatch(p);
  return true;
}

/** 新群組建立第一個月份（ADR-025）：名單＝本群組在職人員 */
export async function createFirstMonth(): Promise<void> {
  await ensureSchedLoaded();
  const ids = [...groupPeople()].filter(p => p.active).sort((a, b) => a.order - b.order).map(p => p.id);
  if (!ids.length) throw new Error("這個群組還沒有在職人員，請先在人員名單設定群組");
  await applyPatch(opFirstMonth(snapshot(), ids, new Date(), actorName(), new Date().toISOString()));
}

/** 開始排班：預班凍結、帶入排班層、交接 V 並算出配額（上月未發布需 force） */
export async function startMonth(ym: string, force = false): Promise<void> {
  await ensureSchedLoaded();
  await applyPatch(opStartMonth(snapshot(), ym, force, actorName(), new Date().toISOString()));
}

/** 清除全部排班 v3 本機文件（重新匯入前使用；雲端資料不受影響） */
export async function clearSchedLocal(): Promise<void> {
  await dbWrite("DELETE FROM sched_docs");
  await reloadSched();
}

// ── 假勤（ADR-027）────────────────────────────────────────────────────
export function leaveRulesOf(): LeaveRules {
  return normalizeLeaveRules(state.leaveRules);
}

/** 個人假勤帳：目前群組到 uptoYm 為止的月份（含排班中、開放預班已排的假） */
export function personLedger(personId: string, uptoYm: string): LeaveLedger {
  const overtime = Object.values(state.overtimes).flatMap(d =>
    d.items.filter(i => i.personId === personId).map(i => ({ ym: d.ym, day: i.day, hours: i.hours })));
  return leaveLedger({
    hireDate: personById(personId)?.hireDate ?? "", rules: leaveRulesOf(), open: state.leaveOpen[personId],
    shifts: state.shifts, holidays: state.holidays,
    months: monthInputs(state.months, state.prebooks, personId).filter(m => m.ym <= uptoYm),
    overtime, pay: undefined,
  });
}

// ── 群組（ADR-025）────────────────────────────────────────────────────
export function schedGroups(): SchedGroup[] {
  return groupList(state.groups);
}

export function groupName(id: string): string {
  return schedGroups().find(g => g.id === id)?.name ?? id;
}

/** 目前群組的人員（月份名單、抽籤候選） */
export function groupPeople(): Person[] {
  return state.people.filter(p => personGroup(p) === state.group);
}

/** 切換目前群組：重新載入該群組的文件 */
export async function setSchedGroup(group: string): Promise<void> {
  if (group === state.group && state.loaded) return;
  state.group = group;
  await reloadSched();
}

/** 新增群組（super）：班別、配額項目、規則從預設群組複製一份當起點 */
export async function addGroup(id: string, name: string): Promise<void> {
  const gid = id.trim();
  if (!GROUP_ID.test(gid)) throw new Error("群組代號只能用英文字母與數字（最多 12 字）");
  const list = schedGroups();
  if (list.some(g => g.id.toLowerCase() === gid.toLowerCase())) throw new Error("群組代號已存在");
  const base = stateFromRows(await allRows(), DEFAULT_GROUP);
  for (const k of ["shifts", "quotaItems", "rules"] as const) await writeDoc(k, base[k], gid);
  state.groups = [...list, { id: gid, name: name.trim() || gid, order: Math.max(...list.map(g => g.order)) + 1 }];
  await saveGlobal("groups");
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const list = schedGroups();
  const g = list.find(x => x.id === id);
  if (!g || !name.trim()) return;
  g.name = name.trim();
  state.groups = list;
  await saveGlobal("groups");
}

/** 刪除群組（super）：預設群組、還有人員或已有月份的群組不能刪 */
export async function removeGroup(id: string): Promise<void> {
  if (id === DEFAULT_GROUP) throw new Error("預設群組不能刪除");
  if (state.people.some(p => personGroup(p) === id)) throw new Error("還有人員屬於這個群組");
  if ((await allRows()).some(r => r.key.startsWith(`${id}/month:`))) throw new Error("這個群組已有月份班表，不能刪除");
  state.groups = schedGroups().filter(g => g.id !== id);
  await saveGlobal("groups");
}

/** 人員是否出現在任一群組的月份名單（刪除人員前檢查） */
export async function personInAnyRoster(id: string): Promise<boolean> {
  return (await allRows()).some(r => splitKey(r.key).base.startsWith("month:")
    && (JSON.parse(r.json) as MonthDoc).roster?.some(x => x.personId === id));
}

export function useSchedStore() {
  return state;
}
