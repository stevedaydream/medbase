import { describe, it, expect } from "vitest";
import {
  opRecompute, opStartMonth, opPublish, opRevert, opCreateSwap, opDeleteSwap, lockDecision, cellChangeNotices,
  applyToState, type OpsState,
} from "./ops";
import { newMonthFrom } from "./engine/prefill";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, emptyFlags, emptyMonth, type Person } from "./types";
import { emptyHolidays } from "./calendar";

const P = (id: string, order: number): Person => ({
  id, name: id.toUpperCase(), unit: "9A", ext: "", his: id, role: "employee", code84: "", order,
  exempt84: false, exemptCny: false, active: true,
});

function base(): OpsState {
  const people = ["a", "b", "c", "d", "e"].map(P);
  const oct = { ...emptyMonth("202610"), status: "published" as const, publishedAt: "2026-09-01T00:00:00Z", imported: true };
  oct.roster = people.map(p => ({ personId: p.id, flags: emptyFlags() }));
  oct.weekend.end = { wkN: "a", satD: "b", sunD: "c" };
  for (const it of DEFAULT_QUOTA_ITEMS) oct.markers[it.id] = { v: "a", x: "b" };
  return {
    people, shifts: DEFAULT_SHIFTS, quotaItems: DEFAULT_QUOTA_ITEMS, rules: DEFAULT_RULES, debts: [],
    holidays: emptyHolidays(), holidayDuty: {}, duty84: { log: [], removedDates: [], addedDates: [] }, cny: { lastD: {}, log: [] },
    months: { "202610": oct, "202611": newMonthFrom(oct, "202611") }, prebooks: { "202611": { ym: "202611", cells: {} } },
  };
}
const NOW = "2026-10-01T00:00:00.000Z";

describe("ops", () => {
  it("opRecompute：預填、V 交接、est 文件與系統紀錄", () => {
    const p = opRecompute(base(), "202611", "測試", NOW);
    expect(p.months.map(m => m.ym)).toEqual(["202611"]);
    expect(p.months[0].markers.D.v).toBe("c");
    expect(Object.keys(p.prebooks.find(x => x.ym === "202611")!.cells).length).toBeGreaterThan(0);
    expect(p.ests.map(e => [e.ym, e.status])).toEqual([["202611", "open"]]);
    expect(p.ests[0].offSlots.length).toBe(30);
    expect(p.logs[0]).toMatchObject({ scope: "202611", action: "重新計算預填", actor: "system" });
  });

  it("開始排班 → 發布（通知全體、定案）→ 期限內退回", () => {
    let s = base();
    s = applyToState(s, opRecompute(s, "202611", "x", NOW));
    const st = opStartMonth(s, "202611", false, "排班者", NOW);
    expect(st.months[0].status).toBe("scheduling");
    s = applyToState(s, st);
    const pub = opPublish(s, "202611", 3, "排班者", NOW);
    expect(pub.months[0]).toMatchObject({ status: "published", publishedAt: NOW });
    expect(pub.months[0].frozenQuotas).toBeTruthy();
    expect(pub.notices.map(n => n.personId).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(pub.logs[0].detail).toContain("仍有 3 項");
    s = applyToState(s, pub);
    expect(opRevert(s, "202611", "x", "2026-10-02T00:00:00.000Z").months[0].status).toBe("scheduling");
    expect(() => opRevert(s, "202611", "x", "2026-10-04T00:00:00.000Z")).toThrow("已超過可退回期限");
  });

  it("換班與刪除換班", () => {
    let s = base();
    s.months["202611"] = { ...s.months["202611"], status: "scheduling" };
    s.months["202611"].schedule = { a: Array(30).fill(""), b: Array(30).fill("") };
    s.months["202611"].schedule.a[2] = "D";
    const p = opCreateSwap(s, "202611", 3, "a", "b", "", "x", NOW);
    expect([p.months[0].schedule.a[2], p.months[0].schedule.b[2]]).toEqual(["", "D"]);
    s = applyToState(s, p);
    const back = opDeleteSwap(s, "202611", p.months[0].swaps![0].id, "x");
    expect([back.months[0].schedule.a[2], back.months[0].schedule.b[2]]).toEqual(["D", ""]);
  });

  it("排班鎖判斷", () => {
    const lock = { his: "x", name: "X", machine: "m1", at: "2026-10-01T00:00:00Z" };
    const t = new Date("2026-10-01T01:00:00Z").getTime();
    expect(lockDecision(null, "m2", t, false).ok).toBe(true);
    expect(lockDecision(lock, "m1", t, false)).toEqual({ ok: true, takeover: false, stale: false });
    expect(lockDecision(lock, "m2", t, false).ok).toBe(false);
    expect(lockDecision(lock, "m2", t, true)).toEqual({ ok: true, takeover: true, stale: false });
    expect(lockDecision(lock, "m2", t + 12 * 3600_000, false)).toEqual({ ok: true, takeover: true, stale: true });
  });

  it("格子異動通知：不通知自己", () => {
    const n = cellChangeNotices("published", "202611", [{ personId: "a", day: 5, from: "D", to: "OFF" }, { personId: "b", day: 5, from: "", to: "D" }], "b", "病假", NOW);
    expect(n.map(x => [x.personId, x.text])).toEqual([["a", "11/5 你的班 D→OFF：病假"]]);
  });
});
