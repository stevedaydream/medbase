import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { ImageWidget, InlineMathWidget } from "./widgets";
import { frontMatterEnd } from "./blockPreview";
import { sanitizeTag } from "@/shared/markdown/sanitize";

/** 行內公式 $…$：與 shared/markdown/render 的判斷一致（$ 內側不能是空白、結尾 $ 後不能接數字） */
const INLINE_MATH = /(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])/g;
const FOOTNOTE_REF = /\[\^[^\]\s]+\](?!:)/g;

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

class BreakWidget extends WidgetType {
  eq() { return true; }
  toDOM() { return document.createElement("br"); }
}
const brWidget = Decoration.replace({ widget: new BreakWidget() });

/** 行內 HTML 能直接套樣式的標籤 */
const INLINE_HTML = new Set(["b", "strong", "i", "em", "u", "ins", "s", "del", "strike", "sub", "sup", "mark", "kbd", "small", "big", "span", "font", "code"]);

/**
 * 行內 HTML：同一段落內成對的標籤，游標不在時隱藏標籤並套用樣式；<br> 換成換行。
 * 樣式屬性先經過白名單（sanitizeTag），不會執行任何 HTML。
 */
function inlineHtml(state: EditorState, tags: { from: number; to: number; parent: number }[], out: Range<Decoration>[]) {
  const stack: { name: string; from: number; to: number; parent: number; style: string }[] = [];
  for (const t of tags) {
    const text = state.doc.sliceString(t.from, t.to);
    const m = /^<(\/?)\s*([a-zA-Z][\w-]*)/.exec(text);
    if (!m) continue;
    const name = m[2].toLowerCase();
    if (name === "br") {
      if (!touches(state, t.from, t.to)) out.push(brWidget.range(t.from, t.to));
      continue;
    }
    if (!INLINE_HTML.has(name)) continue;
    if (!m[1]) {
      const style = /style="([^"]*)"/.exec(sanitizeTag(text))?.[1] ?? "";
      stack.push({ name, from: t.from, to: t.to, parent: t.parent, style });
      continue;
    }
    const i = stack.map(s => s.name).lastIndexOf(name);
    if (i < 0) continue;
    const open = stack.splice(i)[0];
    if (open.parent !== t.parent || touches(state, open.from, t.to)) continue;
    out.push(hide.range(open.from, open.to));
    out.push(hide.range(t.from, t.to));
    if (open.to < t.from) {
      out.push(Decoration.mark({ class: `cm-html-${name}`, attributes: open.style ? { style: open.style.replace(/&quot;/g, '"') } : undefined }).range(open.to, t.from));
    }
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const doc = state.doc;
  const fmEnd = frontMatterEnd(state);
  const codeRanges: [number, number][] = [];
  const htmlTags: { from: number; to: number; parent: number }[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node: SyntaxNodeRef) => {
        const name = node.name;
        if (node.to <= fmEnd + 1 && name !== "Document") return false;
        if (name === "InlineCode" || name === "FencedCode" || name === "CodeBlock") codeRanges.push([node.from, node.to]);
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          out.push(line(`cm-md-h cm-md-h${heading[1]}`).range(doc.lineAt(node.from).from));
          return;
        }
        // Setext 標題（下一行 === 或 ---）：文字行套標題樣式，游標不在時收起底線那一行
        const setext = /^SetextHeading(\d)$/.exec(name);
        if (setext) {
          const last = doc.lineAt(node.to);
          for (let p = node.from; p < last.from;) {
            const l = doc.lineAt(p);
            out.push(line(`cm-md-h cm-md-h${setext[1]}`).range(l.from));
            p = l.to + 1;
          }
          if (!touches(state, node.from, node.to)) {
            out.push(line("cm-md-collapsed").range(last.from));
            out.push(hide.range(last.from, last.to));
          }
          return false;
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
          case "HTMLTag": {
            htmlTags.push({ from: node.from, to: node.to, parent: node.node.parent?.from ?? -1 });
            return;
          }
          case "HTMLBlock": return false;
          case "Image": {
            if (touches(state, node.from, node.to)) return false;
            const text = doc.sliceString(node.from, node.to);
            const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)$/.exec(text);
            if (m) out.push(Decoration.replace({ widget: new ImageWidget(m[2], m[1], node.from + 2) }).range(node.from, node.to));
            return false;
          }
          case "Link": {
            // 註腳引用 [^1] 不當連結處理
            if (doc.sliceString(node.from, node.from + 2) === "[^") return false;
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

    inlineHtml(state, htmlTags.splice(0), out);

    // 行內公式與註腳：Markdown 語法樹沒有這兩種節點，逐行比對
    const inCode = (p: number) => codeRanges.some(([a, b]) => p >= a && p < b);
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (line.to <= fmEnd || line.text.trim().startsWith("$$")) continue;
      for (const m of line.text.matchAll(INLINE_MATH)) {
        const a = line.from + m.index!, b = a + m[0].length;
        if (inCode(a) || touches(state, a, b)) continue;
        out.push(Decoration.replace({ widget: new InlineMathWidget(m[1], a) }).range(a, b));
      }
      if (/^\[\^[^\]\s]+\]:/.test(line.text)) out.push(Decoration.line({ class: "cm-md-fndef" }).range(line.from));
      for (const m of line.text.matchAll(FOOTNOTE_REF)) {
        const a = line.from + m.index!;
        if (!inCode(a)) out.push(Decoration.mark({ class: "cm-md-fnref" }).range(a, a + m[0].length));
      }
    }
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
