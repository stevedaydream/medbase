import { describe, it, expect, beforeAll } from "vitest";
import { handleBot, BotError } from "../bot";
import { signLinkCode, verifyLinkCode, LINK_TTL_MS } from "../_lib/linkCode";
import { swapNotice } from "../swap";

beforeAll(() => { process.env.TOKEN_SECRET = "x".repeat(40); });

const header = ["姓名", ...Array.from({ length: 31 }, (_, i) => `${i + 1}日`)];
const row = (name: string, shifts: Record<number, string>) => [name, ...Array.from({ length: 31 }, (_, i) => shifts[i + 1] ?? "")];

/** 假 GAS：已發布班表（依群組＋月份）、people、版本 */
function fakeGas() {
  const sheets: Record<string, string[][]> = {
    "9A9B/202611": [header, row("甲", { 1: "D", 30: "N" }), row("乙", { 1: "N" }), row("丙", {})],
    "9A9B/202612": [header, row("甲", { 1: "OFF" })],
  };
  const people = [
    { id: "a", name: "甲", his: "1001", unit: "9A", active: true },
    { id: "b", name: "乙", his: "1002", group: "ICU", active: true },
    { id: "c", name: "丙", his: "1003", unit: "9B", active: false },
  ];
  const calls: Record<string, unknown>[] = [];
  const gas = async (b: Record<string, unknown>) => {
    calls.push(b);
    switch (b.action) {
      case "getSchedule": {
        const s = sheets[`${b.group}/${String(b.sheetName).slice(9)}`];
        return s ? { ok: true, data: s } : { ok: false, error: "班表分頁不存在" };
      }
      case "schGet": return { ok: true, docs: [{ key: "people", version: "v1", json: JSON.stringify(people) }] };
      case "schList": return { ok: true, docs: [{ key: "people", version: "v1" }], sheets: { Schedule_202611: "t1" } };
      case "getNpDutyMonths": return { ok: true, data: { "2026-11": { version: "x", rows: [
        { month: "2026-11", duty_date: "2026-11-01", ward: "9A", np_name: "甲", extension: "62855", shift: "白八" },
        { month: "2026-11", duty_date: "2026-11-01", ward: "總值", np_name: "王醫師", extension: "", shift: "" },
        { month: "2026-11", duty_date: "2026-11-02", ward: "9A", np_name: "乙", extension: "62855", shift: "夜八" },
        { month: "2026-11", duty_date: "2026-11-01", ward: "9B", np_name: "", extension: "", shift: "白八" },
      ] } } };
      case "readTable": return { ok: true, rows: [
        { name: "王 醫師", his_account: " 10586 ", ext: "61350", password: "x" },
        { name: "甲", his_account: "2001" },
      ] };
      default: return { ok: false, error: "?" };
    }
  };
  return { gas, calls };
}

