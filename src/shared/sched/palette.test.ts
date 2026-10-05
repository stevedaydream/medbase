import { describe, it, expect } from "vitest";
import { textOn, isHexColor } from "./palette";

describe("自選班表顏色", () => {
  it("依底色亮度配黑或白字", () => {
    expect(textOn("#ffffff")).toBe("#111827");
    expect(textOn("#fde047")).toBe("#111827");
    expect(textOn("#1e3a5f")).toBe("#ffffff");
    expect(textOn("not-a-color")).toBe("#ffffff");
  });
  it("只接受 #rrggbb", () => {
    expect(isHexColor("#a1B2c3")).toBe(true);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#fff")).toBe(false);
  });
});
