/**
 * GFM 表格的原文處理：解析、排版、增刪列欄、對齊。
 * 編輯器的表格指令都是「解析 → 改模型 → 重新排版」後整塊取代原文。
 */
export type Align = "left" | "center" | "right" | null;
export interface TableModel { header: string[]; aligns: Align[]; rows: string[][] }

/** 依 | 切欄，略過跳脫的 \| 與行內程式碼裡的 | */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "", inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") { cur += "\\|"; i++; continue; }
    if (c === "`") inCode = !inCode;
    if (c === "|" && !inCode) { cells.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
export const isDelimiterRow = (line: string) => DELIM.test(line);

function parseAlign(cell: string): Align {
  const l = cell.startsWith(":"), r = cell.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

export function parseTable(text: string): TableModel | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map(parseAlign);
  const n = header.length;
  const fit = (cells: string[]) => Array.from({ length: n }, (_, i) => cells[i] ?? "");
  return {
    header,
    aligns: fit(aligns as unknown as string[]) as unknown as Align[],
    rows: lines.slice(2).map(l => fit(splitRow(l))),
  };
}

/** 顯示寬度：中日韓全形字算 2 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}

const pad = (s: string, w: number, a: Align) => {
  const gap = Math.max(0, w - displayWidth(s));
  if (a === "right") return " ".repeat(gap) + s;
  if (a === "center") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
  return s + " ".repeat(gap);
};

/** 排版成對齊的原文（每欄寬度一致） */
export function formatTable(t: TableModel): string {
  const n = t.header.length;
  const widths = Array.from({ length: n }, (_, i) =>
    Math.max(3, displayWidth(t.header[i] ?? ""), ...t.rows.map(r => displayWidth(r[i] ?? ""))));
  const row = (cells: string[]) => `| ${cells.map((c, i) => pad(c ?? "", widths[i], t.aligns[i])).join(" | ")} |`;
  const delim = `| ${widths.map((w, i) => {
    const a = t.aligns[i];
    const dashes = "-".repeat(Math.max(1, w - (a === "center" ? 2 : a ? 1 : 0)));
    return a === "center" ? `:${dashes}:` : a === "left" ? `:${dashes}` : a === "right" ? `${dashes}:` : dashes;
  }).join(" | ")} |`;
  return [row(t.header), delim, ...t.rows.map(row)].join("\n");
}

export function newTable(rows: number, cols: number): TableModel {
  return {
    header: Array.from({ length: cols }, (_, i) => `欄 ${i + 1}`),
    aligns: Array.from({ length: cols }, () => null),
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => "")),
  };
}

const clone = (t: TableModel): TableModel => ({ header: [...t.header], aligns: [...t.aligns], rows: t.rows.map(r => [...r]) });

/** row：-1 表示表頭；在 row 之後插入一列（表頭之後＝第一列資料） */
export function insertRow(t: TableModel, after: number): TableModel {
  const c = clone(t);
  c.rows.splice(after + 1, 0, Array.from({ length: c.header.length }, () => ""));
  return c;
}

export function deleteRow(t: TableModel, row: number): TableModel {
  if (row < 0 || row >= t.rows.length) return t;
  const c = clone(t);
  c.rows.splice(row, 1);
  return c;
}

export function insertCol(t: TableModel, after: number): TableModel {
  const c = clone(t);
  const at = after + 1;
  c.header.splice(at, 0, "");
  c.aligns.splice(at, 0, null);
  c.rows.forEach(r => r.splice(at, 0, ""));
  return c;
}

export function deleteCol(t: TableModel, col: number): TableModel {
  if (t.header.length <= 1 || col < 0 || col >= t.header.length) return t;
  const c = clone(t);
  c.header.splice(col, 1);
  c.aligns.splice(col, 1);
  c.rows.forEach(r => r.splice(col, 1));
  return c;
}

export function setAlign(t: TableModel, col: number, a: Align): TableModel {
  const c = clone(t);
  c.aligns[col] = a;
  return c;
}

/**
 * 游標在表格原文中的位置 → 第幾列、第幾欄。
 * row：-1 表頭、-2 分隔列、0 起為資料列。
 */
export function cellAt(text: string, offset: number): { row: number; col: number } {
  const before = text.slice(0, offset);
  const lineIdx = before.split("\n").length - 1;
  const lineStart = before.lastIndexOf("\n") + 1;
  const inLine = text.slice(lineStart, offset);
  const col = Math.max(0, (inLine.replace(/\\\|/g, "").match(/\|/g)?.length ?? 0) - (text.slice(lineStart).trimStart().startsWith("|") ? 1 : 0));
  const row = lineIdx === 0 ? -1 : lineIdx === 1 ? -2 : lineIdx - 2;
  return { row, col };
}

/** 排版後的原文中，第 row 列第 col 欄文字開頭的位置（指令完成後把游標放回去） */
export function cellOffset(formatted: string, row: number, col: number): number {
  const lines = formatted.split("\n");
  const lineIdx = row < 0 ? 0 : row + 2;
  let pos = 0;
  for (let i = 0; i < Math.min(lineIdx, lines.length - 1); i++) pos += lines[i].length + 1;
  const line = lines[Math.min(lineIdx, lines.length - 1)];
  let bars = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") {
      if (bars === col) return pos + i + 2;
      bars++;
    }
  }
  return pos + 2;
}
