import { describe, it, expect } from "vitest";
import { RULES } from "../gas";

const user = { his: "111", name: "甲", fp: "x", exp: 0 };
const ok = (action: string, args: Record<string, unknown>) => {
  const r = RULES[action].build(args, user);
  return r instanceof Response ? null : r;
};

describe("/api/gas 白名單（排班 v3）", () => {
  it("舊預約 action 已移除", () => {
    expect(RULES.saveRequest).toBeUndefined();
    expect(RULES.getRequests).toBeUndefined();
  });
  it("schGet 只接受排班文件名稱", () => {
    expect(ok("schGet", { keys: ["prebook:202612", "est:202612", "people", "log:global"] })).toEqual({ keys: ["prebook:202612", "est:202612", "people", "log:global"] });
    expect(ok("schGet", { keys: ["Physicians"] })).toBeNull();
    expect(ok("schGet", { keys: [] })).toBeNull();
  });
  it("schPut 檢查 key 與 json", () => {
    expect(ok("schPut", { items: [{ key: "month:202612", json: "{}", base: null }] })).toEqual({ items: [{ key: "month:202612", json: "{}", base: null }] });
    expect(ok("schPut", { items: [{ key: "evil", json: "{}" }] })).toBeNull();
    expect(ok("schPut", { items: [{ key: "people", json: { a: 1 } }] })).toBeNull();
  });
  it("mobileSetPrebook 只轉必要欄位，身分不採用手機值", () => {
    expect(ok("mobileSetPrebook", { ym: "202612", cells: [{ day: 3, v: "OFF", personId: "someone" }], personId: "x" }))
      .toEqual({ ym: "202612", cells: [{ day: 3, v: "OFF" }] });
    expect(ok("mobileSetPrebook", { ym: "2026-12", cells: [] })).toBeNull();
  });
  it("getConfig 不再回傳預約設定", () => {
    const filtered = RULES.getConfig.filter!({ ok: true, data: { booking_open: "true", np_duty_url: "u", api_key: "k" } });
    expect(filtered.data).toEqual({ np_duty_url: "u" });
  });
  it("假勤：只接受自己的加班、期初餘額、薪資設定欄位（ADR-027）", () => {
    expect(ok("schGet", { keys: ["leaveOpen", "overtime:202612"] })).toEqual({ keys: ["leaveOpen", "overtime:202612"] });
    expect(ok("schGet", { keys: ["pay"] })).toBeNull();
    expect(ok("mobileSetOvertime", { ym: "202612", day: 3, hours: "2", note: "手術", personId: "x" }))
      .toEqual({ ym: "202612", op: "add", day: 3, hours: 2, note: "手術" });
    expect(ok("mobileSetOvertime", { ym: "2026-12" })).toBeNull();
    expect(ok("mobileSetPay", { pay: { hourly: "300", dutyPay: { D: 1000, N: "" } } }))
      .toEqual({ pay: { hourly: 300, dutyPay: { D: 1000 } } });
    // 指定對象只轉給 GAS，是否為 super 由 GAS 判斷
    expect(ok("mobileGetPay", { personId: "p2" })).toEqual({ personId: "p2" });
  });
  it("setMobileAccess 只轉權限表三欄（是否為管理者由 GAS 判斷）", () => {
    expect(ok("setMobileAccess", { matrix: { doctor: ["sets"], nurse: "x", evil: ["a"] }, admin: true }))
      .toEqual({ matrix: { doctor: ["sets"], np: [], nurse: [] } });
    expect(ok("mobileMe", { his: "999" })).toEqual({});
  });
});
