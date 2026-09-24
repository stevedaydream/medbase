import { describe, it, expect } from "vitest";
import { nextInOrder, weekendAssigns, duty84Dates, recompute84, recomputeCny, holidayAssigns } from "./rotation";
import { emptyFlags, type Person, type RosterEntry } from "../types";
import { emptyHolidays } from "../calendar";

const R = (id: string, f: Partial<ReturnType<typeof emptyFlags>> = {}): RosterEntry => ({ personId: id, flags: { ...emptyFlags(), ...f } });
const P = (id: string, order: number, p: Partial<Person> = {}): Person => ({
  id, name: id, unit: "9A", ext: "", his: "", role: "employee", code84: "", order,
  exempt84: false, exemptCny: false, active: true, ...p,
});
const none = () => new Set<string>();
const fmt = (a: { date: string; personId: string; code: string }[]) => a.map(x => `${x.date.slice(5)}${x.code}${x.personId}`);

describe("nextInOrder", () => {
  it("環狀找下一位符合者", () => {
    expect(nextInOrder(["a", "b", "c"], "b", () => true)).toBe("c");
    expect(nextInOrder(["a", "b", "c"], "c", () => true)).toBe("a");
    expect(nextInOrder(["a", "b", "c"], "a", id => id !== "b")).toBe("c");
    expect(nextInOrder(["a", "b", "c"], null, () => true)).toBe("a");
  });
});

