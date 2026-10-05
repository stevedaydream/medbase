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
    + "\n;this.api = { _schPerson, _schIsStaff, _schEmployeeKey, _schMobileView, _schSetPrebook, _schMarkRead, _schPublishRows,"
    + " _schFullKey, _schSplitKey, _schSheetName, _schPersonGroup, _schViewGroup, _schView, _schUnview, _schGroupSheets, _schRequestView };", ctx);
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
    // month:* 員工可讀但只有已發布月份自己那列（見「GAS 假勤」）
    expect(["log:202612", "lock:202612", "rules", "debts", "pay"].some(k => g._schEmployeeKey(k))).toBe(false);
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
  it("週日自動補的 OFF：只能改成公假", () => {
    const d = docs(), me = g._schPerson(d, "111");
    const pb = JSON.parse(d["prebook:202612"].json);
    pb.cells["e1|6"] = { v: "OFF", src: "sys", by: "system", at: "t", auto: true };
    d["prebook:202612"].json = JSON.stringify(pb);
    d.shifts = doc([{ code: "D", reducesOff: false }, { code: "OFF", reducesOff: false }, { code: "公假", reducesOff: false }]);
    const r = g._schSetPrebook(d, me, "202612", [{ day: 6, v: "D" }], NOW) as { rejected: { reason: string }[] };
    expect(r.rejected[0].reason).toContain("只能改成公假");
    const ok = g._schSetPrebook(d, me, "202612", [{ day: 6, v: "公假" }], NOW) as { applied: unknown[] };
    expect(ok.applied.length).toBe(1);
    expect(JSON.parse(d["prebook:202612"].json).cells["e1|6"]).toMatchObject({ v: "公假", src: "emp" });
  });
  it("遠期月份只能登記休假類與限制註記", () => {
    const d = docs(), me = g._schPerson(d, "111");
    d["month:202612"] = doc({ ym: "202612", status: "open", prefilled: false, roster: [{ personId: "e1", flags: { active: true } }] });
    d.shifts = doc([{ code: "D", reducesOff: false, takesOff: false }, { code: "OFF", reducesOff: false, takesOff: true }, { code: "公假", reducesOff: false, takesOff: true }]);
    const r = g._schSetPrebook(d, me, "202612", [{ day: 1, v: "D" }, { day: 2, v: "OFF" }, { day: 3, v: "公假" }, { day: 4, v: "勿值" }], NOW) as { applied: unknown[]; rejected: { day: number; reason: string }[] };
    expect(r.applied.length).toBe(3);
    expect(r.rejected).toEqual([{ day: 1, reason: "遠期月份只能登記休假" }]);
  });
  it("標記自己的通知已讀", () => {
    const d = docs(), me = g._schPerson(d, "111");
    expect(g._schMarkRead(d, me, null)).toBe(1);
    const ns = JSON.parse(d.notices.json);
    expect(ns.find((n: { id: string }) => n.id === "n1").read).toBe(true);
    expect(ns.find((n: { id: string }) => n.id === "n2").read).toBe(false);
  });
});

describe("GAS schPublish", () => {
  it("已發布月份才產生班表列（在職者、姓名＋31 天）", () => {
    const d = docs();
    expect(g._schPublishRows(d, "202612")).toBeNull();
    d["month:202612"] = doc({ ym: "202612", status: "published", roster: [{ personId: "e1", flags: { active: true } }, { personId: "x1", flags: { active: false } }], schedule: { e1: ["D", "", "OFF"] } });
    const rows = g._schPublishRows(d, "202612") as string[][];
    expect(rows.length).toBe(1);
    expect(rows[0].slice(0, 4)).toEqual(["員工甲", "D", "", "OFF"]);
    expect(rows[0].length).toBe(32);
  });
});

