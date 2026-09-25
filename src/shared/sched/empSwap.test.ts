import { describe, it, expect } from "vitest";
import { planEmpSwap, opRequestSwap, opAcceptSwap, opCloseSwap, stateOf, docsOfPatch, type SwapReqDoc } from "./empSwap";
import { applyToState, opRecompute, opDeleteSwap, type OpsState } from "./ops";
import { newMonthFrom } from "./engine/prefill";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, emptyFlags, emptyMonth, type Person } from "./types";
import { emptyHolidays, dowOf } from "./calendar";

const P = (id: string, order: number): Person => ({
  id, name: id.toUpperCase(), unit: "9A", ext: "", his: id, role: id === "e" ? "scheduler" : "employee", code84: "", order,
  exempt84: false, exemptCny: false, active: true,
});

/** 202611 已發布：平日 S1、週末 OFF；a 11/10 N、11/11 OFF；b 11/10 D、11/11 D */
function base(): OpsState {
  const people = ["a", "b", "c", "d", "e"].map(P);
  const nov = { ...emptyMonth("202611"), status: "published" as const, publishedAt: "2026-10-20T00:00:00Z", imported: true };
  nov.roster = people.map(p => ({ personId: p.id, flags: emptyFlags() }));
  for (const it of DEFAULT_QUOTA_ITEMS) nov.markers[it.id] = { v: "a", x: "b" };
  for (const p of people) nov.schedule[p.id] = Array.from({ length: 30 }, (_, i) => [0, 6].includes(dowOf("202611", i + 1)) ? "OFF" : "S1");
  nov.schedule.a[9] = "N"; nov.schedule.a[10] = "OFF";
  nov.schedule.b[9] = "D"; nov.schedule.b[10] = "D";
  return {
    people, shifts: DEFAULT_SHIFTS, quotaItems: DEFAULT_QUOTA_ITEMS, rules: DEFAULT_RULES, debts: [],
    holidays: emptyHolidays(), holidayDuty: {}, duty84: { log: [], removedDates: [], addedDates: [] }, cny: { lastD: {}, log: [] },
    months: { "202611": nov }, prebooks: {},
  };
}
const NOW = "2026-11-01T00:00:00.000Z";
const TODAY = "20261101";
const empty = (): SwapReqDoc => ({ ym: "202611", items: [] });

