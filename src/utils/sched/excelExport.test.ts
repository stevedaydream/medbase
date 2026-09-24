import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import * as XLSX from "xlsx";
import { parseMonthSheet, parse84 } from "./excelImport";
import { buildImport } from "./importApply";
import { buildPositionalWorkbook, buildAppWorkbook, letterOf, type ExportCtx } from "./excelExport";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS } from "@/shared/sched/types";
import { emptyHolidays } from "@/shared/sched/calendar";

const XLS = "data/9A值班表(排班用、預班)-9A9B combind.xls";
const hasXls = existsSync(XLS);
const codes = DEFAULT_SHIFTS.map(s => s.code);

describe("letterOf", () => {
  it("B 起算", () => { expect([0, 1, 11].map(letterOf)).toEqual(["B", "C", "M"]); });
});

describe.skipIf(!hasXls)("Excel 完整格式往返（202610）", () => {
  const wb = hasXls ? XLSX.read(readFileSync(XLS)) : null!;
  const orig = hasXls ? parseMonthSheet(wb, "202610", codes) : null!;
  const out = hasXls ? buildImport({
    base: orig, extras: [], p84: parse84(wb), people: [], holidays: emptyHolidays(), holidayDuty: {},
    legacyUsers: [], physicians: [], now: "",
  }) : null!;
  const ctx = (): ExportCtx => ({
    month: out.months[0], prebook: out.prebooks[0], holidays: out.holidays, items: DEFAULT_QUOTA_ITEMS,
    people: out.people, quotas: out.months[0].frozenQuotas!, counts: {}, hours: {},
    offSlots: Array(31).fill(3), offCount: Array(31).fill(0), duty84: out.duty84!, cny: { lastD: {}, log: [] },
  });

  it("匯出後用匯入解析器讀回，與原活頁簿一致", () => {
    const back = parseMonthSheet(XLSX.read(XLSX.write(buildPositionalWorkbook(ctx()), { type: "array", bookType: "xlsx" })), "202610", codes);
    expect(back.roster.map(r => [r.name, r.flags])).toEqual(orig.roster.map(r => [r.name, r.flags]));
    expect(back.prebook).toEqual(orig.prebook);
    // 排班層不存勿休／勿值，其餘相同
    for (const n of Object.keys(orig.schedule)) {
      expect(back.schedule[n]).toEqual(orig.schedule[n].map(v => (v === "勿休" || v === "勿值" ? "" : v)));
    }
    expect(back.holidays).toEqual(orig.holidays);
    expect(back.staffing).toEqual(orig.staffing);
    expect(back.quotas).toEqual(orig.quotas);
    expect(back.markers).toEqual(orig.markers);
  });

  it("app 格式：表頭、字母＋姓名、8-4 明細", () => {
    const w = buildAppWorkbook(ctx());
    expect(w.SheetNames).toEqual(["Schedule_202610", "8-4與春節輪值"]);
    const ws = w.Sheets.Schedule_202610;
    expect(ws.A6.v).toBe("B黃郁芳");
    expect(ws.E2.v).toBe("例假日"); // 10/4 週日
    const rot = XLSX.utils.sheet_to_json<string[]>(w.Sheets["8-4與春節輪值"], { header: 1 });
    expect(rot.length).toBe(5);
    expect(rot[1]).toEqual(["2026-10-04", "一般週日", "8-4", "S", "王子建", "9A", "62875"]);
  });
});
