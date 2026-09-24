import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import * as XLSX from "xlsx";
import { distribute, transferNight, computeQuotas, handoverV, holidayCount } from "./quota";
import { parseMonthSheet, parse84 } from "@/utils/sched/excelImport";
import { buildImport } from "@/utils/sched/importApply";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, emptyFlags, emptyMonth, type MonthDoc } from "../types";
import { emptyHolidays } from "../calendar";

describe("distribute", () => {
  const el = ["a", "b", "c", "d"];
  it("餘數從 V 開始，X 為最後一位", () => {
    expect(distribute(el, 10, "c")).toEqual({ values: { a: 2, b: 2, c: 3, d: 3 }, x: "d" });
    expect(distribute(el, 11, "c")).toEqual({ values: { a: 3, b: 2, c: 3, d: 3 }, x: "a" });
  });
  it("整除時 X＝V 的前一位", () => {
    expect(distribute(el, 8, "c")).toEqual({ values: { a: 2, b: 2, c: 2, d: 2 }, x: "b" });
    expect(distribute(el, 8, "a").x).toBe("d");
  });
  it("V 不在名單時從第一位開始", () => {
    expect(distribute(el, 5, "z")).toEqual({ values: { a: 2, b: 1, c: 1, d: 1 }, x: "a" });
  });
});

describe("transferNight", () => {
  it("轉出者的 N 從 X 下一位起發給他人，收受者還 D", () => {
    const n = { a: 2, b: 2, c: 2, d: 1 }, d = { a: 2, b: 2, c: 2, d: 3 };
    const x = transferNight(["a", "b", "c", "d"], new Set(["b"]), n, d, "c");
    expect(n).toEqual({ a: 3, b: 0, c: 2, d: 2 });
    expect(d).toEqual({ a: 1, b: 4, c: 2, d: 2 });
    expect(x).toBe("a");
  });
});

describe("handoverV", () => {
  const item = DEFAULT_QUOTA_ITEMS[0]; // D
  const R = (id: string, f: Partial<ReturnType<typeof emptyFlags>> = {}) => ({ personId: id, flags: { ...emptyFlags(), ...f } });
  it("X 的下一位合格者，跳過不排 D", () => {
    const roster = [R("a"), R("b", { noD: true }), R("c")];
    expect(handoverV(item, roster, { v: "c", x: "a" }, roster)).toBe("c");
    expect(handoverV(item, roster, { v: "a", x: "c" }, roster)).toBe("a");
  });
  it("X 離開名單時從上月順序往後找", () => {
    const prev = [R("a"), R("b"), R("c"), R("d")];
    const next = [R("a"), R("c"), R("d")];
    expect(handoverV(item, prev, { v: "a", x: "b" }, next)).toBe("c");
  });
  it("沒有 X 時沿用 V", () => {
    expect(handoverV(item, [R("a")], { v: "a", x: null }, [R("a")])).toBe("a");
  });
});

describe("holidayCount", () => {
  it("2026-10：週六 5＋週日 4＋平日國定 2＝11", () => {
    const h = emptyHolidays();
    for (const d of ["2026-10-09", "2026-10-10", "2026-10-25", "2026-10-26"]) h.days[d] = "國";
    expect(holidayCount("202610", h)).toBe(11);
  });
});

// ── 與醫院 Excel 202610 逐項比對 ─────────────────────────────────────
const XLS = "data/9A值班表(排班用、預班)-9A9B combind.xls";
const hasXls = existsSync(XLS);

describe.skipIf(!hasXls)("Excel 202610 配額一致性", () => {
  const wb = hasXls ? XLSX.read(readFileSync(XLS)) : null!;
  const codes = DEFAULT_SHIFTS.map(s => s.code);
  const out = hasXls ? buildImport({
    base: parseMonthSheet(wb, "202610", codes), extras: [], p84: parse84(wb), people: [],
    holidays: emptyHolidays(), holidayDuty: {}, legacyUsers: [], physicians: [], now: "",
  }) : null!;
  const m = hasXls ? out.months[0] : ({} as MonthDoc);
  // 以匯入的 V 為起點重算（X 由引擎算出）
  const start: MonthDoc = hasXls ? { ...m, markers: Object.fromEntries(Object.entries(m.markers).map(([k, v]) => [k, { v: v.v, x: null }])) } : m;
  const name = (id: string | null) => out.people.find(p => p.id === id)?.name;

  it("Excel 算配額時 8-4 尚未填入：不含 8-4 重算，四項配額與 X 完全一致", () => {
    const r = computeQuotas({
      month: start, holidays: out.holidays, shifts: DEFAULT_SHIFTS, items: DEFAULT_QUOTA_ITEMS,
      cell: (id, d) => { const v = m.schedule[id][d - 1]; return v === "8-4" ? "" : v; },
    });
    expect(r.totals).toEqual({ D: 31, N: 31, OFF: 121, W6OFF: 19 });
    expect(r.fixedOff).toBe(11);
    expect(r.quotas).toEqual(m.frozenQuotas);
    for (const k of ["D", "N", "OFF", "W6OFF"]) expect(name(r.markers[k].x)).toBe(name(m.markers[k].x));
  });

  it("含 8-4（10/4、10/18）時 OFF 總數為 119", () => {
    const r = computeQuotas({
      month: start, holidays: out.holidays, shifts: DEFAULT_SHIFTS, items: DEFAULT_QUOTA_ITEMS,
      cell: (id, d) => m.schedule[id][d - 1],
    });
    expect(r.totals.OFF).toBe(119);
    expect(r.offSlots[3]).toBe(6);  // 10/4 週日：9 − 2 − 1
    expect(r.offSlots[4]).toBe(3);  // 10/5 平日：9 − 6
  });

  it("交接到 202611：X 的下一位", () => {
    const next = { ...emptyMonth("202611"), roster: m.roster };
    const v = Object.fromEntries(DEFAULT_QUOTA_ITEMS.map(it => [it.id, name(handoverV(it, m.roster, m.markers[it.id], next.roster))]));
    expect(v).toEqual({ D: "張心柔", N: "詹雅慈", OFF: "馮佳祺", W6OFF: "黃郁芳" });
  });
});
