import { describe, it, expect } from "vitest";
import { moveById } from "./useRowDrag";

describe("moveById", () => {
  const ids = () => ["a", "b", "c", "d"];
  it("插到指定列之前、放到最後、原地不動", () => {
    const l1 = ids(); expect(moveById(l1, x => x, "d", "b")).toBe(true); expect(l1).toEqual(["a", "d", "b", "c"]);
    const l2 = ids(); expect(moveById(l2, x => x, "a", null)).toBe(true); expect(l2).toEqual(["b", "c", "d", "a"]);
    const l3 = ids(); expect(moveById(l3, x => x, "b", "c")).toBe(false); expect(l3).toEqual(ids());
    const l4 = ids(); expect(moveById(l4, x => x, "z", "a")).toBe(false);
  });
});
