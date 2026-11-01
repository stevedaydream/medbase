import { expect, it } from "vitest";
import { parseDutyPdfPages, type PositionedText } from "./npDutyPdfLayout";

const item = (text: string, x: number, top: number): PositionedText => ({ text, x, top });
function calendar(first: number, last: number, gap = 16, raised = 0) {
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const top = 190 + i * gap;
    return [item(String(first + i), 35, top), item("一", 60, top),
      item("ⓕ／ⓛ", 80, top), item("C", 114, top), item("f/l", 140, top),
      item("18", 235, top), item("18", 270, top), item("1", 309, top - raised), item("10/13", 534, top)];
  }).flat();
}
function specialties(top: number) {
  return [item("GS", 45, top), item("Trauma", 467, top),
    item("1.張測試", 22, top + 15), item("10.張測試", 427, top + 15), item("13.張測試", 485, top + 15)];
}
function people(top: number) {
  return [item("VS", 22, top), item("SA(OR)", 165, top), item("NP", 292, top), item("NP(SICU)", 417, top),
    item("18.張測試61001", 33, top + 20),
    item("○", 303, top + 20), item("f .", 306, top + 20), item("王小明", 320, top + 20), item("62001", 355, top + 20),
    item("ⓛ.李小美62002", 303, top + 35), item("Ｃ.陳測試62003", 303, top + 50),
    item("ⓕ.其他人62999", 430, top + 20)];
}
const title = item("115年11月份外科值班表", 30, 30);

it("supports the two-page layout and keeps circled letters, NP/ICU rosters and specialty numbers separate", () => {
  const result = parseDutyPdfPages([[title, ...calendar(1, 30)], [...specialties(50), ...people(200)]], "2026-10");
  expect(result.errors).toEqual([]);
  expect(result.rows).toHaveLength(300);
  expect(result.rows.every(row => row.resolution === "file")).toBe(true);
  expect(result.rows.find(row => row.ward === "9A" && row.staffCode === "f"))
    .toMatchObject({ dutyDate: "2026-11-01", npName: "王小明", extension: "62001", shift: "白八" });
  expect(result.rows.find(row => row.ward === "9B")).toMatchObject({ staffCode: "c", npName: "陳測試", shift: "值班" });
});

it("supports calendars spanning two pages with rosters on pages two and three, including raised cell baselines", () => {
  const result = parseDutyPdfPages([[title, ...calendar(1, 17, 30, 10)],
    [...calendar(18, 30, 30, 10), ...specialties(600)], people(50)], "2026-10");
  expect(result.errors).toEqual([]);
  expect(result.rows).toHaveLength(300);
  expect(result.rows.every(row => row.resolution === "file")).toBe(true);
  expect(result.rows.filter(row => row.ward === "GS")).toHaveLength(30);
});

it("blocks incomplete or duplicated calendar pages", () => {
  expect(parseDutyPdfPages([[title, ...calendar(1, 17)], people(50)], "2026-11").errors.join(" ")).toContain("17/30");
  expect(parseDutyPdfPages([[title, ...calendar(1, 30)], calendar(1, 1), people(50)], "2026-11").errors.join(" ")).toContain("重複");
});

it("preserves the night shift when the day shift is empty, and flags unknown symbols for correction", () => {
  const cells = calendar(1, 30).map(i => i.x === 80 ? { ...i, text: "/ⓛ" } : i.x === 140 ? { ...i, text: "�" } : i);
  const result = parseDutyPdfPages([[title, ...cells], people(50)], "2026-11");
  expect(result.rows.find(row => row.ward === "9A")).toMatchObject({ staffCode: "l", shift: "夜八" });
  expect(result.rows.find(row => row.ward === "8A")).toMatchObject({ staffCode: "�", resolution: "unresolved" });
});