describe("GAS 班表分頁：8-4 不被當成日期", () => {
  it("讀取時把被 Sheets 轉成日期的格子還原為「月-日」；寫入前設純文字", () => {
    const ctx: Record<string, unknown> = {
      Utilities: { formatDate: (d: Date) => `${d.getMonth() + 1}-${d.getDate()}` },
      PropertiesService: { getScriptProperties: () => ({ setProperty() {}, getProperty: () => null }) },
    };
    vm.createContext(ctx);
    vm.runInContext(readFileSync("gas/scheduler.gs", "utf8") + "\n;this.api = { _readScheduleValues, _writeScheduleSheet };", ctx);
    const api = ctx.api as Api;
    // Sheets 回傳的是 GAS 環境裡的 Date，要在 VM 內建立 instanceof 才成立
    const aug4 = vm.runInContext("new Date(2026, 7, 4)", ctx);
    const sheet = { getDataRange: () => ({ getValues: () => [["姓名", "1日"], ["王子建", aug4], ["黃郁芳", "D"]] }) };
    expect(api._readScheduleValues(sheet, "Asia/Taipei")).toEqual([["姓名", "1日"], ["王子建", "8-4"], ["黃郁芳", "D"]]);
    const formats: string[] = [];
    let written: unknown[][] = [];
    const out = { getName: () => "Schedule_202611", clearContents() {}, getRange:(r: number) => ({ setValues(v: unknown[][]) { if (r === 2) written = v; }, setNumberFormat(fmt: string) { formats.push(fmt); return this; } }) };
    api._writeScheduleSheet(out, [["王子建", "8-4", null]]);
    expect(formats).toEqual(["@"]);
    expect(written).toEqual([["王子建", "8-4", ""]]);
  });
});

describe("GAS 班表分頁版本（ADR-022）", () => {
  function gasWithProps(sheets: string[]) {
    const store: Record<string, string> = {};
    const props = {
      setProperty: (k: string, v: string) => { store[k] = v; },
      getProperty: (k: string) => store[k] ?? null,
      getProperties: () => ({ ...store }),
    };
    const ss = { getSheets: () => sheets.map(n => ({ getName: () => n })) };
    const ctx: Record<string, unknown> = { PropertiesService: { getScriptProperties: () => props } };
    vm.createContext(ctx);
    vm.runInContext(readFileSync("gas/scheduler.gs", "utf8")
      + "\n;_getConfigValue = () => '';this.api = { _scheduleVersions, _scheduleVersion, _writeScheduleSheet };", ctx);
    return { api: ctx.api as Api, store, ss };
  }
  it("第一次列出時替既有班表分頁補版本；寫入班表時更新版本", async () => {
    const { api, store, ss } = gasWithProps(["Schedule_202610", "Config", "Schedule_202611"]);
    const v1 = api._scheduleVersions(ss) as Record<string, string>;
    expect(Object.keys(v1).sort()).toEqual(["Schedule_202610", "Schedule_202611"]);
    expect(store.schver_init).toBe("1");
    await new Promise(r => setTimeout(r, 5));
    const sheet = { getName: () => "Schedule_202611", clearContents() {}, getRange: () => ({ setValues() {}, setNumberFormat() { return this; } }) };
    api._writeScheduleSheet(sheet, []);
    const v2 = api._scheduleVersions(ss) as Record<string, string>;
    expect(v2.Schedule_202611 > v1.Schedule_202611).toBe(true);
    expect(v2.Schedule_202610).toBe(v1.Schedule_202610);
    expect(api._scheduleVersion("Schedule_202612")).toBeTruthy();
  });
});

