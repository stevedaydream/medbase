import { describe, it, expect } from "vitest";
import { basalBolusFromPrn } from "./clinicalCalc";

describe("需要時短效 → basal-bolus", () => {
  const base = { hours: 24, basalRatio: 0.5, factor: 0.8, npo: false, highRisk: false };
  it("8+10+4+6＝28 U，打 8 折 → 22.4 U：長效 11 U、三餐各 4 U", () => {
    const r = basalBolusFromPrn({ ...base, doses: [8, 10, 4, 6] })!;
    expect([r.total, r.tdd, r.basal, r.bolusEach]).toEqual([28, 22.4, 11, 4]);
  });
  it("60/40：長效 13 U、三餐各 3 U", () => {
    const r = basalBolusFromPrn({ ...base, basalRatio: 0.6, doses: [8, 10, 4, 6] })!;
    expect([r.basal, r.bolusEach]).toEqual([13, 3]);
  });
  it("12 小時的量換算成 24 小時；沒進食只給長效；U/kg 過高提醒", () => {
    const r = basalBolusFromPrn({ ...base, hours: 12, doses: [8, 6], npo: true, weight: 40 })!;
    expect(r.per24).toBe(28);
    expect(r.bolusEach).toBe(0);
    expect(r.basal).toBe(11);
    expect(r.notes.some(n => n.text.includes("高於常用"))).toBe(true);
    expect(basalBolusFromPrn({ ...base, doses: ["", 0] })).toBeNull();
  });
});