describe("員工換班：已發布月份", () => {
  it("同日互換一段：每天一筆換班、綁同一張申請，立即結算欠班", () => {
    const s = base();
    const p = planEmpSwap(s, { ym: "202611", kind: "same", a: "b", b: "c", give: [10, 11], take: [], note: "" }, "r1", "B", NOW, TODAY);
    expect(p.hard).toEqual([]);
    const m = p.patch.months[0];
    expect([m.schedule.b[9], m.schedule.c[9], m.schedule.b[10], m.schedule.c[10]]).toEqual(["S1", "D", "S1", "D"]);
    expect(m.swaps!.map(x => [x.day, x.req, x.settled])).toEqual([[10, "r1", true], [11, "r1", true]]);
    expect(p.patch.debts!.map(d => [d.from, d.to, d.item, d.qty])).toEqual([["b", "c", "D", 2]]);
  });

  it("硬性規則：換完 N 隔天接白班 → 擋下", () => {
    const s = base();
    // b 接 a 的 11/10 N，b 11/11 還是 D
    const p = planEmpSwap(s, { ym: "202611", kind: "cover", a: "a", b: "b", give: [10], take: [], note: "" }, "r", "A", NOW, TODAY);
    expect(p.hard.join()).toContain("N 隔天只能 N 或 OFF");
  });

  it("硬性規則：連續上班超過上限 → 擋下；軟性（不排 N）只警告", () => {
    const s = base();
    s.months["202611"].roster.find(r => r.personId === "c")!.flags.noN = true;
    // 11/7–8 週末 OFF 換成 S1：c 11/2–11/13 連上
    s.months["202611"].schedule.d[6] = "S1"; s.months["202611"].schedule.d[7] = "S1";
    const p = planEmpSwap(s, { ym: "202611", kind: "same", a: "c", b: "d", give: [7, 8], take: [], note: "" }, "r", "C", NOW, TODAY);
    expect(p.hard.join()).toContain("連續上班超過上限");
    s.months["202611"].schedule.a[11] = "OFF";
    const q = planEmpSwap(s, { ym: "202611", kind: "cover", a: "a", b: "c", give: [10, 11], take: [], note: "" }, "r", "A", NOW, TODAY);
    expect(q.hard).toEqual([]);
    expect(q.soft.join()).toContain("違反不排 D／不排 N");
  });

  it("過去的日子、排班中的月份、兩人同班都不能換", () => {
    const s = base();
    expect(() => planEmpSwap(s, { ym: "202611", kind: "same", a: "b", b: "c", give: [10], take: [], note: "" }, "r", "B", NOW, "20261111")).toThrow("已經過去");
    expect(() => planEmpSwap(s, { ym: "202611", kind: "same", a: "c", b: "d", give: [3], take: [], note: "" }, "r", "C", NOW, TODAY)).toThrow("兩人的班一樣");
    s.months["202611"].status = "scheduling";
    expect(() => planEmpSwap(s, { ym: "202611", kind: "same", a: "b", b: "c", give: [10], take: [], note: "" }, "r", "B", NOW, TODAY)).toThrow("正在排班");
  });

  it("申請只記錄、不改班表，通知對方；有硬性違規不建立申請", () => {
    const s = base();
    const r = opRequestSwap(s, empty(), { ym: "202611", kind: "same", a: "b", b: "c", give: [10], take: [], note: "家裡有事" }, "B", NOW, TODAY);
    expect(r.req).toMatchObject({ status: "pending", days: [{ day: 10, aCode: "D", bCode: "S1" }], take: [10] });
    expect(r.notices.map(n => n.personId)).toEqual(["c"]);
    expect(s.months["202611"].schedule.b[9]).toBe("D");
    const bad = opRequestSwap(s, empty(), { ym: "202611", kind: "cover", a: "a", b: "b", give: [10], take: [], note: "" }, "A", NOW, TODAY);
    expect(bad.plan.hard.length).toBeGreaterThan(0);
    expect(bad.reqs.items).toEqual([]);
  });

  it("跨日換班：兩天都是同日對調，同意後生效", () => {
    let s = base();
    s.months["202611"].schedule.c[11] = "D";
    const r = opRequestSwap(s, empty(), { ym: "202611", kind: "cross", a: "b", b: "c", give: [10], take: [12], note: "" }, "B", NOW, TODAY);
    expect(r.plan.hard).toEqual([]);
    const acc = opAcceptSwap(s, r.reqs, r.req.id, "c", "C", NOW, TODAY);
    expect(acc.error).toBeUndefined();
    expect(acc.reqs.items[0].status).toBe("done");
    expect(acc.patch.notices.map(n => n.personId).sort()).toEqual(["b", "c", "e"]);
    s = applyToState(s, acc.patch);
    const m = s.months["202611"];
    expect([m.schedule.b[9], m.schedule.c[9], m.schedule.b[11], m.schedule.c[11]]).toEqual(["S1", "D", "D", "S1"]);
    // D 一換一，不產生欠班
    expect(s.debts.filter(d => !d.settledAt)).toEqual([]);
    const del = opDeleteSwap(s, "202611", m.swaps![0].id, "排班者");
    expect(del.months[0].swaps).toEqual([]);
    expect([del.months[0].schedule.b[9], del.months[0].schedule.b[11]]).toEqual(["D", "S1"]);
  });

  it("代班刪除：欠班反向抵銷", () => {
    let s = base();
    const p = planEmpSwap(s, { ym: "202611", kind: "cover", a: "b", b: "c", give: [10, 11], take: [], note: "" }, "r1", "B", NOW, TODAY);
    s = applyToState(s, p.patch);
    expect(s.debts.filter(d => !d.settledAt).map(d => d.qty)).toEqual([2]);
    s = applyToState(s, opDeleteSwap(s, "202611", s.months["202611"].swaps![0].id, "x"));
    expect(s.debts.filter(d => !d.settledAt && d.qty > 0)).toEqual([]);
  });

  it("申請後班表變動 → 同意時失效並通知申請人；拒絕與撤回", () => {
    const s = base();
    const r = opRequestSwap(s, empty(), { ym: "202611", kind: "same", a: "b", b: "c", give: [10], take: [], note: "" }, "B", NOW, TODAY);
    s.months["202611"].schedule.c[9] = "OFF";
    const acc = opAcceptSwap(s, r.reqs, r.req.id, "c", "C", NOW, TODAY);
    expect(acc.error).toContain("班表已變動");
    expect(acc.reqs.items[0].status).toBe("failed");
    expect(acc.patch.months).toEqual([]);
    expect(() => opAcceptSwap(s, r.reqs, r.req.id, "b", "B", NOW, TODAY)).toThrow("找不到");
    const rej = opCloseSwap(s, r.reqs, r.req.id, "c", "rejected", NOW);
    expect(rej.reqs.items[0].status).toBe("rejected");
    expect(rej.notices[0].personId).toBe("b");
    expect(() => opCloseSwap(s, r.reqs, r.req.id, "c", "cancelled", NOW)).toThrow();
    expect(opCloseSwap(s, r.reqs, r.req.id, "b", "cancelled", NOW).notices[0].personId).toBe("c");
  });
});

