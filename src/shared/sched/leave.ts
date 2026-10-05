/**
 * 假勤計算（ADR-027）：特休（含展延）、補假、補換假餘額與每月統計、值班費。
 * 一律以小時記帳。桌機（排班提醒）與手機（我的班統計）共用。
 *
 * - 特休：到職滿半年與之後每個到職週年給額度；期滿未休完轉展延保留一年，展延期滿作廢。先扣展延再扣當年度
 * - 補假：每排一班累積該班別的補假時數＋（應休天數 − 實際 OFF 天數）× 1 天時數；只在月份發布後計入
 * - 補換假：員工登記的加班時數
 */
import type { HolidayDoc, LeaveKind, ShiftDef, MonthDoc, PrebookDoc } from "./types";
import { daysIn, dateStr, dowOf, inCny } from "./calendar";
import { cellFnOf } from "./engine/prefill";

export interface AnnualStep { months: number; days: number }

/** 假勤參數（共用文件 leaveRules，super 設定） */
export interface LeaveRules {
  hoursPerDay: number;
  /** 年資（月）→ 特休天數；超過最後一級後每滿一年加 incPerYear 天，最多 maxDays */
  annual: AnnualStep[];
  incPerYear: number;
  maxDays: number;
  /** 國定假日、春節的值班費倍率 */
  holidayPayRate: number;
  /** 排班時任一假別餘額低於此天數即提醒 */
  lowBalanceDays: number;
}

/** 勞基法第 38 條 */
export const DEFAULT_LEAVE_RULES: LeaveRules = {
  hoursPerDay: 8,
  annual: [
    { months: 6, days: 3 }, { months: 12, days: 7 }, { months: 24, days: 10 },
    { months: 36, days: 14 }, { months: 60, days: 15 }, { months: 120, days: 16 },
  ],
  incPerYear: 1,
  maxDays: 30,
  holidayPayRate: 1,
  lowBalanceDays: 5,
};

/** 期初餘額（共用文件 leaveOpen，personId → 本人在手機填寫）：自 from 月份 1 日起算 */
export interface LeaveOpen {
  from: string;          // YYYYMM
  annual: number;        // 當期特休剩餘（小時）
  carry: number;         // 特休展延剩餘（小時）
  carryUntil: string;    // 展延到期日 YYYY-MM-DD（當天起作廢）
  comp: number;
  swap: number;
}
export type LeaveOpenDoc = Record<string, LeaveOpen>;

/** 個人薪資設定（只有本人與 super）：時薪、各班別值班費（覆蓋班別預設值） */
export interface PaySetting { hourly: number; dutyPay: Record<string, number> }

/** 加班登記（依群組每月 overtime:YYYYMM，員工自己登記） */
export interface OvertimeItem { id: string; personId: string; day: number; hours: number; note: string; at: string }
export interface OvertimeDoc { ym: string; items: OvertimeItem[] }

export const LEAVE_LABELS: Record<LeaveKind | "carry", string> = { annual: "特休", carry: "特休展延", comp: "補假", swap: "補換假" };

const LEAVE_BY_CODE: Record<string, LeaveKind> = { 特休: "annual", 補假: "comp", 補換假: "swap" };

/** 班別扣哪一種假（沒有設定時依代號） */
export function leaveOf(s: ShiftDef | undefined, hoursPerDay = 8): { kind: LeaveKind; hours: number } | null {
  if (!s) return null;
  if (s.leave !== undefined) return s.leave;
  const kind = LEAVE_BY_CODE[s.code];
  return kind ? { kind, hours: hoursPerDay } : null;
}

/** 排此班累積的補假時數（沒有設定時：12 小時以上的上班班別累積超出 8 小時的部分） */
export function compAccrueOf(s: ShiftDef | undefined): number {
  if (!s) return 0;
  if (s.compAccrue !== undefined) return s.compAccrue;
  return s.staffing && s.hours > 8 ? s.hours - 8 : 0;
}

export function normalizeLeaveRules(raw: Partial<LeaveRules> | null | undefined): LeaveRules {
  return { ...DEFAULT_LEAVE_RULES, ...(raw ?? {}) };
}

/** 年資 m 個月時給的特休天數 */
export function annualDaysAt(rules: LeaveRules, months: number): number {
  const steps = [...rules.annual].sort((a, b) => a.months - b.months);
  const hit = steps.filter(s => s.months <= months).pop();
  if (!hit) return 0;
  const last = steps[steps.length - 1];
  if (hit !== last) return hit.days;
  return Math.min(rules.maxDays, last.days + Math.floor((months - last.months) / 12) * rules.incPerYear);
}

