import { EditorSelection, type ChangeSpec } from "@codemirror/state";
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
