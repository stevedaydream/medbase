import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";

/**
 * 即時排版（Typora 風格）：內容永遠是 Markdown 原文，只用裝飾改變顯示。
 * 游標所在的元素顯示語法符號；其餘位置隱藏符號，只留排版後的樣子。
 */

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = "•";
    return s;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(o: TaskWidget) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", e => e.preventDefault());
    box.addEventListener("click", e => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() { return false; }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const line = (cls: string) => Decoration.line({ class: cls });

/** 選取範圍是否碰到 [from, to]（含邊界：游標停在元素旁邊也算正在編輯） */
function touches(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some(r => r.from <= to && r.to >= from);
}

function lineTouched(state: EditorState, pos: number) {
  const l = state.doc.lineAt(pos);
  return touches(state, l.from, l.to);
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const doc = state.doc;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node: SyntaxNodeRef) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          out.push(line(`cm-md-h cm-md-h${heading[1]}`).range(doc.lineAt(node.from).from));
          return;
        }
        switch (name) {
          case "HeaderMark": {
            const parent = node.node.parent;
            if (parent && /^ATXHeading/.test(parent.name) && !lineTouched(state, node.from)) {
              // 連同標記後的空白一起隱藏
              const end = Math.min(node.to + 1, doc.lineAt(node.from).to);
              out.push(hide.range(node.from, end));
            }
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark": {
            const parent = node.node.parent;
            if (!parent || parent.name === "FencedCode") return;
            if (!touches(state, parent.from, parent.to)) out.push(hide.range(node.from, node.to));
            return;
          }
          case "Link": {
            if (touches(state, node.from, node.to)) return;
            const marks = node.node.getChildren("LinkMark");
            // [文字](網址)：隱藏「[」與「](網址)」
            if (marks.length >= 2 && doc.sliceString(marks[0].from, marks[0].to) === "[") {
              out.push(hide.range(marks[0].from, marks[0].to));
              out.push(hide.range(marks[1].from, node.to));
            }
            return false;
          }
          case "Blockquote": {
            for (let p = node.from; p <= node.to;) {
              const l = doc.lineAt(p);
              out.push(line("cm-md-quote").range(l.from));
              p = l.to + 1;
            }
            return;
          }
          case "QuoteMark": {
            if (!lineTouched(state, node.from)) {
              const l = doc.lineAt(node.from);
              const end = doc.sliceString(node.to, node.to + 1) === " " && node.to + 1 <= l.to ? node.to + 1 : node.to;
              out.push(hide.range(node.from, end));
            }
            return;
          }
          case "ListMark": {
            const item = node.node.parent;
            const list = item?.parent;
            const isTask = !!item?.getChild("Task");
            if (lineTouched(state, node.from)) return;
            if (isTask) {
              // 待辦項目只留核取方塊
              const end = Math.min(node.to + 1, doc.lineAt(node.from).to);
              out.push(hide.range(node.from, end));
            } else if (list?.name === "BulletList") {
              out.push(bullet.range(node.from, node.to));
            }
            return;
          }
          case "TaskMarker": {
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            out.push(Decoration.replace({ widget: new TaskWidget(checked, node.from) }).range(node.from, node.to));
            if (checked) {
              const l = doc.lineAt(node.from);
              out.push(Decoration.mark({ class: "cm-md-done" }).range(node.to, l.to));
            }
            return;
          }
          case "HorizontalRule": {
            const l = doc.lineAt(node.from);
            out.push(line("cm-md-hr").range(l.from));
            if (!lineTouched(state, node.from)) out.push(hide.range(node.from, node.to));
            return;
          }
          case "FencedCode":
          case "CodeBlock": {
            for (let p = node.from; p <= node.to;) {
              const l = doc.lineAt(p);
              out.push(line("cm-md-codeblock").range(l.from));
              p = l.to + 1;
            }
            return;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  tree = null as unknown;
  constructor(view: EditorView) {
    this.decorations = build(view);
    this.tree = syntaxTree(view.state);
  }
  update(u: ViewUpdate) {
    const tree = syntaxTree(u.state);
    // 中文選字期間不重建，避免裝飾變動打斷輸入法
    if (u.view.composing) {
      if (u.docChanged) this.decorations = this.decorations.map(u.changes);
      return;
    }
    if (u.docChanged || u.viewportChanged || u.selectionSet || tree !== this.tree) {
      this.decorations = build(u.view);
      this.tree = tree;
    }
  }
}, { decorations: v => v.decorations });
