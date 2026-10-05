import { describe, it, expect } from "vitest";
import { holidayShort, dayMark } from "./holidayLabel";

describe("國定假日標記", () => {
  it("簡寫：對照表優先，其他取前 2 個字", () => {
    expect(holidayShort("國慶日")).toBe("國慶");
    expect(holidayShort("臺灣光復暨金門古寧頭大捷紀念日")).toBe("光復");
    expect(holidayShort("和平紀念日")).toBe("228");
    expect(holidayShort("原住民族日")).toBe("原住");
  });
  it("國定假日與春節區間標紅、補班日不標紅", () => {
    const h = { days: { "2026-10-10": "國慶日", "2027-02-05": "農曆除夕" }, workdays: ["2026-02-07"], cny: [{ from: "2027-02-04", to: "2027-02-10" }] };
    expect(dayMark(h, "2026-10-10")).toEqual({ label: "國慶", red: true });
    expect(dayMark(h, "2027-02-05")).toEqual({ label: "除夕", red: true });
    expect(dayMark(h, "2027-02-04")).toEqual({ label: "春節", red: true });
    expect(dayMark(h, "2026-02-07")).toEqual({ label: "補班", red: false });
    expect(dayMark(h, "2026-10-11")).toBeNull();
  });
});
