import { EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  parseTable, formatTable, newTable, insertRow, deleteRow, insertCol, deleteCol, setAlign, cellAt, cellOffset,
  type TableModel, type Align,
} from "@/shared/markdown/table";
import type { EditorView } from "@codemirror/view";

/** 工具列與快捷鍵共用的 Markdown 編輯指令：都直接改原文 */

/** 用符號包住選取文字；已包住時移除（粗體、斜體、刪除線、行內程式碼） */
export function toggleWrap(view: EditorView, mark: string): boolean {
  const { state } = view;
  const tr = state.changeByRange(range => {
    const before = state.sliceDoc(range.from - mark.length, range.from);
    const after = state.sliceDoc(range.to, range.to + mark.length);
    if (before === mark && after === mark) {
      return {
        changes: [{ from: range.from - mark.length, to: range.from }, { from: range.to, to: range.to + mark.length }],
        range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
      };
    }
    return {
      changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
      range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  view.focus();
  return true;
}

const BLOCK_PREFIX = /^(#{1,6} |> |[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;

/** 選取的每一行改成指定的行首（標題、清單、待辦、引用）；全部已是同樣行首時移除 */
export function setLinePrefix(view: EditorView, prefix: string | ((i: number) => string)): boolean {
  const { state } = view;
  const lines = new Map<number, { from: number; text: string }>();
  for (const r of state.selection.ranges) {
    for (let p = r.from; p <= r.to;) {
      const l = state.doc.lineAt(p);
      lines.set(l.from, { from: l.from, text: l.text });
      p = l.to + 1;
    }
  }
  const list = [...lines.values()].sort((a, b) => a.from - b.from);
  const want = (i: number) => (typeof prefix === "function" ? prefix(i) : prefix);
  const allSame = list.every((l, i) => want(i) !== "" && l.text.startsWith(want(i)));
  const changes: ChangeSpec[] = list.map((l, i) => {
    const cur = BLOCK_PREFIX.exec(l.text)?.[0] ?? "";
    return { from: l.from, to: l.from + cur.length, insert: allSame ? "" : want(i) };
  });
  view.dispatch({ changes, userEvent: "input", scrollIntoView: true });
  view.focus();
  return true;
}

export const setHeading = (view: EditorView, level: number) => setLinePrefix(view, level ? "#".repeat(level) + " " : "");
export const toggleBullet = (view: EditorView) => setLinePrefix(view, "- ");
export const toggleOrdered = (view: EditorView) => setLinePrefix(view, i => `${i + 1}. `);
export const toggleTask = (view: EditorView) => setLinePrefix(view, "- [ ] ");
export const toggleQuote = (view: EditorView) => setLinePrefix(view, "> ");

/** 插入連結：有選取文字時當作連結文字，游標停在網址 */
export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to) || "連結文字";
  const insert = `[${text}](https://)`;
  const urlFrom = r.from + text.length + 3;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: EditorSelection.range(urlFrom, urlFrom + "https://".length),
    userEvent: "input",
  });
  view.focus();
  return true;
}

/** 在游標所在行之後插入分隔線 */
export function insertHr(view: EditorView): boolean {
  const l = view.state.doc.lineAt(view.state.selection.main.head);
  const insert = (l.text.trim() ? "\n\n" : "\n") + "---\n";
  view.dispatch({
    changes: { from: l.to, insert },
    selection: EditorSelection.cursor(l.to + insert.length),
    userEvent: "input",
  });
  view.focus();
  return true;
}

// ── 區塊插入 ─────────────────────────────────────────────────────

