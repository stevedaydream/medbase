import { describe, it, expect } from "vitest";
import { handle, taipeiToday } from "../swap";
import { DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, emptyFlags, emptyMonth } from "../../../src/shared/sched/types";
import { dowOf } from "../../../src/shared/sched/calendar";

/** 記憶體中的 SchDocs（schList／schGet／schPut atomic／schPublish） */
function fakeGas() {
  const store: Record<string, { version: string; json: string }> = {};
  let v = 0;
  const calls: string[] = [];
  let conflictOnce = false;
  const put = (k: string, o: unknown) => { store[k] = { version: `v${++v}`, json: JSON.stringify(o) }; };
  const gas = async (b: Record<string, unknown>) => {
    calls.push(String(b.action));
    switch (b.action) {
      case "schList": return { ok: true, docs: Object.entries(store).map(([key, d]) => ({ key, version: d.version })) };
      case "schGet": return { ok: true, docs: (b.keys as string[]).filter(k => store[k]).map(k => ({ key: k, ...store[k] })) };
      case "schPut": {
        const items = b.items as { key: string; json: string; base: string | null }[];
        if (conflictOnce) { conflictOnce = false; put("rules", DEFAULT_RULES); return { ok: true, aborted: true, results: items.map(i => ({ key: i.key, ok: false })) }; }
        const bad = items.filter(i => (store[i.key]?.version ?? null) !== i.base);
        if (bad.length) return { ok: true, aborted: true, results: items.map(i => ({ key: i.key, ok: false })) };
        for (const i of items) store[i.key] = { version: `v${++v}`, json: i.json };
        return { ok: true, results: items.map(i => ({ key: i.key, ok: true })) };
      }
      case "schPublish": return { ok: true };
      default: return { ok: false, error: "?" };
    }
  };
  const people = ["a", "b", "c"].map((id, i) => ({ id, name: id.toUpperCase(), unit: "9A", ext: "", his: id, role: "employee", code84: "", order: i, exempt84: false, exemptCny: false, active: true }));
  const m = { ...emptyMonth("202611"), status: "published", publishedAt: "2026-10-20T00:00:00Z", imported: true };
  m.roster = people.map(p => ({ personId: p.id, flags: emptyFlags() }));
  for (const p of people) m.schedule[p.id] = Array.from({ length: 30 }, (_, i) => [0, 6].includes(dowOf("202611", i + 1)) ? "OFF" : "S1");
  m.schedule.a[9] = "D";
  put("people", people); put("shifts", DEFAULT_SHIFTS); put("quotaItems", DEFAULT_QUOTA_ITEMS); put("rules", DEFAULT_RULES);
  put("notices", []); put("debts", []); put("month:202611", m);
  const read = (k: string) => JSON.parse(store[k].json);
  return { gas, read, calls, conflict: () => { conflictOnce = true; } };
}

const NOW = new Date("2026-11-01T02:00:00Z");
const A = { id: "a", name: "A", role: "employee" }, B = { id: "b", name: "B", role: "employee" };

describe("/api/swap", () => {
  it("台北日期", () => {
    expect(taipeiToday(new Date("2026-10-31T17:00:00Z"))).toBe("20261101");
  });

  it("申請 → 對方清單看得到 → 同意後班表對調、推送班表分頁", async () => {
    const f = fakeGas();
    const pv = await handle({ action: "preview", ym: "202611", kind: "same", b: "b", give: [10] }, A, f.gas, NOW);
    expect(pv).toMatchObject({ ok: true, hard: [], days: [{ day: 10, aCode: "D", bCode: "S1" }] });
    const cr = await handle({ action: "create", ym: "202611", kind: "same", b: "b", give: [10], a: "c" }, A, f.gas, NOW);
    expect(cr.ok).toBe(true);
    expect(f.read("month:202611").schedule.a[9]).toBe("D");
    const list = await handle({ action: "list" }, B, f.gas, NOW);
    const id = (list.items as { id: string; a: string }[])[0].id;
    expect((list.items as { a: string }[])[0].a).toBe("a");
    expect(f.read("notices").map((n: { personId: string }) => n.personId)).toEqual(["b"]);
    expect(await handle({ action: "accept", ym: "202611", id }, B, f.gas, NOW)).toEqual({ ok: true });
    expect(f.read("month:202611").schedule.a[9]).toBe("S1");
    expect(f.read("month:202611").schedule.b[9]).toBe("D");
    expect(f.read("swapreq:202611").items[0].status).toBe("done");
    expect(f.calls).toContain("schPublish");
  });

  it("只有對象能同意；申請人只能撤回", async () => {
    const f = fakeGas();
    await handle({ action: "create", ym: "202611", kind: "same", b: "b", give: [10] }, A, f.gas, NOW);
    const id = f.read("swapreq:202611").items[0].id;
    await expect(handle({ action: "accept", ym: "202611", id }, A, f.gas, NOW)).rejects.toThrow("找不到");
    expect(await handle({ action: "cancel", ym: "202611", id }, A, f.gas, NOW)).toEqual({ ok: true });
    expect(f.read("swapreq:202611").items[0].status).toBe("cancelled");
  });

  it("寫入衝突時重讀重算", async () => {
    const f = fakeGas();
    f.conflict();
    expect((await handle({ action: "create", ym: "202611", kind: "same", b: "b", give: [10] }, A, f.gas, NOW)).ok).toBe(true);
    expect(f.calls.filter(c => c === "schPut").length).toBe(2);
  });
});
