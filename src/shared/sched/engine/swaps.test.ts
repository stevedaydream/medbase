import { describe, it, expect } from "vitest";
import { swapAdjust, targetsWithSwaps, settleDebts } from "./swaps";
import { DEFAULT_QUOTA_ITEMS, emptyMonth, type MonthDoc, type SwapRec } from "../types";

const sw = (day: number, a: string, aCode: string, b: string, bCode: string): SwapRec =>
  ({ id: `${day}${a}${b}`, day, a, b, aCode, bCode, at: "", by: "", note: "" });
const month = (ym: string, swaps: SwapRec[]): MonthDoc => ({ ...emptyMonth(ym), swaps });

describe("換班", () => {
  it("同日互換：甲 D↔乙 OFF → 甲 D−1 OFF+1、乙相反", () => {
    const m = month("202611", [sw(3, "a", "D", "b", "OFF")]);
    expect(swapAdjust(m, DEFAULT_QUOTA_ITEMS)).toEqual({ a: { D: -1, OFF: 1 }, b: { D: 1, OFF: -1 } });
    expect(targetsWithSwaps({ a: { D: 4, OFF: 10 }, b: { D: 4, OFF: 10 } }, m, DEFAULT_QUOTA_ITEMS))
      .toEqual({ a: { D: 3, OFF: 11 }, b: { D: 5, OFF: 9 } });
  });
  it("週六互換也調整週六 OFF", () => {
    const m = month("202611", [sw(7, "a", "OFF", "b", "N")]); // 11/7 週六
    expect(swapAdjust(m, DEFAULT_QUOTA_ITEMS).a).toEqual({ N: 1, OFF: -1, W6OFF: -1 });
  });

  it("當月一來一往抵銷，不產生欠班", () => {
    const m = month("202611", [sw(3, "a", "D", "b", "S1"), sw(10, "a", "S1", "b", "D")]);
    expect(settleDebts([], m, DEFAULT_QUOTA_ITEMS)).toEqual([]);
  });

  it("未抵銷成為欠班，下個月反向換班時還清", () => {
    const m1 = month("202611", [sw(3, "a", "D", "b", "S1")]); // 乙替甲上 D → 甲欠乙 1 D
    const d1 = settleDebts([], m1, DEFAULT_QUOTA_ITEMS);
    expect(d1.map(d => `${d.from}->${d.to} ${d.item}×${d.qty}`)).toEqual(["a->b D×1"]);
    const m2 = month("202612", [sw(5, "a", "S1", "b", "D")]); // 甲替乙上 D
    const d2 = settleDebts(d1, m2, DEFAULT_QUOTA_ITEMS);
    expect(d2.length).toBe(1);
    expect(d2[0].qty).toBe(0);
    expect(d2[0].settledAt).toBeTruthy();
  });
});