/** 在游標所在行之後插入一段區塊（前後補空行），游標放到 cursorAt（相對區塊開頭） */
function insertBlock(view: EditorView, block: string, cursorAt = block.length): boolean {
  const { state } = view;
  const l = state.doc.lineAt(state.selection.main.head);
  const empty = !l.text.trim();
  const from = empty ? l.from : l.to;
  const before = empty ? (l.number > 1 && state.doc.line(l.number - 1).text.trim() ? "\n" : "") : "\n\n";
  const after = "\n";
  view.dispatch({
    changes: { from, to: empty ? l.to : from, insert: before + block + after },
    selection: EditorSelection.cursor(from + before.length + cursorAt),
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function insertTable(view: EditorView, rows = 2, cols = 3): boolean {
  const text = formatTable(newTable(rows, cols));
  return insertBlock(view, text, 2);
}

export const insertMathBlock = (view: EditorView) => insertBlock(view, "$$\n\n$$", 3);
export const insertCodeBlock = (view: EditorView, lang = "") => insertBlock(view, "```" + lang + "\n\n```", 4 + lang.length);
export const insertMermaid = (view: EditorView) => insertBlock(view, "```mermaid\ngraph TD\n  A[開始] --> B[結束]\n```", 11);
export const insertToc = (view: EditorView) => insertBlock(view, "[TOC]");
export const insertPageBreak = (view: EditorView) => insertBlock(view, "<!-- pagebreak -->");

/** 行內公式：包住選取文字 */
export const toggleInlineMath = (view: EditorView) => toggleWrap(view, "$");

/** 註腳：在游標處插入 [^n]，文件結尾加上定義，游標停在定義內文 */
export function insertFootnote(view: EditorView): boolean {
  const { state } = view;
  const used = [...state.doc.toString().matchAll(/\[\^(\d+)\]/g)].map(m => Number(m[1]));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  const pos = state.selection.main.head;
  const ref = `[^${n}]`;
  const end = state.doc.length;
  const tail = state.doc.sliceString(Math.max(0, end - 2), end);
  const def = `${tail.endsWith("\n\n") ? "" : tail.endsWith("\n") ? "\n" : "\n\n"}[^${n}]: `;
  view.dispatch({
    changes: [{ from: pos, insert: ref }, { from: end, insert: def }],
    selection: EditorSelection.cursor(end + ref.length + def.length),
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** 插入圖片語法（路徑由呼叫端決定，例如檔案選擇後存到附件資料夾） */
export function insertImage(view: EditorView, path: string, alt = ""): boolean {
  const r = view.state.selection.main;
  const text = `![${alt || view.state.sliceDoc(r.from, r.to)}](${/\s/.test(path) ? `<${path}>` : path})`;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: EditorSelection.cursor(r.from + text.length), userEvent: "input" });
  view.focus();
  return true;
}

// ── 表格操作 ─────────────────────────────────────────────────────

type TableOp = (t: TableModel, cell: { row: number; col: number }) => { table: TableModel; row: number; col: number };

/** 游標所在的表格範圍（整行） */
export function tableAt(state: EditorState, pos = state.selection.main.head): { from: number; to: number } | null {
  let node = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === "Table") return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to };
  }
  node = syntaxTree(state).resolveInner(pos, 1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === "Table") return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to };
  }
  return null;
}

function runTableOp(view: EditorView, op: TableOp): boolean {
  const { state } = view;
  const range = tableAt(state);
  if (!range) return false;
  const text = state.sliceDoc(range.from, range.to);
  const model = parseTable(text);
  if (!model) return false;
  const cell = cellAt(text, state.selection.main.head - range.from);
  const r = op(model, { row: cell.row === -2 ? -1 : cell.row, col: Math.min(cell.col, model.header.length - 1) });
  const out = formatTable(r.table);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: out },
    selection: EditorSelection.cursor(range.from + cellOffset(out, r.row, r.col)),
    userEvent: "input",
  });
  view.focus();
  return true;
}

export const tableAddRow = (v: EditorView) => runTableOp(v, (t, c) => ({ table: insertRow(t, c.row), row: c.row + 1, col: c.col }));
export const tableDelRow = (v: EditorView) => runTableOp(v, (t, c) => ({ table: deleteRow(t, c.row), row: Math.min(c.row, t.rows.length - 2), col: c.col }));
export const tableAddCol = (v: EditorView) => runTableOp(v, (t, c) => ({ table: insertCol(t, c.col), row: c.row, col: c.col + 1 }));
export const tableDelCol = (v: EditorView) => runTableOp(v, (t, c) => ({ table: deleteCol(t, c.col), row: c.row, col: Math.max(0, c.col - 1) }));
export const tableAlign = (v: EditorView, a: Align) => runTableOp(v, (t, c) => ({ table: setAlign(t, c.col, a), row: c.row, col: c.col }));
export const tableFormat = (v: EditorView) => runTableOp(v, (t, c) => ({ table: t, row: c.row, col: c.col }));

/** Tab／Shift+Tab 在表格儲存格間移動（到最後一格時新增一列） */
export function tableNextCell(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const range = tableAt(state);
  if (!range) return false;
  return runTableOp(view, (t, c) => {
    let { row, col } = c;
    col += dir;
    if (col >= t.header.length) { col = 0; row++; }
    if (col < 0) { col = t.header.length - 1; row--; }
    if (row < -1) return { table: t, row: -1, col: 0 };
    if (row >= t.rows.length) return { table: insertRow(t, t.rows.length - 1), row, col };
    return { table: t, row, col };
  });
}