describe("員工換班：開放預班（系統預填）", () => {
  function openState(): OpsState {
    const s = base();
    s.months["202611"].status = "published";
    s.months["202612"] = newMonthFrom(s.months["202611"], "202612");
    s.months["202611"].weekend.end = { wkN: "a", satD: "b", sunD: "c" };
    s.prebooks["202612"] = { ym: "202612", cells: {} };
    return applyToState(s, opRecompute(s, "202612", "x", NOW));
  }
  const sysN = (s: OpsState, d: number) => Object.entries(s.prebooks["202612"].cells).find(([k, c]) => k.endsWith(`|${d}`) && c.v === "N" && c.src === "sys")?.[0].split("|")[0];

  it("代班：預填改由對方上（週末 N 兩天一起），非系統預填不能換", () => {
    const s = openState();
    const from = sysN(s, 5)!;
    const to = ["a", "b", "c", "d"].find(x => x !== from && x !== sysN(s, 6))!;
    const p = planEmpSwap(s, { ym: "202612", kind: "cover", a: from, b: to, give: [5], take: [], note: "" }, "r", "X", NOW, TODAY);
    expect(p.hard).toEqual([]);
    expect(p.give.length).toBeGreaterThanOrEqual(1);
    const after = applyToState(s, p.patch);
    expect(sysN(after, 5)).toBe(to);
    expect(() => planEmpSwap(s, { ym: "202612", kind: "cover", a: from, b: to, give: [2], take: [], note: "" }, "r", "X", NOW, TODAY)).toThrow("沒有系統預填");
  });
});

describe("伺服器文件轉換", () => {
  it("stateOf／docsOfPatch：log 與通知附加在既有內容後", () => {
    const docs = { people: [P("a", 0)], notices: [{ id: "n0" }], "log:202611": { key: "202611", entries: [{ at: "t", actor: "x", action: "y", detail: "z" }] } };
    expect(stateOf(docs).people[0].id).toBe("a");
    const out = docsOfPatch(docs, { months: [], prebooks: [], ests: [], warnings: [], notices: [{ id: "n1", personId: "a", at: NOW, text: "t", read: false, sent: false }], logs: [{ scope: "202611", action: "員工換班", detail: "d", actor: "A" }] }, NOW);
    expect((out.notices as { id: string }[]).map(n => n.id)).toEqual(["n0", "n1"]);
    expect((out["log:202611"] as { entries: unknown[] }).entries.length).toBe(2);
  });
});
