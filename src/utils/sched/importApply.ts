/**
 * 解析後的 Excel → 排班 v3 文件（純函式）。
 * 以姓名配對既有人員主檔；舊 scheduler_users 以姓名帶入 HIS 帳號與角色。
 */
import type { ParsedMonth, Parsed84 } from "./excelImport";
import type {
  Person, HolidayDoc, HolidayDutyDoc, Duty84Doc, MonthDoc, PrebookDoc, Role, CellOrigin, WeekendPointers,
} from "./types";
import { emptyMonth, newId, cellKey, CONSTRAINT_MARKS } from "./types";
import { dayTypeOf, dowOf, daysIn } from "./calendar";
import { nextInOrder } from "./engine/rotation";

export interface LegacyUser { name: string; employee_id: string | null; role: string; is_active: number }
export interface PhysicianHis { name: string; his_account: string | null }

export interface ImportInput {
  base: ParsedMonth;               // 起點月份（完整匯入，視為已發布）
  extras: ParsedMonth[];           // 只匯入預班與國假
  p84: Parsed84 | null;
  people: Person[];                // 既有人員主檔
  holidays: HolidayDoc;
  holidayDuty: HolidayDutyDoc;
  legacyUsers: LegacyUser[];
  physicians: PhysicianHis[];
  now: string;                     // ISO
}

export interface ImportReport {
  created: string[];
  updated: string[];
  unmatchedLegacy: string[];       // 舊帳號配不到人員主檔
  noHis: string[];                 // 人員沒有 HIS 帳號
  warnings: string[];
}

export interface ImportOutput {
  people: Person[];
  holidays: HolidayDoc;
  holidayDuty: HolidayDutyDoc;
  duty84: Duty84Doc | null;
  months: MonthDoc[];
  prebooks: PrebookDoc[];
  report: ImportReport;
}

const mapRole = (r: string): Role => (r === "super" ? "super" : r === "admin" || r === "scheduler" ? "scheduler" : "employee");

