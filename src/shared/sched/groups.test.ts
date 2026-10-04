import { describe, it, expect } from "vitest";
import { groupKey, splitKey, scheduleSheetName, personGroup, groupList, stripSharedRota, DEFAULT_GROUP } from "./groups";
import { opFirstMonth, emptyPatch, monthWindow, type OpsState } from "./ops";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, OPEN_MONTHS, type Person } from "./types";
import { emptyHolidays } from "./calendar";

describe("排班群組 key（ADR-025）", () => {
  it("預設群組沿用舊 key，其他群組加前綴，共用文件不加", () => {
    expect(groupKey(DEFAULT_GROUP, "month:202611")).toBe("month:202611");
    expect(groupKey("8A", "month:202611")).toBe("8A/month:202611");
    expect(groupKey("8A", "shifts")).toBe("8A/shifts");
    for (const k of ["people", "groups", "holidays", "duty84", "cny", "notices"]) expect(groupKey("8A", k)).toBe(k);
  });
  it("splitKey 與 groupKey 互逆", () => {
    for (const [g, b] of [["8A", "prebook:202612"], [DEFAULT_GROUP, "log:global"], ["8A", "debts"]]) {
      expect(splitKey(groupKey(g, b))).toEqual({ group: g, base: b });
    }
    expect(splitKey("holidays")).toEqual({ group: null, base: "holidays" });
  });
  it("班表分頁名稱", () => {
    expect(scheduleSheetName(DEFAULT_GROUP, "202611")).toBe("Schedule_202611");
    expect(scheduleSheetName("8A", "202611")).toBe("Schedule_8A_202611");
  });
  it("人員群組：舊資料依單位推定；有欄位以欄位為準", () => {
    expect(personGroup({ unit: "9A" })).toBe(DEFAULT_GROUP);
    expect(personGroup({ unit: "8A" })).toBe("");
    expect(personGroup({ unit: "9B", group: "" })).toBe("");
    expect(personGroup({ unit: "9B", group: "8A" })).toBe("8A");
  });
  it("群組清單一定有預設群組並依順序", () => {
    expect(groupList(undefined).map(g => g.id)).toEqual([DEFAULT_GROUP]);
    expect(groupList([{ id: "8A", name: "8A", order: 2 }]).map(g => g.id)).toEqual([DEFAULT_GROUP, "8A"]);
  });
  it("非 super 不寫 8-4／春節", () => {
    const p = { ...emptyPatch(), duty84: { log: [], removedDates: [], addedDates: [] } };
    const r = stripSharedRota(p);
    expect(r.changed).toBe(true);
    expect(r.patch.duty84).toBeUndefined();
    expect(stripSharedRota(emptyPatch()).changed).toBe(false);
  });
});

describe("opFirstMonth：新群組建立第一個月份", () => {
  const P = (id: string, order: number): Person => ({
    id, name: id.toUpperCase(), unit: "8A", group: "8A", ext: "", his: id, role: "employee", code84: "", order,
    exempt84: false, exemptCny: false, active: true,
  });
  const s = (): OpsState => ({
    people: ["a", "b", "c", "d"].map(P), shifts: DEFAULT_SHIFTS, quotaItems: DEFAULT_QUOTA_ITEMS, rules: DEFAULT_RULES, debts: [],
    holidays: emptyHolidays(), holidayDuty: {}, duty84: { log: [], removedDates: [], addedDates: [] }, cny: { lastD: {}, log: [] },
    months: {}, prebooks: {},
  });
  const today = new Date(2026, 9, 5);

  it("建立下個月起的開放範圍，第一個月名單為指定人員並預填", () => {
    const p = opFirstMonth(s(), ["a", "b", "c"], today, "超級", "2026-10-05T00:00:00.000Z");
    const yms = p.months.map(m => m.ym).sort();
    const { near } = monthWindow(today);
    expect(yms[0]).toBe(near[0]);
    expect(yms.length).toBe(OPEN_MONTHS);
    const first = p.months.find(m => m.ym === near[0])!;
    expect(first.roster.map(r => r.personId)).toEqual(["a", "b", "c"]);
    expect(first.prefilled).toBe(true);
    expect(p.ests.some(e => e.ym === near[0])).toBe(true);
    expect(p.logs[0]).toMatchObject({ scope: near[0], action: "建立第一個月份" });
  });
  it("已有月份時不做事", () => {
    const st = s();
    st.months = opFirstMonth(s(), ["a"], today, "x", "t").months.reduce((o, m) => ({ ...o, [m.ym]: m }), {});
    expect(opFirstMonth(st, ["a"], today, "x", "t").months).toEqual([]);
  });
});
