import { describe, it, expect } from "vitest";
import {
  annualDaysAt, grantPoints, requiredOffDays, leaveLedger, lowBalances, fmtLeave, leaveOf, compAccrueOf,
  DEFAULT_LEAVE_RULES as R, type LeaveInput, type LeaveMonthInput,
} from "./leave";
import { DEFAULT_SHIFTS } from "./types";
import { emptyHolidays, daysIn } from "./calendar";

/** 某月每天的班（day → code），其他天空白 */
const month = (ym: string, codes: Record<number, string>, published = true): LeaveMonthInput =>
  ({ ym, published, code: d => codes[d] ?? "" });

const base = (over: Partial<LeaveInput> = {}): LeaveInput => ({
  hireDate: "2025-03-01", rules: R, open: undefined, shifts: DEFAULT_SHIFTS, holidays: emptyHolidays(),
  months: [], overtime: [], pay: undefined, ...over,
});

/** 整月都排 OFF 的天數（讓「沒休完」為 0） */
const allOff = (ym: string, extra: Record<number, string> = {}) =>
  Object.fromEntries(Array.from({ length: daysIn(ym) }, (_, i) => [i + 1, extra[i + 1] ?? "OFF"]));

describe("特休額度", () => {
  it("年資表（勞基法 §38）", () => {
    expect([5, 6, 12, 24, 36, 60, 119, 120, 132, 400].map(m => annualDaysAt(R, m))).toEqual([0, 3, 7, 10, 14, 15, 15, 16, 17, 30]);
  });
  it("滿半年與每個到職週年給額度", () => {
    expect(grantPoints("2020-03-15", "2021-12-31")).toEqual([{ date: "2020-09-15", months: 6 }, { date: "2021-03-15", months: 12 }]);
    expect(grantPoints("2020-08-31", "2021-03-01")[0].date).toBe("2021-02-28");
    expect(grantPoints("", "2030-01-01")).toEqual([]);
  });
});

describe("應休天數", () => {
  it("週六＋週日＋國定假日，同一天只算一次", () => {
    const h = { ...emptyHolidays(), days: { "2026-10-09": "補假", "2026-10-10": "國慶日", "2026-10-25": "光復" } };
    expect(requiredOffDays("202610", h)).toBe(10);
  });
});