describe("GAS 排班群組（ADR-025）", () => {
  function gdocs(): Docs {
    const d = docs();
    d.people = doc([
      { id: "e1", name: "員工甲", his: "111", role: "employee", active: true, unit: "9A", order: 0 },
      { id: "s1", name: "排班乙", his: "222", role: "scheduler", active: true, unit: "9A", order: 1 },
      { id: "a1", name: "八A丁", his: "444", role: "employee", active: true, unit: "8A", group: "8A", order: 2 },
      { id: "a2", name: "八A排班", his: "555", role: "scheduler", active: true, unit: "8A", group: "8A", order: 3 },
      { id: "u1", name: "未分組戊", his: "666", role: "employee", active: true, unit: "8A", order: 4 },
      { id: "su", name: "超級", his: "777", role: "super", active: true, unit: "9B", order: 5 },
    ]);
    d.groups = doc([{ id: "9A9B", name: "9A／9B", order: 0 }, { id: "8A", name: "8A", order: 1 }]);
    d["8A/month:202612"] = doc({ ym: "202612", status: "open", roster: [{ personId: "a1", flags: { active: true } }] });
    d["8A/prebook:202612"] = doc({ ym: "202612", cells: {} });
    d["8A/shifts"] = doc([{ code: "OFF", reducesOff: false }]);
    return d;
  }

  it("key 對應：預設群組沿用舊 key，共用文件不加前綴", () => {
    expect(g._schFullKey("9A9B", "month:202612")).toBe("month:202612");
    expect(g._schFullKey("8A", "month:202612")).toBe("8A/month:202612");
    expect(g._schFullKey("8A", "people")).toBe("people");
    expect(g._schSplitKey("8A/prebook:202612")).toEqual({ group: "8A", base: "prebook:202612" });
    expect(g._schSplitKey("duty84")).toEqual({ group: null, base: "duty84" });
    expect(g._schSplitKey("shifts")).toEqual({ group: "9A9B", base: "shifts" });
    expect(g._schSheetName("8A", "202612")).toBe("Schedule_8A_202612");
    expect(g._schSheetName("9A9B", "202612")).toBe("Schedule_202612");
  });

  it("人員群組：舊資料 9A／9B 視為預設群組，其他未分組", () => {
    expect(g._schPersonGroup({ unit: "9B" })).toBe("9A9B");
    expect(g._schPersonGroup({ unit: "8A" })).toBe("");
    expect(g._schPersonGroup({ unit: "9A", group: "8A" })).toBe("8A");
    expect(g._schPersonGroup({ unit: "9A", group: "" })).toBe("");
  });

  it("白名單：不在名單、未分組看不到；非 super 不能指定其他群組", () => {
    const d = gdocs();
    const view = (his: string, group?: string) => g._schRequestView(d, { _mobile: { his }, group }) as unknown as { group: string | null; denied: boolean };
    expect(view("999").denied).toBe(true);
    expect(view("666").denied).toBe(true);
    expect(view("444").group).toBe("8A");
    expect(view("444", "9A9B").group).toBe("8A");
    expect(view("111").group).toBe("9A9B");
    expect(view("777").group).toBe("9A9B");
    expect(view("777", "8A").group).toBe("8A");
    expect(view("777", "XX").group).toBe("9A9B");
  });

  it("8A 的視角看不到 9A9B 的月份與預班，key 去掉前綴", () => {
    const v = g._schView(gdocs(), "8A") as unknown as Docs;
    expect(Object.keys(v).sort()).toEqual(["groups", "month:202612", "notices", "people", "prebook:202612", "shifts"]);
    expect(JSON.parse(v["month:202612"].json).roster[0].personId).toBe("a1");
    expect(JSON.parse(v.shifts.json)).toEqual([{ code: "OFF", reducesOff: false }]);
  });

  it("8A 員工讀 people 只有同群組的人", () => {
    const d = gdocs(), me = g._schPerson(d, "444");
    const people = JSON.parse((g._schMobileView(me, "people", d.people) as { json: string }).json);
    expect(people.map((p: { id: string }) => p.id)).toEqual(["a1", "a2"]);
  });

  it("在群組視角登記預班，寫回帶前綴的 key", () => {
    const d = gdocs(), me = g._schPerson(d, "444");
    const v = g._schView(d, "8A") as unknown as Docs;
    const r = g._schSetPrebook(v, me, "202612", [{ day: 3, v: "OFF" }], "2026-10-10T00:00:00.000Z") as { applied: unknown[] };
    expect(r.applied.length).toBe(1);
    g._schUnview(d, v, "8A");
    expect(JSON.parse(d["8A/prebook:202612"].json).cells["a1|3"].v).toBe("OFF");
    expect(JSON.parse(d["prebook:202612"].json).cells["a1|3"]).toBeUndefined();
  });

  it("班表分頁版本只回傳該群組的，名稱去掉群組", () => {
    const vs = { Schedule_202611: "t1", Schedule_8A_202611: "t2", Schedule_8A_202612: "t3" };
    expect(g._schGroupSheets(vs, "8A")).toEqual({ Schedule_202611: "t2", Schedule_202612: "t3" });
    expect(g._schGroupSheets(vs, "9A9B")).toEqual({ Schedule_202611: "t1" });
  });
});

