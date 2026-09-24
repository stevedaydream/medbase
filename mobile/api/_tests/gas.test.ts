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
});
