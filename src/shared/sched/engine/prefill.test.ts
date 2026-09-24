import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import * as XLSX from "xlsx";
import { applyPrefill, recomputeFrom, startScheduling, newMonthFrom, monthAssigns, type SchedSnapshot } from "./prefill";
import { parseMonthSheet, parse84 } from "@/utils/sched/excelImport";
import { buildImport } from "@/utils/sched/importApply";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, cellKey, type PrebookDoc } from "../types";
import { emptyHolidays } from "../calendar";

describe("applyPrefill", () => {
  it("清除舊 sys 格、覆蓋員工預約時產生通知、同值不通知", () => {
    const pb: PrebookDoc = {
      ym: "202611", cells: {
        [cellKey("a", 1)]: { v: "OFF", src: "emp", by: "x", at: "t" },
        [cellKey("b", 2)]: { v: "N", src: "emp", by: "x", at: "t" },
        [cellKey("c", 3)]: { v: "8-4", src: "sys", by: "system", at: "t" },
      },
    };
    const r = applyPrefill(pb, [
      { date: "2026-11-01", personId: "a", code: "8-4", source: "84" },
      { date: "2026-11-02", personId: "b", code: "N", source: "weekend" },
    ], "now", "測試");
    expect(Object.keys(r.doc.cells).sort()).toEqual([cellKey("a", 1), cellKey("b", 2)].sort());
    expect(r.doc.cells[cellKey("a", 1)]).toMatchObject({ v: "8-4", src: "sys" });
    expect(r.notices).toEqual([{ personId: "a", ym: "202611", day: 1, oldValue: "OFF", newValue: "8-4", reason: "測試" }]);
  });
});

const XLS = "data/9A值班表(排班用、預班)-9A9B combind.xls";
const hasXls = existsSync(XLS);

describe.skipIf(!hasXls)("由 202610 起點往後重算 202611", () => {
  const wb = hasXls ? XLSX.read(readFileSync(XLS)) : null!;
  const out = hasXls ? buildImport({
    base: parseMonthSheet(wb, "202610", DEFAULT_SHIFTS.map(s => s.code)), extras: [], p84: parse84(wb), people: [],
    holidays: emptyHolidays(), holidayDuty: {}, legacyUsers: [], physicians: [], now: "",
  }) : null!;
  const id = (name: string) => out.people.find(p => p.name === name)!.id;
  const name = (i: string | null | undefined) => out.people.find(p => p.id === i)?.name ?? null;

  function snap(): SchedSnapshot {
    const oct = out.months[0];
    const nov = newMonthFrom(oct, "202611");
    return {
      people: out.people, shifts: DEFAULT_SHIFTS, quotaItems: DEFAULT_QUOTA_ITEMS, holidays: out.holidays,
      holidayDuty: out.holidayDuty, duty84: out.duty84!, cny: { lastD: {}, log: [] },
      months: { "202610": oct, "202611": nov },
      prebooks: {
        "202610": out.prebooks[0],
        "202611": { ym: "202611", cells: { [cellKey(id("鄭惠萍"), 1)]: { v: "OFF", src: "emp", by: "x", at: "t" } } },
      },
    };
  }

  it("8-4 接續 10/26 鄭惠萍：11/1 柳春露（跳過非本單位者不寫入 9A 預班）", () => {
    const r = recomputeFrom(snap(), "202611", "now", "測試");
    const nov84 = r.duty84.log.filter(e => e.date.startsWith("2026-11")).map(e => `${e.date.slice(5)}${name(e.personId)}`);
    expect(nov84[0]).toBe("11-01柳春露");
    expect(nov84.length).toBe(5);
  });

  it("11/1（週日）N 由 10/31 週六 N 林瑋嫻連值；V 由 202610 X 交接", () => {
    const r = recomputeFrom(snap(), "202611", "now", "測試");
    const pb = r.prebooks["202611"];
    expect(pb.cells[cellKey(id("林瑋嫻"), 1)]).toMatchObject({ v: "N", src: "sys" });
    const m = r.months["202611"];
    expect(name(m.markers.D.v)).toBe("張心柔");
    expect(name(m.markers.N.v)).toBe("詹雅慈");
    expect(m.markers.D.x).toBeTruthy();
    // 11/7 週六 N：從林瑋嫻往下（跳過夜班轉出、不排 N）→ 馮佳祺
    const sat7N = Object.entries(pb.cells).find(([k, c]) => k.endsWith("|7") && c.v === "N");
    expect(name(sat7N?.[0].split("|")[0])).toBe("馮佳祺");
  });

  it("開始排班：上月已發布才可；預班帶入排班層並標來源", () => {
    const s = snap();
    const r1 = recomputeFrom(s, "202611", "now", "測試");
    const s2: SchedSnapshot = { ...s, months: r1.months, prebooks: r1.prebooks };
    const res = startScheduling(s2, "202611", "now");
    expect(res.error).toBeUndefined();
    const lin = id("林瑋嫻");
    expect(res.month.status).toBe("scheduling");
    expect(res.month.schedule[lin][0]).toBe("N");
    expect(res.month.origin[lin][0]).toBe("sys");

    const s3: SchedSnapshot = { ...s2, months: { ...s2.months, "202610": { ...s2.months["202610"], status: "scheduling" } } };
    expect(startScheduling(s3, "202611", "now").error).toBe("上個月尚未發布");
    expect(startScheduling(s3, "202611", "now", { force: true }).error).toBeUndefined();
  });
});

describe("預填優先順序", () => {
  it("8-4 與國定假日抽籤撞在同一人同一天：保留 8-4，並提示", () => {
    const m = { ...newMonthFrom(undefined, "202610"), roster: [{ personId: "a", flags: { active: true, support: false, noD: false, noN: false, nightTransfer: false, fixedHolidayOff: false, offHolidayOnly: false } }] };
    const h = emptyHolidays();
    h.days["2026-10-26"] = "補假";
    const s = {
      people: [], shifts: DEFAULT_SHIFTS, quotaItems: DEFAULT_QUOTA_ITEMS, holidays: h,
      holidayDuty: { "2026": { "2026-10-26": { D: "a", N: null } } },
      duty84: { log: [], removedDates: [], addedDates: [] }, cny: { lastD: {}, log: [] }, months: {}, prebooks: {},
    } as unknown as SchedSnapshot;
    const r = monthAssigns(s, m, undefined, s.cny, [{ date: "2026-10-26", personId: "a", kind: "連假末日", manual: false, note: "" }]);
    expect(r.assigns.filter(a => a.date === "2026-10-26").map(a => a.code)).toEqual(["8-4"]);
    expect(r.warnings.some(w => w.includes("只保留 8-4"))).toBe(true);
  });
});
