import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import * as XLSX from "xlsx";
import { parseMonthSheet, parse84, inferV, splitName, normalizeCode } from "./excelImport";
import { DEFAULT_SHIFTS } from "@/shared/sched/types";

// 醫院原始檔含個資，不進版控（data/ 已 gitignore）；沒有檔案時跳過整合測試
const XLS = "data/9A值班表(排班用、預班)-9A9B combind.xls";
const hasXls = existsSync(XLS);
const codes = DEFAULT_SHIFTS.map(s => s.code);

describe("helpers", () => {
  it("splitName", () => {
    expect(splitName("B黃郁芳")).toEqual({ letter: "B", name: "黃郁芳" });
    expect(splitName("王小明")).toEqual({ letter: "", name: "王小明" });
  });
  it("normalizeCode", () => {
    expect(normalizeCode("off", codes)).toBe("OFF");
    expect(normalizeCode("上課", codes)).toBe("公假");
    expect(normalizeCode("勿休", codes)).toBe("勿休");
    expect(normalizeCode(" ", codes)).toBe("");
  });
  it("inferV: 多拿者成環狀連續段，V 為段首", () => {
    const el = ["a", "b", "c", "d"];
    expect(inferV(el, { a: 3, b: 2, c: 2, d: 3 }, "a")).toBe("d");
    expect(inferV(el, { a: 2, b: 3, c: 3, d: 2 }, "c")).toBe("b");
    expect(inferV(el, { a: 2, b: 2, c: 2, d: 2 }, "b")).toBe("c");
  });
});

describe.skipIf(!hasXls)("醫院 Excel 202610 匯入", () => {
  const wb = hasXls ? XLSX.read(readFileSync(XLS)) : null!;

  it("人員、旗標、人力", () => {
    const p = parseMonthSheet(wb, "202610", codes);
    expect(p.ym).toBe("202610");
    expect(p.roster.map(r => r.letter).join("")).toBe("BCDEFGHILJKM");
    const by = Object.fromEntries(p.roster.map(r => [r.letter, r.flags]));
    expect(by.F.active).toBe(false);
    expect(by.L.active).toBe(false);
    expect(by.C.nightTransfer).toBe(true);
    expect(by.M.noD && by.M.noN && by.M.fixedHolidayOff).toBe(true);
    expect(p.staffing.base.weekday).toEqual({ D: 1, N: 1, S1: 4 });
    expect(p.staffing.base.sunday).toEqual({ D: 1, N: 1, S1: 0 });
    expect(p.holidays).toEqual(["2026-10-09", "2026-10-10", "2026-10-25", "2026-10-26"]);
  });

  it("排班區與預班區", () => {
    const p = parseMonthSheet(wb, "202610", codes);
    const name = p.roster.find(r => r.letter === "B")!.name;
    expect(p.schedule[name].slice(0, 4)).toEqual(["勿休", "N", "N", "N"]);
    expect(p.prebook[name].slice(0, 4)).toEqual(["勿休", "N", "N", "N"]);
    const d = p.roster.find(r => r.letter === "D")!.name;
    expect(p.prebook[d][3]).toBe("8-4");
  });

  it("V／X 標記（W6OFF 的 V 被 X 覆蓋，由數值反推）", () => {
    const p = parseMonthSheet(wb, "202610", codes);
    const L = (n: string | null) => p.roster.find(r => r.name === n)?.letter;
    expect(L(p.markers.D.v)).toBe("I");
    expect(L(p.markers.D.x)).toBe("E");
    expect(L(p.markers.N.v)).toBe("K");
    expect(L(p.markers.N.x)).toBe("D");
    expect(L(p.markers.OFF.v)).toBe("C");
    expect(L(p.markers.OFF.x)).toBe("J");
    expect(L(p.markers.W6OFF.v)).toBe("M");
    expect(L(p.markers.W6OFF.x)).toBe("M");
  });

  it("8-4 輪值表", () => {
    const r = parse84(wb)!;
    expect(r.people.length).toBe(18);
    expect(r.people.filter(p => p.exempt).map(p => p.code)).toEqual(["V", "W"]);
    expect(r.log.map(l => l.date)).toEqual(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-26"]);
    expect(r.log[0].code).toBe("S");
    expect(r.log[1].code).toBe("");
  });
});
