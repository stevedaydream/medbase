/**
 * GAS Excel 排班範本：在 node 以假工作表執行，驗證分段、只留最近幾份、列表不含內容、格式檢查。
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
      clearContent() { for (let i = 0; i < nr; i++) sh.rows[r - 1 + i] = Array(7).fill(""); },
    };
  }
}

type Fn = (...a: unknown[]) => unknown;
type Tpl = { id: string; name: string; saved_at: string; by: string; size: number; data?: string };
const ctx: Record<string, unknown> = {};
vm.createContext(ctx);
vm.runInContext(readFileSync("gas/scheduler.gs", "utf8")
  + "\n;this.api = { _tplRead, _tplWrite, _tplAdd, _tplList, TPL_CHUNK, TPL_KEEP };", ctx);
const g = ctx.api as Record<string, Fn> & { TPL_CHUNK: number; TPL_KEEP: number };

const sheet = () => { const sh = new FakeSheet(); sh.rows.push(["id", "name", "saved_at", "by", "size", "chunk", "data"]); return sh; };
const t = (i: number) => `2026-11-${String(i).padStart(2, "0")}T00:00:00.000Z`;

describe("GAS Excel 排班範本", () => {
  it("寫入後讀回一致，長內容分段；列表不讀內容", () => {
    const sh = sheet();
    const big = "QUJD".repeat(Math.ceil(g.TPL_CHUNK / 4) + 10);
    const items: Record<string, Tpl> = {};
    const r = g._tplAdd(items, { name: "9A值班表", data: big, by: "PC1" }, t(1)) as { id: string };
    expect(r.id).toBe(`9A值班表@${t(1)}`);
    g._tplWrite(sh, items);
    expect(sh.rows.filter(x => x[0] === r.id).length).toBe(2);
    const back = g._tplRead(sh, true) as Record<string, Tpl>;
    expect(back[r.id].data).toBe(big);
    expect(back[r.id].size).toBe(big.length * 3 / 4);
    const list = g._tplList(g._tplRead(sh, false)) as Tpl[];
    expect(list).toEqual([{ id: r.id, name: "9A值班表", saved_at: t(1), by: "PC1", size: big.length * 3 / 4 }]);
  });
  it("同名只留最近幾份，新的在前；不同名稱各自保留", () => {
    const items: Record<string, Tpl> = {};
    for (let i = 1; i <= g.TPL_KEEP + 2; i++) g._tplAdd(items, { name: "A", data: "QUJD" }, t(i));
    g._tplAdd(items, { name: "B", data: "QUJD" }, t(1));
    const list = g._tplList(items) as Tpl[];
    const a = list.filter(x => x.name === "A");
    expect(a.length).toBe(g.TPL_KEEP);
    expect(a[0].saved_at).toBe(t(g.TPL_KEEP + 2));
    expect(a[a.length - 1].saved_at).toBe(t(3));
    expect(list.some(x => x.name === "B")).toBe(true);
  });
  it("名稱與內容格式檢查", () => {
    const items: Record<string, Tpl> = {};
    expect(g._tplAdd(items, { name: "", data: "QUJD" }, t(1))).toHaveProperty("error");
    expect(g._tplAdd(items, { name: "A", data: "不是base64" }, t(1))).toHaveProperty("error");
    expect(g._tplAdd(items, { name: "A", data: { x: 1 } }, t(1))).toHaveProperty("error");
    expect(Object.keys(items)).toEqual([]);
  });
});
