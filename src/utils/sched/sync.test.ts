/**
 * 兩台電腦（各自的本機文件）經由 gas/scheduler.gs 的 _schPut 同步。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import vm from "vm";
import { syncOnce, type LocalMeta, type SyncLocal, type SyncRemote } from "./sync";

function gasRemote(): SyncRemote & { docs: Record<string, { version: string; json: string }> } {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync("gas/scheduler.gs", "utf8") + "\n;this._schPut = _schPut;", ctx);
  const put = ctx._schPut as (d: unknown, i: unknown) => never;
  const docs: Record<string, { version: string; json: string }> = {};
  let tick = 0;
  return {
    docs,
    async list() { return Object.entries(docs).map(([key, d]) => ({ key, version: d.version })); },
    async get(keys) { return keys.filter(k => docs[k]).map(k => ({ key: k, ...docs[k] })); },
    async put(items) {
      // 讓每次寫入的版本號遞增且可預期
      const res = put(docs, items) as { key: string; version: string }[];
      for (const r of res) if (docs[r.key].version === r.version) { docs[r.key].version = `v${++tick}`; r.version = docs[r.key].version; }
      return res as never;
    },
  };
}

class Machine implements SyncLocal {
  docs = new Map<string, LocalMeta>();
  private n = 0;
  write(key: string, value: unknown) {
    const d = this.docs.get(key);
    this.docs.set(key, { key, json: JSON.stringify(value), version: `L${++this.n}`, cloud_version: d?.cloud_version ?? null, dirty: 1 });
  }
  read(key: string) { return JSON.parse(this.docs.get(key)!.json); }
  async list() { return [...this.docs.values()].map(d => ({ ...d })); }
  async apply(key: string, json: string, cv: string, expect?: string) {
    const d = this.docs.get(key);
    if (expect && d && d.version !== expect) return false;
    this.docs.set(key, { key, json, version: cv, cloud_version: cv, dirty: 0 });
    return true;
  }
  async synced(key: string, sent: string, cv: string) {
    const d = this.docs.get(key)!;
    d.cloud_version = cv;
    if (d.version === sent) d.dirty = 0;
  }
}

describe("syncOnce", () => {
  it("A 上傳、B 下載", async () => {
    const remote = gasRemote(), a = new Machine(), b = new Machine();
    a.write("people", [{ id: "1" }]);
    expect((await syncOnce(a, remote)).uploaded).toEqual(["people"]);
    expect((await syncOnce(b, remote)).downloaded).toEqual(["people"]);
    expect(b.read("people")).toEqual([{ id: "1" }]);
    const again = await syncOnce(b, remote);
    expect(again.downloaded.length + again.uploaded.length).toBe(0);
  });

  it("兩台同時登記不同人的預班 → 伺服器合併，兩邊都拿到全部", async () => {
    const remote = gasRemote(), a = new Machine(), b = new Machine();
    a.write("prebook:202612", { ym: "202612", cells: {} });
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    a.write("prebook:202612", { ym: "202612", cells: { "x|1": { v: "OFF", at: "2026-10-01T01" } } });
    b.write("prebook:202612", { ym: "202612", cells: { "y|2": { v: "OFF", at: "2026-10-01T02" } } });
    await syncOnce(a, remote);
    const rb = await syncOnce(b, remote);
    expect(rb.merged).toEqual(["prebook:202612"]);
    expect(Object.keys(b.read("prebook:202612").cells).sort()).toEqual(["x|1", "y|2"]);
    await syncOnce(a, remote);
    expect(Object.keys(a.read("prebook:202612").cells).sort()).toEqual(["x|1", "y|2"]);
  });

  it("月份文件同時修改：較晚上傳者收到衝突，改以雲端為準", async () => {
    const remote = gasRemote(), a = new Machine(), b = new Machine();
    a.write("month:202612", { n: 0 });
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    a.write("month:202612", { n: 1 });
    b.write("month:202612", { n: 2 });
    await syncOnce(a, remote);
    const rb = await syncOnce(b, remote);
    expect(rb.conflicts).toEqual(["month:202612"]);
    expect(b.read("month:202612")).toEqual({ n: 1 });
  });
});
