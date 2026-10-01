import { describe, it, expect } from "vitest";
import {
  parseTable, formatTable, splitRow, displayWidth, newTable, insertRow, deleteRow, insertCol, deleteCol, setAlign,
  cellAt, cellOffset,
} from "./table";

const SRC = "| 班別 | 時間 | 備註 |\n| :--- | :---: | ---: |\n| D | 08–16 | 白班 |\n| E | 16–24 | **小夜** |";

describe("表格解析", () => {
  it("表頭、對齊、資料列", () => {
    const t = parseTable(SRC)!;
    expect(t.header).toEqual(["班別", "時間", "備註"]);
    expect(t.aligns).toEqual(["left", "center", "right"]);
    expect(t.rows[1]).toEqual(["E", "16–24", "**小夜**"]);
  });
  it("跳脫與行內程式碼裡的 | 不切欄", () => {
    expect(splitRow("| a \\| b | `x|y` | c |")).toEqual(["a \\| b", "`x|y`", "c"]);
  });
  it("沒有分隔列不是表格；欄數不足補空白", () => {
    expect(parseTable("| a |\n| b |")).toBeNull();
    expect(parseTable("| a | b |\n|---|---|\n| 1 |")!.rows[0]).toEqual(["1", ""]);
  });
});

describe("表格排版", () => {
  it("中文寬度算 2，欄位對齊", () => {
    expect(displayWidth("班別A")).toBe(5);
    const out = formatTable(parseTable(SRC)!).split("\n");
    expect(new Set(out.map(l => displayWidth(l))).size).toBe(1);
    expect(out[1]).toMatch(/^\| :-+ \| :-+: \| -+: \|$/);
  });
  it("排版後再解析內容不變", () => {
    const t = parseTable(SRC)!;
    expect(parseTable(formatTable(t))).toEqual(t);
  });
});

describe("表格操作", () => {
  const t = parseTable(SRC)!;
  it("增刪列", () => {
    expect(insertRow(t, -1).rows[0]).toEqual(["", "", ""]);
    expect(insertRow(t, 1).rows.length).toBe(3);
    expect(deleteRow(t, 0).rows.map(r => r[0])).toEqual(["E"]);
    expect(deleteRow(t, 9)).toBe(t);
  });
  it("增刪欄、至少留一欄", () => {
    const a = insertCol(t, 0);
    expect(a.header).toEqual(["班別", "", "時間", "備註"]);
    expect(a.aligns[1]).toBeNull();
    expect(deleteCol(t, 1).header).toEqual(["班別", "備註"]);
    expect(deleteCol(newTable(1, 1), 0).header.length).toBe(1);
  });
  it("對齊", () => {
    expect(setAlign(t, 0, "right").aligns[0]).toBe("right");
  });
  it("游標位置與儲存格互換", () => {
    const f = formatTable(t);
    const off = cellOffset(f, 1, 2);
    expect(f.slice(off).startsWith("**小夜**")).toBe(true);
    expect(cellAt(f, off)).toEqual({ row: 1, col: 2 });
    expect(cellAt(f, 3)).toEqual({ row: -1, col: 0 });
  });
});