describe("/api/bot", () => {
  it("attendingRoster：只回主治姓名、科別與職稱，保留同名不同科，排除敏感欄位", async () => {
    const calls: Record<string, unknown>[] = [];
    const result = await handleBot({ action: "attendingRoster" }, async body => {
      calls.push(body);
      return { ok: true, rows: [
        { name: "王 甲", department: "骨科", title: "主治醫師", his_account: "123", his_password: "secret", ext: "12345", notes: "private" },
        { name: "王甲", department: "骨科", title: "主治醫師" },
        { name: "王甲", department: "泌尿科", title: "VS" },
        { name: "乙", department: "骨科", title: "專科護理師" },
        { name: "丙", department: "骨科", title: "住院醫師" },
        { name: "丁", department: "骨科", title: "" },
        { name: "", department: "骨科", title: "主治醫師" },
      ] };
    });
    expect(calls).toEqual([{ action: "readTable", table: "physicians" }]);
    expect(result).toEqual({ ok: true, items: expect.arrayContaining([
      { name: "王甲", department: "骨科", title: "主治醫師" },
      { name: "王甲", department: "泌尿科", title: "VS" },
    ]) });
    expect((result.items as unknown[]).length).toBe(2);
  });

  it("attendingRoster：來源失敗或格式錯誤不會當成空名單", async () => {
    await expect(handleBot({ action: "attendingRoster" }, async () => ({ ok: false, error: "secret" }))).rejects.toThrow("讀取主治醫師名單失敗");
    await expect(handleBot({ action: "attendingRoster" }, async () => ({ ok: true, rows: null }))).rejects.toThrow("主治醫師名單格式錯誤");
  });

  it("day：只回該日有班的人，預設群組 9A9B", async () => {
    const { gas, calls } = fakeGas();
    expect(await handleBot({ action: "day", date: "2026-11-01" }, gas)).toEqual({
      ok: true, date: "2026-11-01", group: "9A9B", published: true,
      items: [{ name: "甲", shift: "D" }, { name: "乙", shift: "N" }],
    });
    expect(calls[0]).toEqual({ action: "getSchedule", sheetName: "Schedule_202611", group: "9A9B" });
  });

  it("day：尚未發布的月份回 published=false", async () => {
    const { gas } = fakeGas();
    expect(await handleBot({ action: "day", date: "2027-01-05" }, gas)).toMatchObject({ published: false, items: [] });
  });

  it("day：日期與群組格式檢查", async () => {
    const { gas } = fakeGas();
    await expect(handleBot({ action: "day", date: "2026-02-30" }, gas)).rejects.toBeInstanceOf(BotError);
    await expect(handleBot({ action: "day", date: "2026-11-01", group: "../x" }, gas)).rejects.toBeInstanceOf(BotError);
  });

  it("person：跨月讀兩張班表，依 HIS 找姓名", async () => {
    const { gas } = fakeGas();
    const r = await handleBot({ action: "person", his: "1001", from: "2026-11-30", to: "2026-12-01" }, gas);
    expect(r).toEqual({
      ok: true, found: true, name: "甲", group: "9A9B",
      days: [{ date: "2026-11-30", published: true, shift: "N" }, { date: "2026-12-01", published: true, shift: "OFF" }],
    });
  });

  it("person：停用或不在名單回 found=false；區間超過 31 天拒絕", async () => {
    const { gas } = fakeGas();
    expect(await handleBot({ action: "person", his: "1003", from: "2026-11-01", to: "2026-11-02" }, gas)).toEqual({ ok: true, found: false, days: [] });
    await expect(handleBot({ action: "person", his: "1001", from: "2026-11-01", to: "2026-12-05" }, gas)).rejects.toBeInstanceOf(BotError);
  });

  it("duty：NP／VS 值班表該日的列，略過沒有姓名的格；只有 VS 總值附 HIS 帳號", async () => {
    const { gas, calls } = fakeGas();
    expect(await handleBot({ action: "duty", date: "2026-11-01" }, gas)).toEqual({
      ok: true, date: "2026-11-01",
      items: [{ ward: "9A", shift: "白八", name: "甲", extension: "62855" }, { ward: "總值", shift: "", name: "王醫師", extension: "", his: "10586" }],
    });
    expect(calls[0]).toEqual({ action: "getNpDutyMonths", months: ["2026-11"] });
    expect(calls[1]).toEqual({ action: "readTable", table: "physicians" });
  });

  it("duty：通訊錄讀不到時照常回值班表", async () => {
    const { gas } = fakeGas();
    const failing = async (b: Record<string, unknown>) => b.action === "readTable" ? { ok: false, error: "x" } : gas(b);
    const r = await handleBot({ action: "duty", date: "2026-11-01" }, failing);
    expect(r.items[1]).toEqual({ ward: "總值", shift: "", name: "王醫師", extension: "" });
  });

  it("versions：只回班表分頁版本", async () => {
    const { gas } = fakeGas();
    expect(await handleBot({ action: "versions", group: "9A9B" }, gas)).toEqual({ ok: true, group: "9A9B", sheets: { Schedule_202611: "t1" } });
  });

  it("redeem：綁定碼換出 HIS、姓名與群組；舊資料依單位歸預設群組", async () => {
    const { gas } = fakeGas();
    const code = await signLinkCode("1001");
    expect(await handleBot({ action: "redeem", code }, gas)).toEqual({ ok: true, his: "1001", name: "甲", group: "9A9B" });
    const code2 = await signLinkCode("1002");
    expect(await handleBot({ action: "redeem", code: code2 }, gas)).toMatchObject({ name: "乙", group: "ICU" });
  });

  it("redeem：過期、竄改、不在名單都拒絕", async () => {
    const { gas } = fakeGas();
    const old = await signLinkCode("1001", Date.now() - LINK_TTL_MS - 1000);
    await expect(handleBot({ action: "redeem", code: old }, gas)).rejects.toThrow(/過期/);
    const [body, sig] = (await signLinkCode("1001")).split(".");
    await expect(handleBot({ action: "redeem", code: `${body}x.${sig}` }, gas)).rejects.toBeInstanceOf(BotError);
    await expect(handleBot({ action: "redeem", code: await signLinkCode("9999") }, gas)).rejects.toThrow(/不在排班名單/);
  });

  it("redeem：已登入的通訊錄人員即使沒有排班身分也能綁定自費查詢", async () => {
    const { gas } = fakeGas();
    expect(await handleBot({ action: "redeem", code: await signLinkCode("10586") }, gas)).toEqual({
      ok: true, his: "10586", name: "王 醫師", group: "",
    });
  });

  it("不在白名單的 action 一律拒絕", async () => {
    const { gas, calls } = fakeGas();
    await expect(handleBot({ action: "schPut" }, gas)).rejects.toBeInstanceOf(BotError);
    expect(calls).toEqual([]);
  });
});

describe("綁定碼", () => {
  it("登入憑證不能當綁定碼用（用途字首不同）", async () => {
    const code = await signLinkCode("1001");
    expect(await verifyLinkCode(code)).toBe("1001");
    expect(await verifyLinkCode("abc.def")).toBeNull();
  });
});

describe("換班 LINE 通知內容", () => {
  const people = [{ id: "a", name: "甲", his: "1001" }, { id: "b", name: "乙", his: "1002" }, { id: "c", name: "丙" }];
  const req = { id: "r1", ym: "202611", kind: "same", a: "a", b: "b", give: [10], take: [10], days: [{ day: 10, aCode: "D", bCode: "N" }], note: "家裡有事", warnings: [], status: "pending", at: "" } as never;

  it("申請通知對方、回覆通知申請人", () => {
    expect(swapNotice("swap_request", req, people)).toMatchObject({ toHis: "1002", ym: "202611" });
    expect(swapNotice("swap_request", req, people)!.text).toMatch(/甲 向你提出換班（11 月 10 日）\n備註：家裡有事/);
    expect(swapNotice("swap_accepted", req, people)).toMatchObject({ toHis: "1001" });
    expect(swapNotice("swap_rejected", req, people)!.text).toMatch(/乙 婉拒/);
    expect(swapNotice("swap_cancelled", req, people)).toMatchObject({ toHis: "1002" });
  });

  it("對方沒有 HIS 帳號就不通知", () => {
    expect(swapNotice("swap_request", { ...(req as object), b: "c" } as never, people)).toBeNull();
    expect(swapNotice("swap_request", undefined, people)).toBeNull();
  });
});