export function buildImport(inp: ImportInput): ImportOutput {
  const report: ImportReport = { created: [], updated: [], unmatchedLegacy: [], noHis: [], warnings: [] };
  const people = inp.people.map(p => ({ ...p }));
  const byName = new Map(people.map(p => [p.name, p]));
  let order = people.reduce((m, p) => Math.max(m, p.order), -1) + 1;

  function upsert(name: string, patch: Partial<Person>): Person {
    let p = byName.get(name);
    if (!p) {
      p = {
        id: newId(), name, unit: "", ext: "", his: "", role: "employee", code84: "",
        order: order++, exempt84: false, exemptCny: false, active: true,
      };
      people.push(p);
      byName.set(name, p);
      report.created.push(name);
    } else if (!report.created.includes(name) && !report.updated.includes(name)) {
      report.updated.push(name);
    }
    Object.assign(p, patch);
    return p;
  }

  // ① 8-4 名單（全外科）：順序依表列
  if (inp.p84) {
    inp.p84.people.forEach((r, i) => upsert(r.name, { code84: r.code, ext: r.ext, exempt84: r.exempt, order: i }));
    order = Math.max(order, inp.p84.people.length);
  }
  // ② 9A 排班名單
  const in84 = new Set(inp.p84?.people.map(r => r.name) ?? []);
  if (inp.p84) {
    const miss = inp.base.roster.filter(r => !in84.has(r.name)).map(r => r.name);
    if (miss.length) report.warnings.push(`9A 名單有人不在 8-4 名單，已設為 8-4／春節免輪（請確認是否為錯字）：${miss.join("、")}`);
  }
  for (const r of inp.base.roster) {
    const isNew = !byName.has(r.name);
    upsert(r.name, isNew && inp.p84 && !in84.has(r.name) ? { unit: "9A", exempt84: true, exemptCny: true } : { unit: "9A" });
  }

  // ③ HIS 帳號與角色：舊帳號優先，其次通訊錄
  const matchedLegacy = new Set<string>();
  for (const p of people) {
    const lu = inp.legacyUsers.find(u => u.name === p.name);
    if (lu) {
      matchedLegacy.add(lu.name);
      if (!p.his && lu.employee_id) p.his = lu.employee_id;
      p.role = mapRole(lu.role);
    }
    if (!p.his) {
      const ph = inp.physicians.find(x => x.name === p.name && x.his_account);
      if (ph?.his_account) p.his = ph.his_account;
    }
    if (!p.his) report.noHis.push(p.name);
  }
  report.unmatchedLegacy = inp.legacyUsers
    .filter(u => !matchedLegacy.has(u.name) && u.employee_id !== "super")
    .map(u => `${u.name}（${u.employee_id ?? "無員編"}，${u.role}）`);

  const idOf = (name: string) => byName.get(name)?.id ?? null;

  // ④ 國定假日
  const holidays: HolidayDoc = structuredClone(inp.holidays);
  for (const pm of [inp.base, ...inp.extras]) {
    for (const d of pm.holidays) if (!(d in holidays.days)) holidays.days[d] = "國定假日";
  }

  // ⑤ 國定假日抽籤結果：取該日 D／N 的人（起點月用排班區，其餘用預班區）
  const holidayDuty: HolidayDutyDoc = structuredClone(inp.holidayDuty);
  for (const pm of [inp.base, ...inp.extras]) {
    const src = pm === inp.base ? pm.schedule : pm.prebook;
    for (const d of pm.holidays) {
      const day = Number(d.slice(8, 10));
      const find = (codes: string[]) => {
        const n = Object.keys(src).find(k => codes.includes(src[k][day - 1]));
        return n ? idOf(n) : null;
      };
      const y = d.slice(0, 4);
      holidayDuty[y] ??= {};
      holidayDuty[y][d] = { D: find(["D", "NrsD"]), N: find(["N"]) };
    }
  }

  // ⑥ 起點月份：完整匯入並視為已發布
  const b = inp.base;
  const mdoc = emptyMonth(b.ym);
  mdoc.status = "published";
  mdoc.imported = true;
  mdoc.publishedAt = inp.now;
  mdoc.roster = b.roster.map(r => ({ personId: idOf(r.name)!, flags: { ...r.flags } }));
  mdoc.staffing.base = structuredClone(b.staffing.base);
  if (b.staffing.halfStart && b.staffing.second) {
    mdoc.staffing.ranges = [{ from: b.staffing.halfStart, to: daysIn(b.ym), table: structuredClone(b.staffing.second) }];
  }
  const isMark = (v: string) => (CONSTRAINT_MARKS as readonly string[]).includes(v);
  for (const r of b.roster) {
    const id = idOf(r.name)!;
    // 勿休／勿值不是班別：排班層不存，只留在預班層當限制
    mdoc.schedule[id] = b.schedule[r.name].map(v => (isMark(v) ? "" : v));
    mdoc.origin[id] = b.schedule[r.name].map((v, i): CellOrigin => {
      const pre = b.prebook[r.name]?.[i] ?? "";
      if (!pre || isMark(pre) || pre !== v) return "";
      return pre === "8-4" ? "sys" : "pre";
    });
  }
  for (const [item, mk] of Object.entries(b.markers)) {
    mdoc.markers[item] = { v: mk.v ? idOf(mk.v) : null, x: mk.x ? idOf(mk.x) : null };
  }
  mdoc.frozenQuotas = Object.fromEntries(b.roster.map(r => [idOf(r.name)!, { ...b.quotas[r.name] }]));
  mdoc.weekend.end = weekendEndFromSchedule(b.ym, mdoc, holidays);

  // ⑦ 預班文件
  const prebooks: PrebookDoc[] = [];
  for (const pm of [inp.base, ...inp.extras]) {
    const doc: PrebookDoc = { ym: pm.ym, cells: {} };
    for (const [name, days] of Object.entries(pm.prebook)) {
      const id = idOf(name);
      if (!id) { report.warnings.push(`${pm.ym} 預班：找不到人員 ${name}`); continue; }
      days.forEach((v, i) => {
        if (!v) return;
        doc.cells[cellKey(id, i + 1)] = {
          v, src: v === "8-4" ? "sys" : "emp", by: "excel-import", at: inp.now,
        };
      });
    }
    prebooks.push(doc);
    report.warnings.push(...pm.warnings.map(w => `${pm.ym}：${w}`));
  }
  for (const pm of inp.extras) {
    const missing = pm.roster.filter(r => !byName.has(r.name)).map(r => r.name);
    if (missing.length) report.warnings.push(`${pm.ym} 名單有起點月沒有的人：${missing.join("、")}`);
  }

  // ⑧ 8-4 永久輪值明細
  let duty84: Duty84Doc | null = null;
  if (inp.p84) {
    const byCode = new Map(people.filter(p => p.code84).map(p => [p.code84, p.id]));
    // 「待排」（外單位尚未寫入）依名單順序接續上一位補上人選
    const order = [...people].sort((a, b) => a.order - b.order);
    const ok = (id: string) => { const p = order.find(x => x.id === id)!; return p.active && !p.exempt84; };
    let ptr: string | null = null;
    duty84 = {
      log: [...inp.p84.log].sort((a, b) => a.date.localeCompare(b.date)).map(l => {
        const personId = (l.code ? byCode.get(l.code) : null) ?? nextInOrder(order.map(p => p.id), ptr, ok);
        if (personId) ptr = personId;
        return { date: l.date, personId, kind: l.kind || "一般週日", manual: false, note: l.note };
      }),
      removedDates: [],
      addedDates: [],
    };
  }

  return { people, holidays, holidayDuty, duty84, months: [mdoc], prebooks, report };
}

/** 由實際班表推算月底的週末輪序位置（最後一次非國定假日的週六 D、週日 D、週末 N） */
export function weekendEndFromSchedule(ym: string, m: MonthDoc, h: HolidayDoc): WeekendPointers {
  const end: WeekendPointers = { wkN: null, satD: null, sunD: null };
  const who = (day: number, codes: string[]) =>
    m.roster.find(r => codes.includes(m.schedule[r.personId]?.[day - 1] ?? ""))?.personId ?? null;
  for (let d = 1; d <= daysIn(ym); d++) {
    const dt = dayTypeOf(ym, d, h);
    if (dt === "holiday") continue;
    const dw = dowOf(ym, d);
    if (dw === 6) {
      end.satD = who(d, ["D", "NrsD"]) ?? end.satD;
      end.wkN = who(d, ["N"]) ?? end.wkN;
    } else if (dw === 0) {
      end.sunD = who(d, ["D", "NrsD"]) ?? end.sunD;
      end.wkN = who(d, ["N"]) ?? end.wkN;
    }
  }
  return end;
}
