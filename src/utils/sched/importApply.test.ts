import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import * as XLSX from "xlsx";
import { parseMonthSheet, parse84 } from "./excelImport";
import { buildImport } from "./importApply";
import { DEFAULT_SHIFTS, cellKey } from "./types";
import { emptyHolidays } from "./calendar";

const XLS = "data/9A值班表(排班用、預班)-9A9B combind.xls";
const hasXls = existsSync(XLS);
const codes = DEFAULT_SHIFTS.map(s => s.code);

describe.skipIf(!hasXls)("buildImport 202610", () => {
  const wb = hasXls ? XLSX.read(readFileSync(XLS)) : null!;
  const run = () => buildImport({
    base: parseMonthSheet(wb, "202610", codes),
    extras: [],
    p84: parse84(wb),
    people: [],
    holidays: emptyHolidays(),
    holidayDuty: {},
    legacyUsers: [{ name: "黃郁芳", employee_id: "12345", role: "admin", is_active: 1 }, { name: "某某", employee_id: "999", role: "employee", is_active: 1 }],
    physicians: [{ name: "王子建", his_account: "55555" }],
    now: "2026-09-24T00:00:00.000Z",
  });

  it("人員主檔：8-4 名單＋9A 名單合併，舊帳號帶入 HIS 與角色", () => {
    const out = run();
    const by = Object.fromEntries(out.people.map(p => [p.name, p]));
    expect(out.people.length).toBe(20); // 18 位 8-4 名單＋陳咨希、柳春霙（8-4 名單寫柳春露）
    expect(out.report.warnings[0]).toContain("陳咨希、柳春霙");
    expect(by["柳春霙"].exempt84 && by["柳春霙"].exemptCny).toBe(true);
    expect(by["黃郁芳"]).toMatchObject({ unit: "9A", code84: "M", his: "12345", role: "scheduler" });
    expect(by["王子建"].his).toBe("55555");
    expect(by["丁韋綸"].exempt84).toBe(true);
    expect(by["陳咨希"].unit).toBe("9A");
    expect(by["鄭惠萍"].unit).toBe("");
    expect(out.report.unmatchedLegacy).toEqual(["某某（999，employee）"]);
  });

  it("起點月份：已發布、V/X、定案配額、週末位置", () => {
    const out = run();
    const m = out.months[0];
    const nameOf = (id: string | null) => out.people.find(p => p.id === id)?.name;
    expect(m.status).toBe("published");
    expect(m.roster.length).toBe(12);
    expect(nameOf(m.markers.N.x)).toBe("王子建");
    const c = out.people.find(p => p.name === "詹絲庭")!.id;
    expect(m.frozenQuotas![c]).toEqual({ D: 8, N: 0, OFF: 14, W6OFF: 2 });
    // 10/31 週六 D=黃郁芳、N=林瑋嫻；10/25 週日是國定假日，週日 D 取 10/18 詹雅慈
    expect(nameOf(m.weekend.end!.satD)).toBe("黃郁芳");
    expect(nameOf(m.weekend.end!.wkN)).toBe("林瑋嫻");
    expect(nameOf(m.weekend.end!.sunD)).toBe("詹雅慈");
    // 勿休不寫入排班層
    const b = out.people.find(p => p.name === "黃郁芳")!.id;
    expect(m.schedule[b][0]).toBe("");
    expect(m.origin[b][1]).toBe("pre");
  });

  it("預班、國定假日抽籤、8-4 明細", () => {
    const out = run();
    const pb = out.prebooks[0];
    const b = out.people.find(p => p.name === "黃郁芳")!.id;
    expect(pb.cells[cellKey(b, 1)].v).toBe("勿休");
    const d = out.people.find(p => p.name === "王子建")!.id;
    expect(pb.cells[cellKey(d, 4)]).toMatchObject({ v: "8-4", src: "sys" });
    expect(Object.keys(out.holidays.days).length).toBe(4);
    const nameOf = (id?: string | null) => out.people.find(p => p.id === id)?.name;
    expect(nameOf(out.holidayDuty["2026"]["2026-10-09"].D)).toBe("黃郁芳");
    expect(nameOf(out.holidayDuty["2026"]["2026-10-09"].N)).toBe("張心柔");
    expect(out.duty84!.log.map(l => nameOf(l.personId) ?? null)).toEqual(["王子建", "張琬婷", "張心柔", "鄭惠萍"]);
  });
});
