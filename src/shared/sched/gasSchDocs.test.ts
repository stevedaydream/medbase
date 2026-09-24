/**
 * GAS 排班文件庫（gas/scheduler.gs 的 _sch*）在 node 以假工作表執行，驗證分段、版本比對與合併。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import vm from "vm";

type Cell = string;
class FakeSheet {
  rows: Cell[][] = [];
  getLastRow() { return this.rows.length; }
  getRange(r: number, c: number, nr?: number, nc?: number) {
    if (typeof r === "string") return { setNumberFormat() { return this; } };
    const sh = this;
    return {
      setNumberFormat() { return this; },
      setValues(v: Cell[][]) { v.forEach((row, i) => { sh.rows[r - 1 + i] = [...row]; }); },
      getValues() { return sh.rows.slice(r - 1, r - 1 + (nr ?? 1)).map(x => x.slice(c - 1, c - 1 + (nc ?? 1))); },
      clearContent() { for (let i = 0; i < (nr ?? 1); i++) sh.rows[r - 1 + i] = Array(nc ?? 1).fill(""); },
    };
  }
}

function loadGas() {
  const ctx: Record<string, unknown> = { console };
  vm.createContext(ctx);
  vm.runInContext(readFileSync("gas/scheduler.gs", "utf8") + "\n;this.api = { _schPut, _schMerge, _schReadAll, _schWriteAll, _schSheet };", ctx);
  return (ctx as { api: Record<string, (...a: unknown[]) => unknown> }).api;
}

describe("GAS SchDocs", () => {
  const g = loadGas();
  const fakeSS = () => {
    const sheets: Record<string, FakeSheet> = {};
    return { getSheetByName: (n: string) => sheets[n] ?? null, insertSheet: (n: string) => (sheets[n] = new FakeSheet()) };
  };

  it("分段寫入後讀回一致（超過 45000 字）", () => {
    const ss = fakeSS();
    const sh = g._schSheet(ss) as FakeSheet;
    const big = JSON.stringify({ s: "x".repeat(100000) });
    g._schWriteAll(sh, { "month:202611": { version: "v1", json: big }, people: { version: "v2", json: "[]" } });
    expect(sh.rows.filter(r => r[0] === "month:202611").length).toBe(3);
    const back = g._schReadAll(sh) as Record<string, { version: string; json: string }>;
    expect(back["month:202611"].json).toBe(big);
    expect(back.people).toEqual({ version: "v2", json: "[]" });
  });

  it("版本相符才寫入；月份文件衝突時回傳雲端版本", () => {
    const docs: Record<string, { version: string; json: string }> = { "month:202611": { version: "A", json: '{"n":1}' } };
    const [ok] = g._schPut(docs, [{ key: "month:202611", json: '{"n":2}', base: "A" }]) as { ok: boolean; version: string }[];
    expect(ok.ok).toBe(true);
    const [bad] = g._schPut(docs, [{ key: "month:202611", json: '{"n":3}', base: "A" }]) as { ok: boolean; conflict: boolean; json: string }[];
    expect(bad).toMatchObject({ ok: false, conflict: true, json: '{"n":2}' });
    const [neu] = g._schPut(docs, [{ key: "people", json: "[]", base: null }]) as { ok: boolean }[];
    expect(neu.ok).toBe(true);
  });

  it("預班逐格合併：同格較晚者勝，不同格保留兩邊", () => {
    const cur = { ym: "202611", cells: { "a|1": { v: "OFF", at: "2026-09-01" }, "b|2": { v: "N", at: "2026-09-05" } } };
    const inc = { ym: "202611", cells: { "a|1": { v: "D", at: "2026-09-03" }, "b|2": { v: null, at: "2026-09-02" }, "c|3": { v: "OFF", at: "2026-09-04" } } };
    const docs = { "prebook:202611": { version: "A", json: JSON.stringify(cur) } };
    const [r] = g._schPut(docs, [{ key: "prebook:202611", json: JSON.stringify(inc), base: "OLD" }]) as { ok: boolean; merged: boolean; json: string }[];
    expect(r.ok && r.merged).toBe(true);
    const m = JSON.parse(r.json);
    expect(m.cells["a|1"].v).toBe("D");
    expect(m.cells["b|2"].v).toBe("N");
    expect(m.cells["c|3"].v).toBe("OFF");
  });

  it("操作紀錄與通知以聯集合併", () => {
    const e = (at: string, d: string) => ({ at, actor: "x", action: "a", detail: d });
    const log = g._schMerge("log:202611", JSON.stringify({ key: "202611", entries: [e("1", "a"), e("3", "c")] }),
      JSON.stringify({ key: "202611", entries: [e("1", "a"), e("2", "b")] })) as string;
    expect(JSON.parse(log).entries.map((x: { detail: string }) => x.detail)).toEqual(["a", "b", "c"]);
    const n = g._schMerge("notices", JSON.stringify([{ id: "1", at: "1", read: false }]), JSON.stringify([{ id: "1", at: "1", read: true }, { id: "2", at: "2", read: false }])) as string;
    expect(JSON.parse(n)).toEqual([{ id: "1", at: "1", read: true }, { id: "2", at: "2", read: false }]);
  });
});
