/**
 * GAS 手機存取規則（ADR-015）：在 node VM 執行 gas/scheduler.gs 的 _sch* 函式。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import vm from "vm";

type Docs = Record<string, { version: string; json: string }>;
type Api = Record<string, (...a: unknown[]) => never>;

function loadGas(): Api {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync("gas/scheduler.gs", "utf8")
    + "\n;this.api = { _schPerson, _schIsStaff, _schEmployeeKey, _schMobileView, _schSetPrebook, _schMarkRead };", ctx);
  return ctx.api as Api;
}

const g = loadGas();
const doc = (v: unknown) => ({ version: "v1", json: JSON.stringify(v) });
function docs(): Docs {
  return {
    people: doc([
      { id: "e1", name: "員工甲", his: "111", role: "employee", active: true, unit: "9A", ext: "1", order: 0 },
      { id: "s1", name: "排班乙", his: "222", role: "scheduler", active: true, unit: "9A", ext: "2", order: 1 },
      { id: "x1", name: "停用丙", his: "333", role: "employee", active: false, unit: "9A", ext: "3", order: 2 },
    ]),
    shifts: doc([{ code: "D", reducesOff: false }, { code: "OFF", reducesOff: false }, { code: "8-4", reducesOff: true }]),
    "month:202612": doc({ ym: "202612", status: "open", roster: [{ personId: "e1", flags: { active: true } }, { personId: "s1", flags: { active: true } }] }),
    "month:202611": doc({ ym: "202611", status: "scheduling", roster: [{ personId: "e1", flags: { active: true } }] }),
    "prebook:202612": doc({ ym: "202612", cells: { "e1|5": { v: "8-4", src: "sys", by: "system", at: "t" } } }),
    notices: doc([{ id: "n1", personId: "e1", read: false }, { id: "n2", personId: "s1", read: false }]),
  };
}

describe("GAS 手機身分與讀取權限", () => {
  it("依 HIS 帳號找啟用中的人員", () => {
    const d = docs();
    expect(g._schPerson(d, "111")).toMatchObject({ id: "e1", role: "employee" });
    expect(g._schPerson(d, "333")).toBeNull();
    expect(g._schPerson(d, "999")).toBeNull();
    expect(g._schIsStaff(g._schPerson(d, "222"))).toBe(true);
  });
  it("員工只能讀 prebook／est／people／shifts／holidays／notices", () => {
    expect(["prebook:202612", "est:202612", "people", "notices", "shifts", "holidays"].every(k => g._schEmployeeKey(k))).toBe(true);
    expect(["month:202612", "log:202612", "lock:202612", "rules", "debts"].some(k => g._schEmployeeKey(k))).toBe(false);
  });
  it("員工讀 people 不含 HIS 與分機；notices 只有自己的", () => {
    const d = docs(), me = g._schPerson(d, "111");
    const people = JSON.parse((g._schMobileView(me, "people", d.people) as { json: string }).json);
    expect(Object.keys(people[0]).sort()).toEqual(["active", "id", "name", "order", "unit"]);
    const ns = JSON.parse((g._schMobileView(me, "notices", d.notices) as { json: string }).json);
    expect(ns.map((n: { id: string }) => n.id)).toEqual(["n1"]);
    const staff = g._schPerson(d, "222");
    expect(g._schMobileView(staff, "people", d.people)).toBe(d.people);
  });
});

describe("GAS mobileSetPrebook", () => {
  const NOW = "2026-10-10T00:00:00.000Z";
  it("寫自己那列並記操作紀錄；系統預填與 8-4 被拒", () => {
    const d = docs(), me = g._schPerson(d, "111");
    const r = g._schSetPrebook(d, me, "202612", [{ day: 3, v: "OFF" }, { day: 5, v: "OFF" }, { day: 6, v: "8-4" }, { day: 7, v: "勿休" }], NOW) as { ok: boolean; applied: unknown[]; rejected: { day: number }[] };
    expect(r.ok).toBe(true);
    expect(r.applied.length).toBe(2);
    expect(r.rejected.map(x => x.day)).toEqual([5, 6]);
    const pb = JSON.parse(d["prebook:202612"].json);
    expect(pb.cells["e1|3"]).toMatchObject({ v: "OFF", src: "emp", by: "e1" });
    expect(d["prebook:202612"].version).not.toBe("v1");
    const log = JSON.parse(d["log:202612"].json);
    expect(log.entries[0]).toMatchObject({ actor: "員工甲（手機）", action: "預班改格" });
    expect(log.entries[0].detail).toContain("12/3 空白→OFF");
  });
  it("清空寫墓碑；月份不開放、不在名單、非人員都拒絕", () => {
    const d = docs(), me = g._schPerson(d, "111");
    g._schSetPrebook(d, me, "202612", [{ day: 3, v: "OFF" }], NOW);
    g._schSetPrebook(d, me, "202612", [{ day: 3, v: null }], NOW);
    expect(JSON.parse(d["prebook:202612"].json).cells["e1|3"].v).toBeNull();
    expect((g._schSetPrebook(d, me, "202611", [{ day: 1, v: "OFF" }], NOW) as { error: string }).error).toContain("不開放");
    const other = { id: "zz", name: "外人", role: "employee" };
    expect((g._schSetPrebook(d, other, "202612", [{ day: 1, v: "OFF" }], NOW) as { error: string }).error).toContain("不在這個月份");
    expect((g._schSetPrebook(d, null, "202612", [], NOW) as { ok: boolean }).ok).toBe(false);
  });
  it("標記自己的通知已讀", () => {
    const d = docs(), me = g._schPerson(d, "111");
    expect(g._schMarkRead(d, me, null)).toBe(1);
    const ns = JSON.parse(d.notices.json);
    expect(ns.find((n: { id: string }) => n.id === "n1").read).toBe(true);
    expect(ns.find((n: { id: string }) => n.id === "n2").read).toBe(false);
  });
});