function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** 給特休的日期與年資月數：滿半年、之後每個到職週年 */
export function grantPoints(hireDate: string, until: string): { date: string; months: number }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return [];
  const out: { date: string; months: number }[] = [];
  for (let m = 6; ; m = m === 6 ? 12 : m + 12) {
    const date = addMonths(hireDate, m);
    if (date > until) break;
    out.push({ date, months: m });
  }
  return out;
}

/** 應休天數：週六＋週日＋國定假日（同一天只算一次） */
export function requiredOffDays(ym: string, h: HolidayDoc): number {
  let n = 0;
  for (let d = 1; d <= daysIn(ym); d++) {
    const w = dowOf(ym, d);
    if (w === 0 || w === 6 || dateStr(ym, d) in h.days) n++;
  }
  return n;
}

export interface LeaveMonthInput {
  ym: string;
  /** 已發布（補假只在發布後計入） */
  published: boolean;
  /** 當天的班別代號（空白＝沒有班） */
  code: (day: number) => string;
}

export interface LeaveInput {
  hireDate: string;
  rules: LeaveRules;
  open: LeaveOpen | undefined;
  shifts: ShiftDef[];
  holidays: HolidayDoc;
  months: LeaveMonthInput[];
  overtime: { ym: string; day: number; hours: number }[];
  pay: PaySetting | undefined;
}

export interface LeaveMonthStat {
  ym: string;
  published: boolean;
  used: Record<LeaveKind, number>;
  compFromShifts: number;
  compFromUnrest: number;
  requiredOff: number;
  offDays: number;
  swapFromOvertime: number;
  dutyPay: number;
  /** 用班別預設值計算值班費的班別 */
  dutyPayDefaults: string[];
  /** 已設定值班費（個人或預設）卻是 0 的班別不算；沒有任何設定的值班班別 */
  dutyPayMissing: string[];
}

export interface LeaveBalance {
  annual: number;
  carry: number;
  carryUntil: string;
  comp: number;
  swap: number;
  /** 當期特休額度（小時）與當期起訖 */
  annualQuota: number;
  periodStart: string;
  nextGrant: string;
  expired: { date: string; hours: number }[];
}

export interface LeaveLedger { balance: LeaveBalance; months: Record<string, LeaveMonthStat> }

/**
 * 依序走過每個月份的每一天計算。月份需由舊到新；期初餘額之前的月份略過。
 * 沒有期初餘額時從第一個月份開始，餘額由 0 起算。
 */
