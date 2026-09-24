import { describe, it, expect } from "vitest";
import { validate, personStats, dayStats, effectiveCode, type GridCtx } from "./validate";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, emptyFlags, emptyMonth, cellKey, type MonthDoc } from "../types";
import { emptyHolidays, daysIn } from "../calendar";

// 2026-11：1 號週日
function ctxOf(rows: Record<string, string[]>, opts: Partial<GridCtx> = {}, flags: Record<string, Partial<ReturnType<typeof emptyFlags>>> = {}): GridCtx {
  const m: MonthDoc = { ...emptyMonth("202611"), status: "scheduling" };
  m.roster = Object.keys(rows).map(id => ({ personId: id, flags: { ...emptyFlags(), ...(flags[id] ?? {}) } }));
  for (const [id, days] of Object.entries(rows)) {
    m.schedule[id] = Array.from({ length: daysIn("202611") }, (_, i) => days[i] ?? "");
  }
  return {
    month: m, prebook: { ym: "202611", cells: {} }, holidays: emptyHolidays(), shifts: DEFAULT_SHIFTS,
    items: DEFAULT_QUOTA_ITEMS, rules: DEFAULT_RULES,
    cell: (id, d) => m.schedule[id]?.[d - 1] ?? "", offSlots: Array(30).fill(9), name: id => id,
    ...opts,
  };
}
const rules = (issues: ReturnType<typeof validate>, code: string) => issues.filter(i => i.rule === code);

describe("effectiveCode／統計", () => {
  it("空白：平日 S1、週六 H3、週日空", () => {
    const c = ctxOf({ a: [] });
    expect(effectiveCode(c, "a", 2)).toBe("S1");
    expect(effectiveCode(c, "a", 7)).toBe("H3");
    expect(effectiveCode(c, "a", 1)).toBe("");
  });
  it("工時與配額計數（公假算 OFF 項目、週六 OFF 只算週六）", () => {
    const c = ctxOf({ a: ["OFF", "D", "N", "公假", "", "", "OFF"] });
    const st = personStats(c, "a");
    expect(st.counts).toEqual({ D: 1, N: 1, OFF: 3, W6OFF: 1 });
    // D12 + N12 + 公假8 + S1×(平日空白) ... 只驗前 7 天之外全為預設
    expect(st.hours).toBeGreaterThan(24);
  });
  it("每日人力：支援人員的 S1 不算", () => {
    const c = ctxOf({ a: ["", "D"], b: ["", "N"], s: ["", ""] }, {}, { s: { support: true } });
    expect(dayStats(c, 2)).toEqual({ D: 1, N: 1, S1: 0, off: 0 });
  });
});

describe("validate", () => {
  it("R1 連續上班 7 天（OFF 才中斷，公假不中斷）", () => {
    const c = ctxOf({ a: ["OFF", "D", "S1", "公假", "S1", "S1", "H3", "N", "N", "OFF"] });
    const r = rules(validate(c), "R1");
    expect(r.map(i => i.day)).toEqual([8]);
  });
  it("R1 跨月：上月尾巴計入", () => {
    const c = ctxOf({ a: ["S1", "S1", "OFF"] }, { prevTail: { a: ["S1", "S1", "S1", "S1", "S1"] } });
    // 1 號是週日但有排 S1（明確值）→ 上月 5 天＋1、2 號 = 7
    expect(rules(validate(c), "R1").map(i => i.day)).toEqual([2]);
  });
  it("R2 連續值班 6 天", () => {
    const c = ctxOf({ a: ["OFF", "D", "D", "N", "N", "N", "N", "OFF"] });
    expect(rules(validate(c), "R2").map(i => i.day)).toEqual([7]);
  });
  it("R3／R4 勿休、勿值", () => {
    const c = ctxOf({ a: ["OFF", "D"] });
    c.prebook!.cells[cellKey("a", 1)] = { v: "勿休", src: "emp", by: "", at: "" };
    c.prebook!.cells[cellKey("a", 2)] = { v: "勿值", src: "emp", by: "", at: "" };
    const is = validate(c);
    expect(rules(is, "R3").length).toBe(1);
    expect(rules(is, "R4").length).toBe(1);
    expect(rules(is, "R12").length).toBe(0);
  });
  it("R5、R6 旗標", () => {
    const c = ctxOf({ a: ["OFF", "N", "OFF"] }, {}, { a: { noN: true, offHolidayOnly: true } });
    const is = validate(c);
    expect(rules(is, "R5").map(i => i.day)).toEqual([2]);
    expect(rules(is, "R6").map(i => i.day)).toEqual([3]); // 11/3 週二
  });
  it("R8 休假超過可休、R10 週日空白、R11 N 隔天", () => {
    const c = ctxOf({ a: ["OFF", "N", "S1"], b: ["OFF", "N", "N", "OFF"] }, { offSlots: [1, ...Array(29).fill(9)] });
    const is = validate(c);
    expect(rules(is, "R8").map(i => i.day)).toEqual([1]);
    expect(rules(is, "R11").map(i => i.personId)).toEqual(["a"]);
    expect(rules(is, "R10").filter(i => i.day === 8).length).toBe(2);
  });
  it("R9 配額不符、R12 覆蓋預班", () => {
    const c = ctxOf({ a: ["OFF"] }, { targets: { a: { D: 0, N: 0, OFF: 2, W6OFF: 0 } } });
    c.prebook!.cells[cellKey("a", 2)] = { v: "D", src: "sys", by: "", at: "" };
    const is = validate(c);
    expect(rules(is, "R9").map(i => i.message)).toEqual(["a OFF 1／配額 2"]);
    expect(rules(is, "R12").map(i => i.day)).toEqual([2]);
  });
  it("開放預班月份不檢查連續上班／值班與 N 隔天（空白＝尚未排）", () => {
    const c = ctxOf({ a: ["OFF", "N", "S1", "S1", "S1", "S1", "S1", "S1", "S1"] });
    c.month.status = "open";
    const is = validate(c);
    expect(["R1", "R2", "R11"].map(r => rules(is, r).length)).toEqual([0, 0, 0]);
  });
  it("關閉的規則不檢查", () => {
    const c = ctxOf({ a: ["OFF", "N", "S1"] }, { rules: { ...DEFAULT_RULES, disabled: ["R11"] } });
    expect(rules(validate(c), "R11").length).toBe(0);
  });
});