describe("假勤帳", () => {
  it("到職週年給新額度；當期剩餘轉展延，休假先扣展延", () => {
    const l = leaveLedger(base({
      open: { from: "202602", annual: 16, carry: 0, carryUntil: "", comp: 0, swap: 0 },
      months: [month("202602", allOff("202602")), month("202603", allOff("202603", { 10: "特休" }))],
    }));
    expect(l.balance.annualQuota).toBe(56);
    expect(l.balance.carry).toBe(8);
    expect(l.balance.carryUntil).toBe("2027-03-01");
    expect(l.balance.annual).toBe(56);
    expect(l.balance.nextGrant).toBe("2027-03-01");
    expect(l.months["202603"].used.annual).toBe(8);
  });
  it("展延到期作廢並記錄", () => {
    const l = leaveLedger(base({
      hireDate: "",
      open: { from: "202602", annual: 0, carry: 8, carryUntil: "2026-02-15", comp: 0, swap: 0 },
      months: [month("202602", allOff("202602"))],
    }));
    expect(l.balance.carry).toBe(0);
    expect(l.balance.expired).toEqual([{ date: "2026-02-15", hours: 8 }]);
  });
  it("期初的展延到期日晚於週年時兩筆並存，先扣先到期的", () => {
    const l = leaveLedger(base({
      open: { from: "202602", annual: 8, carry: 16, carryUntil: "2026-06-01", comp: 0, swap: 0 },
      months: [month("202603", allOff("202603", { 10: "特休" }))],
    }));
    expect(l.balance.carry).toBe(16);
    expect(l.balance.carryUntil).toBe("2026-06-01");
  });
  it("補假：值班超時＋沒休完（只在發布後計入）", () => {
    const codes: Record<number, string> = { 2: "D", 3: "N" };
    for (const d of [1, 7, 8, 14, 15, 21, 22]) codes[d] = "OFF";    // 2026-02 週末 8 天，只休 7 天
    const l = leaveLedger(base({ hireDate: "", months: [month("202602", codes)] }));
    expect(l.months["202602"].compFromShifts).toBe(8);
    expect(l.months["202602"].requiredOff).toBe(8);
    expect(l.months["202602"].compFromUnrest).toBe(8);
    expect(l.balance.comp).toBe(16);
    const draft = leaveLedger(base({ hireDate: "", months: [month("202602", codes, false)] }));
    expect(draft.balance.comp).toBe(0);
  });
  it("補換假：加班登記；使用補假、補換假扣餘額", () => {
    const l = leaveLedger(base({
      hireDate: "",
      open: { from: "202602", annual: 0, carry: 0, carryUntil: "", comp: 10, swap: 0 },
      months: [month("202602", allOff("202602", { 3: "補假", 4: "補換假" }))],
      overtime: [{ ym: "202602", day: 5, hours: 3 }, { ym: "202601", day: 5, hours: 9 }],
    }));
    expect(l.balance.comp).toBe(2);
    expect(l.balance.swap).toBe(-5);
    expect(l.months["202602"].swapFromOvertime).toBe(3);
  });
  it("值班費：個人設定優先、否則班別預設；國定假日乘倍率", () => {
    const shifts = DEFAULT_SHIFTS.map(s => s.code === "D" ? { ...s, dutyPay: 1000 } : s.code === "N" ? { ...s, dutyPay: 1500 } : s);
    const l = leaveLedger(base({
      hireDate: "", shifts,
      rules: { ...R, holidayPayRate: 2 },
      holidays: { ...emptyHolidays(), days: { "2026-02-03": "測試假日" } },
      months: [month("202602", allOff("202602", { 2: "D", 3: "D", 4: "N" }))],
      pay: { hourly: 300, dutyPay: { N: 2000 } },
    }));
    expect(l.months["202602"].dutyPay).toBe(1000 + 2000 + 2000);
    expect(l.months["202602"].dutyPayDefaults).toEqual(["D"]);
  });
});

describe("提醒與顯示", () => {
  it("該月有排、扣完低於門檻才提醒；特休與展延合併", () => {
    const l = leaveLedger(base({
      hireDate: "",
      open: { from: "202602", annual: 16, carry: 8, carryUntil: "2027-01-01", comp: 80, swap: 0 },
      months: [month("202602", allOff("202602", { 3: "特休", 4: "補假" }))],
    }));
    expect(lowBalances(l, "202602", R)).toEqual([{ kind: "annual", hours: 16 }]);
    expect(lowBalances(l, "202603", R)).toEqual([]);
  });
  it("班別預設：依代號扣假、12 小時上班班別累積 4 小時補假", () => {
    expect(leaveOf({ ...DEFAULT_SHIFTS[0], code: "特休", leave: undefined })).toEqual({ kind: "annual", hours: 8 });
    expect(leaveOf(DEFAULT_SHIFTS.find(s => s.code === "公假"))).toBeNull();
    expect(compAccrueOf(DEFAULT_SHIFTS.find(s => s.code === "D"))).toBe(4);
    expect(compAccrueOf(DEFAULT_SHIFTS.find(s => s.code === "S1"))).toBe(0);
    expect(compAccrueOf({ ...DEFAULT_SHIFTS[0], compAccrue: 2 })).toBe(2);
  });
  it("時數換算", () => {
    expect(fmtLeave(20)).toBe("2 天 4 小時");
    expect(fmtLeave(16)).toBe("2 天");
    expect(fmtLeave(-4)).toBe("−4 小時");
  });
});