describe("GAS 假勤（ADR-027）", () => {
  function load() {
    const ctx: Record<string, unknown> = { Utilities: { getUuid: () => "uuid-1" } };
    vm.createContext(ctx);
    vm.runInContext(readFileSync("gas/scheduler.gs", "utf8")
      + "\n;this.api = { _schPerson, _schMobileView, _schView, _schNoHidden, _schSetOvertime, _schSetLeaveOpen, _schSetPay, _schEmployeeKey };", ctx);
    return ctx.api as Api;
  }
  const a = load();
  const NOW = "2026-10-10T00:00:00.000Z";
  function d(): Docs {
    const x = docs();
    x["month:202611"] = doc({ ym: "202611", status: "published", roster: [{ personId: "e1" }, { personId: "s1" }], schedule: { e1: ["D"], s1: ["N"] } });
    x.leaveOpen = doc({ e1: { from: "202610", annual: 8 }, s1: { from: "202610", annual: 16 } });
    x["overtime:202612"] = doc({ ym: "202612", items: [{ id: "o1", personId: "e1", day: 1, hours: 2 }, { id: "o2", personId: "s1", day: 2, hours: 3 }] });
    x.pay = doc({ e1: { hourly: 300, dutyPay: {} } });
    return x;
  }

  it("員工只看到已發布月份自己那列、自己的加班與期初餘額；排班中月份只有狀態", () => {
    const x = d(), me = a._schPerson(x, "111");
    const m = JSON.parse((a._schMobileView(me, "month:202611", x["month:202611"]) as { json: string }).json);
    expect(m.schedule).toEqual({ e1: ["D"] });
    expect(m.roster).toEqual([{ personId: "e1" }]);
    const draft = JSON.parse((a._schMobileView(me, "month:202612", x["month:202612"]) as { json: string }).json);
    expect(draft).toEqual({ ym: "202612", status: "open" });
    const ot = JSON.parse((a._schMobileView(me, "overtime:202612", x["overtime:202612"]) as { json: string }).json);
    expect(ot.items.map((i: { id: string }) => i.id)).toEqual(["o1"]);
    expect(Object.keys(JSON.parse((a._schMobileView(me, "leaveOpen", x.leaveOpen) as { json: string }).json))).toEqual(["e1"]);
    expect(a._schEmployeeKey("overtime:202612")).toBe(true);
  });
  it("個人薪資設定不在任何同步清單", () => {
    expect(Object.keys(a._schView(d(), "9A9B"))).not.toContain("pay");
    expect(Object.keys(a._schNoHidden(d()))).not.toContain("pay");
  });
  it("登記與刪除自己的加班；不能刪別人的", () => {
    const x = d(), me = a._schPerson(x, "111");
    const v = a._schView(x, "9A9B") as unknown as Docs;
    expect(a._schSetOvertime(v, me, { ym: "202612", day: 5, hours: 2.5, note: "急診刀" }, NOW)).toEqual({ ok: true });
    expect(JSON.parse(v["overtime:202612"].json).items.at(-1)).toMatchObject({ id: "uuid-1", personId: "e1", day: 5, hours: 2.5 });
    expect((a._schSetOvertime(v, me, { ym: "202612", op: "delete", id: "o2" }, NOW) as { ok: boolean }).ok).toBe(false);
    expect(a._schSetOvertime(v, me, { ym: "202612", op: "delete", id: "o1" }, NOW)).toEqual({ ok: true });
    expect((a._schSetOvertime(v, me, { ym: "202612", day: 40, hours: 1 }, NOW) as { error: string }).error).toContain("日期");
    expect((a._schSetOvertime(v, me, { ym: "202612", day: 1, hours: 30 }, NOW) as { error: string }).error).toContain("時數");
  });
  it("期初餘額與薪資設定只寫自己的", () => {
    const x = d(), me = a._schPerson(x, "111");
    expect(a._schSetLeaveOpen(x, me, { from: "202611", annual: 40, carry: 8, carryUntil: "2027-01-01", comp: 4, swap: 0 })).toEqual({ ok: true });
    const lo = JSON.parse(x.leaveOpen.json);
    expect(lo.e1).toEqual({ from: "202611", annual: 40, carry: 8, carryUntil: "2027-01-01", comp: 4, swap: 0 });
    expect(lo.s1.annual).toBe(16);
    expect((a._schSetLeaveOpen(x, me, { from: "2026-11" }) as { ok: boolean }).ok).toBe(false);
    expect(a._schSetPay(x, me, { hourly: 320, dutyPay: { D: 1200, N: "" } })).toEqual({ ok: true });
    expect(JSON.parse(x.pay.json).e1).toEqual({ hourly: 320, dutyPay: { D: 1200 } });
    expect((a._schSetPay(x, null, {}) as { ok: boolean }).ok).toBe(false);
  });
});