describe("weekendAssigns（2026-11，1 號是週日）", () => {
  const roster = ["a", "b", "c", "d", "e"].map(id => R(id));
  it("週末 N 連值、三指標各自往下；1 號週日接上月週六 N", () => {
    const r = weekendAssigns({
      ym: "202611", roster, holidays: emptyHolidays(), holidayDuty: {},
      start: { wkN: "a", satD: "c", sunD: "a" }, carrySunN: "a", busy: none,
    });
    expect(fmt(r.assigns)).toEqual([
      "11-01Na", "11-01Db",
      "11-07Nb", "11-08Nb", "11-07Dd", "11-08Dc",
      "11-14Nc", "11-15Nc", "11-14De", "11-15Dd",
      "11-21Nd", "11-22Nd", "11-21Da", "11-22De",
      "11-28Ne", "11-29Ne", "11-28Db", "11-29Da",
    ]);
    expect(r.end).toEqual({ wkN: "e", satD: "b", sunD: "a" });
  });

  it("同日 D/N 撞人時 D 順延", () => {
    const r = weekendAssigns({
      ym: "202611", roster, holidays: emptyHolidays(), holidayDuty: {},
      start: { wkN: "a", satD: "a", sunD: "a" }, carrySunN: null, busy: none,
    });
    // 11/7：N=b，週六 D 本應 b → 順延為 c
    expect(fmt(r.assigns).filter(x => x.startsWith("11-07"))).toEqual(["11-07Nb", "11-07Dc"]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("不排 N、夜班轉出不進週末 N；不排 D 不進週末 D", () => {
    const ro = [R("a", { noN: true }), R("b", { nightTransfer: true }), R("c", { noD: true }), R("d"), R("e")];
    const r = weekendAssigns({
      ym: "202611", roster: ro, holidays: emptyHolidays(), holidayDuty: {},
      start: { wkN: null, satD: null, sunD: null }, carrySunN: null, busy: none,
    });
    const n = r.assigns.filter(a => a.code === "N").map(a => a.personId);
    const d = r.assigns.filter(a => a.code === "D").map(a => a.personId);
    expect(n.every(x => ["c", "d", "e"].includes(x))).toBe(true);
    expect(d.includes("c")).toBe(false);
  });

  it("週日國定假日：該週末 N 不輪（週六 N＝週日抽籤 N），週日 D 不輪，指標不動", () => {
    const h = emptyHolidays();
    h.days["2026-11-08"] = "測試假日";
    const duty = { "2026": { "2026-11-08": { D: "e", N: "d" } } };
    const r = weekendAssigns({
      ym: "202611", roster, holidays: h, holidayDuty: duty,
      start: { wkN: "a", satD: "c", sunD: "a" }, carrySunN: null, busy: none,
    });
    const wk = fmt(r.assigns).filter(x => x.startsWith("11-07") || x.startsWith("11-08"));
    expect(wk).toEqual(["11-07Nd", "11-07De"]); // 週六 D 從 c 往下輪到 d，d 當天上 N，順延為 e
    const next = fmt(r.assigns).filter(x => x.startsWith("11-14"));
    expect(next[0]).toBe("11-14Nb"); // 週末 N 指標未因 11/7–8 前進
  });

  it("連值的 N 當天有 8-4：跳過他，改由週末 N 輪序下一位", () => {
    const r = weekendAssigns({
      ym: "202611", roster, holidays: emptyHolidays(), holidayDuty: {},
      start: { wkN: "a", satD: "c", sunD: "a" }, carrySunN: "a",
      busy: d => (d === "2026-11-01" ? new Set(["a"]) : new Set()),
    });
    expect(fmt(r.assigns).filter(x => x.startsWith("11-01"))).toEqual(["11-01Nb", "11-01Dc"]);
    expect(r.warnings.some(w => w.includes("上月週六 N"))).toBe(true);
    // b 的這一輪已用掉，下一個週末 N 輪到 c
    expect(fmt(r.assigns).filter(x => x.startsWith("11-07N"))).toEqual(["11-07Nc"]);
  });

  it("國定假日抽籤結果", () => {
    const h = emptyHolidays();
    h.days["2026-10-10"] = "國慶";
    expect(fmt(holidayAssigns("202610", h, { "2026": { "2026-10-10": { D: "a", N: "b" } } }))).toEqual(["10-10Da", "10-10Nb"]);
  });
});

describe("8-4", () => {
  const h = emptyHolidays();
  for (const d of ["2026-10-09", "2026-10-10", "2026-10-25", "2026-10-26"]) h.days[d] = "國";
  const doc = { log: [], removedDates: [], addedDates: [] };

  it("日期：每段連續休息日的最後一天（對照 Excel 202610）", () => {
    expect(duty84Dates("2026-10-01", "2026-10-31", h, doc)).toEqual([
      { date: "2026-10-04", kind: "一般週日" },
      { date: "2026-10-11", kind: "連假末日" },
      { date: "2026-10-18", kind: "一般週日" },
      { date: "2026-10-26", kind: "連假末日" },
    ]);
  });

  it("人選：接續上一位、跳過免輪；手動指定保留", () => {
    const people = [P("A", 0), P("R", 1), P("S", 2), P("T", 3), P("V", 4, { exempt84: true }), P("X", 5)];
    const base = { log: [{ date: "2026-09-27", personId: "R", kind: "一般週日", manual: false, note: "" }], removedDates: [], addedDates: [] };
    const log = recompute84(base, people, h, "2026-10-01", "2026-10-31");
    expect(log.map(e => `${e.date.slice(5)}${e.personId}`)).toEqual(["09-27R", "10-04S", "10-11T", "10-18X", "10-26A"]);
    const withManual = { ...base, log: [...base.log, { date: "2026-10-11", personId: "A", kind: "連假末日", manual: true, note: "" }] };
    const log2 = recompute84(withManual, people, h, "2026-10-01", "2026-10-31");
    expect(log2.map(e => `${e.date.slice(5)}${e.personId}`)).toEqual(["09-27R", "10-04S", "10-11A", "10-18R", "10-26S"]);
  });

  it("手動刪除與新增日期", () => {
    const d = duty84Dates("2026-10-01", "2026-10-31", h, { log: [], removedDates: ["2026-10-04"], addedDates: ["2026-10-20"] });
    expect(d.map(x => x.date)).toEqual(["2026-10-11", "2026-10-18", "2026-10-20", "2026-10-26"]);
  });
});

describe("春節階梯", () => {
  it("D 往下一位、N＝前一天 D；第一天 N＝去年最後 D", () => {
    const h = emptyHolidays();
    h.cny.push({ from: "2027-02-05", to: "2027-02-07" });
    const people = ["p1", "p2", "p3", "p4", "p5"].map((id, i) => P(id, i));
    people[3].exemptCny = true;
    const r = recomputeCny({ lastD: { "2026": "p2" }, log: [] }, people, h);
    expect(r.log).toEqual([
      { date: "2027-02-05", D: "p3", N: "p2" },
      { date: "2027-02-06", D: "p5", N: "p3" },
      { date: "2027-02-07", D: "p1", N: "p5" },
    ]);
    expect(r.lastD["2027"]).toBe("p1");
  });
});