export function leaveLedger(inp: LeaveInput): LeaveLedger {
  const { rules, holidays: h } = inp;
  const hpd = rules.hoursPerDay;
  const byCode = new Map(inp.shifts.map(s => [s.code, s]));
  const o = inp.open;
  const months = [...inp.months].sort((a, b) => a.ym.localeCompare(b.ym)).filter(m => !o || m.ym >= o.from);
  const startYm = o?.from ?? months[0]?.ym ?? "";
  const bal: LeaveBalance = {
    annual: o?.annual ?? 0, carry: o?.carry ?? 0, carryUntil: o?.carryUntil ?? "", comp: o?.comp ?? 0, swap: o?.swap ?? 0,
    annualQuota: 0, periodStart: "", nextGrant: "", expired: [],
  };
  const lastYm = months[months.length - 1]?.ym ?? startYm;
  const end = lastYm ? dateStr(lastYm, daysIn(lastYm)) : "";
  const grants = grantPoints(inp.hireDate, "9999-12-31");
  const startDate = startYm ? dateStr(startYm, 1) : "";
  // 期初時所在的特休期間
  const cur = grants.filter(g => g.date < startDate).pop();
  if (cur) { bal.periodStart = cur.date; bal.annualQuota = annualDaysAt(rules, cur.months) * hpd; }
  const pending = grants.filter(g => g.date >= startDate);

  // 展延可能同時有兩筆（期初填的與期滿轉入的），各有到期日，先扣先到期的
  const lots: { hours: number; until: string }[] = o && o.carry > 0 ? [{ hours: o.carry, until: o.carryUntil }] : [];
  const syncCarry = () => {
    lots.sort((a, b) => a.until.localeCompare(b.until));
    bal.carry = lots.reduce((a, l) => a + l.hours, 0);
    bal.carryUntil = lots[0]?.until ?? "";
  };
  const expireCarry = (date: string) => {
    while (lots.length && lots[0].until && date >= lots[0].until) {
      const l = lots.shift()!;
      if (l.hours > 0) bal.expired.push({ date: l.until, hours: l.hours });
    }
    syncCarry();
  };
  const useCarry = (hours: number): number => {
    let left = hours;
    for (const l of lots) {
      const take = Math.min(Math.max(l.hours, 0), left);
      l.hours -= take;
      left -= take;
    }
    for (let i = lots.length - 1; i >= 0; i--) if (lots[i].hours <= 0) lots.splice(i, 1);
    syncCarry();
    return hours - left;
  };
  const grant = (g: { date: string; months: number }) => {
    expireCarry(g.date);
    // 當期剩餘轉展延，保留一年
    if (bal.annual > 0) lots.push({ hours: bal.annual, until: addMonths(g.date, 12) });
    syncCarry();
    bal.annual = annualDaysAt(rules, g.months) * hpd;
    bal.annualQuota = bal.annual;
    bal.periodStart = g.date;
  };
  syncCarry();

  const stats: Record<string, LeaveMonthStat> = {};
  for (const m of months) {
    const st: LeaveMonthStat = {
      ym: m.ym, published: m.published, used: { annual: 0, comp: 0, swap: 0 },
      compFromShifts: 0, compFromUnrest: 0, requiredOff: requiredOffDays(m.ym, h), offDays: 0,
      swapFromOvertime: 0, dutyPay: 0, dutyPayDefaults: [], dutyPayMissing: [],
    };
    for (let d = 1; d <= daysIn(m.ym); d++) {
      const date = dateStr(m.ym, d);
      while (pending.length && pending[0].date <= date) grant(pending.shift()!);
      expireCarry(date);
      const code = m.code(d);
      if (!code) continue;
      if (code === "OFF") st.offDays++;
      const s = byCode.get(code);
      const lv = leaveOf(s, hpd);
      if (lv) {
        st.used[lv.kind] += lv.hours;
        if (lv.kind === "annual") bal.annual -= lv.hours - useCarry(lv.hours);
        else bal[lv.kind] -= lv.hours;
      }
      if (m.published) st.compFromShifts += compAccrueOf(s);
      // 值班費：個人設定優先，沒有就用班別預設值
      const own = inp.pay?.dutyPay?.[code];
      const base = own ?? s?.dutyPay ?? 0;
      if (own === undefined && s?.dutyPay) { if (!st.dutyPayDefaults.includes(code)) st.dutyPayDefaults.push(code); }
      if (own === undefined && s?.dutyPay === undefined && s && compAccrueOf(s) > 0 && !st.dutyPayMissing.includes(code)) st.dutyPayMissing.push(code);
      const holiday = date in h.days || inCny(h, date);
      st.dutyPay += base * (holiday ? rules.holidayPayRate : 1);
    }
    if (m.published) {
      st.compFromUnrest = Math.max(0, st.requiredOff - st.offDays) * hpd;
      bal.comp += st.compFromShifts + st.compFromUnrest;
    }
    st.swapFromOvertime = inp.overtime.filter(x => x.ym === m.ym).reduce((a, x) => a + x.hours, 0);
    bal.swap += st.swapFromOvertime;
    stats[m.ym] = st;
  }
  if (end) expireCarry(end);
  bal.nextGrant = pending[0]?.date ?? "";
  return { balance: bal, months: stats };
}

/** 小時 → 「X 天 Y 小時」 */
export function fmtLeave(hours: number, hoursPerDay = 8): string {
  const neg = hours < 0;
  const h = Math.abs(Math.round(hours * 10) / 10);
  const d = Math.floor(h / hoursPerDay), r = Math.round((h - d * hoursPerDay) * 10) / 10;
  const s = d && r ? `${d} 天 ${r} 小時` : d ? `${d} 天` : `${r} 小時`;
  return neg ? `−${s}` : s;
}

/** 月份文件 → 計算輸入（排班中、已發布用排班層；開放預班用預班層） */
export function monthInputs(
  months: Record<string, MonthDoc>, prebooks: Record<string, PrebookDoc | undefined>, personId: string,
): LeaveMonthInput[] {
  return Object.values(months).map(m => {
    const cell = cellFnOf(m, prebooks[m.ym]);
    return { ym: m.ym, published: m.status === "published", code: (d: number) => cell(personId, d) };
  });
}

/**
 * 餘額不足（避免排超過）：該月有排這種假、扣完後低於門檻（或已是負數）才提醒。
 * 特休與展延合併判斷。
 */
export function lowBalances(l: LeaveLedger, ym: string, rules: LeaveRules): { kind: LeaveKind; hours: number }[] {
  const used = l.months[ym]?.used;
  if (!used) return [];
  const limit = rules.lowBalanceDays * rules.hoursPerDay;
  const left: Record<LeaveKind, number> = { annual: l.balance.annual + l.balance.carry, comp: l.balance.comp, swap: l.balance.swap };
  return (["annual", "comp", "swap"] as LeaveKind[])
    .filter(k => used[k] > 0 && left[k] < limit)
    .map(k => ({ kind: k, hours: left[k] }));
}
