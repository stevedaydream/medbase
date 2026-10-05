/**
 * GAS 資料垃圾桶（ADR-028）：在 node 以假工作表執行，驗證分段、保留 30 天、只收逐筆同步表。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import vm from "vm";

class FakeSheet {
  rows: string[][] = [];
  getLastRow() { return this.rows.length; }
  getRange(r: number, c: number, nr = 1, nc = 1) {
    const sh = this;
    return {
      setNumberFormat() { return this; },
      setValues(v: string[][]) { v.forEach((row, i) => { sh.rows[r - 1 + i] = [...row]; }); },
      getValues() { return sh.rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)); },
      clearContent() { for (let i = 0; i < nr; i++) sh.rows[r - 1 + i] = Array(nc).fill(""); },
    };
  }
}

type Fn = (...a: unknown[]) => unknown;
const ctx: Record<string, unknown> = {};
vm.createContext(ctx);
vm.runInContext(readFileSync("gas/scheduler.gs", "utf8")
  + "\n;this.api = { _trashRead, _trashWrite, _trashPurge, _trashAdd, TRASH_CHUNK };", ctx);
const g = ctx.api as Record<string, Fn> & { TRASH_CHUNK: number };

const item = (id: string, deleted_at: string, data = '{"name":"x"}') =>
  ({ id, table: "items", key: `K${id}`, label: `品項${id}`, deleted_at, machine: "PC1", data });

describe("GAS 資料垃圾桶", () => {
  it("寫入後讀回一致，長資料分段", () => {
    const sh = new FakeSheet();
    sh.rows.push(["id", "table", "key", "label", "deleted_at", "machine", "chunk", "data"]);
    const long = JSON.stringify({ text: "字".repeat(g.TRASH_CHUNK + 10) });
    const items: Record<string, unknown> = {};
    g._trashAdd(items, [item("a", "2026-10-01T00:00:00.000Z"), item("b", "2026-10-02T00:00:00.000Z", long)]);
    g._trashWrite(sh, items);
    expect(sh.rows.filter(r => r[0] === "b").length).toBe(2);
    const back = g._trashRead(sh) as Record<string, { data: string; label: string }>;
    expect(back.b.data).toBe(long);
    expect(back.a.label).toBe("品項a");
  });
  it("超過 30 天自動清掉", () => {
    const items: Record<string, unknown> = {};
    g._trashAdd(items, [item("old", "2026-09-01T00:00:00.000Z"), item("new", "2026-10-01T00:00:00.000Z")]);
    expect(g._trashPurge(items, "2026-10-05T00:00:00.000Z")).toBe(true);
    expect(Object.keys(items)).toEqual(["new"]);
  });
  it("只收逐筆同步表、data 必須是字串", () => {
    const items: Record<string, unknown> = {};
    g._trashAdd(items, [{ ...item("x", "t"), table: "evil" }, { ...item("y", "t"), data: { a: 1 } }, null]);
    expect(Object.keys(items)).toEqual([]);
  });
});
