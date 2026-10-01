import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";

/** 專注模式：游標所在的最上層區塊（段落、清單、表格…）以外的行變淡 */
const dim = Decoration.line({ class: "cm-md-dim" });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const head = state.selection.main.head;
  let from = state.doc.lineAt(head).from, to = state.doc.lineAt(head).to;
  const top = syntaxTree(state).topNode;
  for (let n = top.firstChild; n; n = n.nextSibling) {
    if (n.from <= head && n.to >= head) { from = n.from; to = n.to; break; }
  }
  const out: Range<Decoration>[] = [];
  for (const r of view.visibleRanges) {
    for (let p = r.from; p <= r.to;) {
      const l = state.doc.lineAt(p);
      if (l.to < from || l.from > to) out.push(dim.range(l.from));
      p = l.to + 1;
    }
  }
  return Decoration.set(out);
}

export const focusMode = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view);
  }
}, { decorations: v => v.decorations });
