import { describe, it, expect } from "vitest";
import { planHolidayImport, applyHolidayImport, earliestDate, type TwCalDay } from "./holidayImport";
import { emptyHolidays } from "./calendar";

const D = (date: string, week: string, isHoliday: boolean, description = ""): TwCalDay => ({ date, week, isHoliday, description });

// 2027 年部分資料（實際格式）
const DATA: TwCalDay[] = [
  D("20270101", "五", true, "開國紀念日"),
  D("20270102", "六", true), D("20270103", "日", true),
  D("20270104", "一", false),
  D("20270203", "三", false),
  D("20270204", "四", true, "小年夜"), D("20270205", "五", true, "農曆除夕"),
  D("20270206", "六", true, "春節"), D("20270207", "日", true, "春節"), D("20270208", "一", true, "春節"),
  D("20270209", "二", true, "補假"), D("20270210", "三", true, "補假"),
  D("20270211", "四", false),
  D("20270227", "六", true, "休息日"), D("20270228", "日", true, "和平紀念日"),
  D("20270306", "六", false, "補行上班"),
];

describe("國定假日匯入", () => {
  it("節日（含週末與補假）、補班日、春節連假；一般週末不算", () => {
    const p = planHolidayImport(emptyHolidays(), "2027", DATA);
    expect(p.days.map(d => d.date)).toEqual([
      "2027-01-01", "2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-28",
    ]);
    expect(p.days[0].name).toBe("開國紀念日");
    expect(p.workdays).toEqual(["2027-03-06"]);
    expect(p.cny).toEqual({ from: "2027-02-04", to: "2027-02-10" });
    expect(p.existing).toBe(0);
  });

  it("已有的日期與名稱、該年已有春節區間時不動", () => {
    const h = { ...emptyHolidays(), days: { "2027-01-01": "元旦（自訂）" }, cny: [{ from: "2027-02-05", to: "2027-02-09" }] };
    const p = planHolidayImport(h, "2027", DATA);
    expect(p.existing).toBe(1);
    expect(p.days.some(d => d.date === "2027-01-01")).toBe(false);
    expect(p.cny).toBeNull();
    const out = applyHolidayImport(h, p, null);
    expect(out.days["2027-01-01"]).toBe("元旦（自訂）");
    expect(out.cny).toEqual([{ from: "2027-02-05", to: "2027-02-09" }]);
  });

  it("套用：可調整或不加春節區間；最早影響日期", () => {
    const h = emptyHolidays();
    const p = planHolidayImport(h, "2027", DATA);
    const out = applyHolidayImport(h, p, { from: "2027-02-05", to: "2027-02-10" });
    expect(Object.keys(out.days).length).toBe(9);
    expect(out.cny).toEqual([{ from: "2027-02-05", to: "2027-02-10" }]);
    expect(applyHolidayImport(h, p, null).cny).toEqual([]);
    expect(earliestDate(p, null)).toBe("2027-01-01");
    expect(earliestDate({ ...p, days: [], workdays: [] }, { from: "2027-02-05" })).toBe("2027-02-05");
  });
});
