import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { splitFrontMatter } from "@/shared/markdown/render";
import { outlineOf } from "./outline";
import {
  TableWidget, MathBlockWidget, MermaidWidget, FrontMatterWidget, TocWidget, PageBreakWidget,
} from "./widgets";

/**
 * 區塊預覽：表格、$$ 公式、```mermaid、front matter、[TOC]、分頁標記。
 * 游標不在區塊內時整塊換成顯示元件；游標進入就顯示原文。
 * 跨行的區塊裝飾必須由 StateField 提供（ViewPlugin 不能取代換行）。
 */

export interface BlockRange { from: number; to: number; kind: "table" | "math" | "mermaid" | "frontmatter" | "toc" | "pagebreak"; source: string }

const PAGE_BREAK_RE = /^\s*<!--\s*pagebreak\s*-->\s*$/i;

/** 找出文件中可預覽的區塊（純函式，測試與裝飾共用） */
export function findBlocks(state: EditorState): BlockRange[] {
  const doc = state.doc;
  const out: BlockRange[] = [];
  const fm = splitFrontMatter(doc.sliceString(0, Math.min(doc.length, 20000)));
  const fmEnd = fm.yaml !== null ? doc.lineAt(Math.max(0, fm.offset - 1)).to : -1;
  if (fm.yaml !== null) out.push({ from: 0, to: fmEnd, kind: "frontmatter", source: fm.yaml });

  const code: [number, number][] = [];
  syntaxTree(state).iterate({
    enter: n => {
      if (n.from <= fmEnd) return n.name === "Document" ? undefined : false;
      if (n.name === "Table") {
        out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "table", source: doc.sliceString(doc.lineAt(n.from).from, doc.lineAt(n.to).to) });
        return false;
      }
      if (n.name === "FencedCode" || n.name === "CodeBlock") {
        code.push([n.from, n.to]);
        const info = n.node.getChild("CodeInfo");
        if (info && doc.sliceString(info.from, info.to).trim().toLowerCase() === "mermaid") {
          const text = n.node.getChild("CodeText");
          out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "mermaid", source: text ? doc.sliceString(text.from, text.to) : "" });
        }
        return false;
      }
      return undefined;
    },
  });
  const inCode = (pos: number) => code.some(([a, b]) => pos >= a && pos <= b);

  // 逐行找 $$ 公式、[TOC]、分頁標記
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.from <= fmEnd || inCode(line.from)) continue;
    const t = line.text.trim();
    if (PAGE_BREAK_RE.test(t)) { out.push({ from: line.from, to: line.to, kind: "pagebreak", source: t }); continue; }
    if (/^\[toc\]$/i.test(t)) { out.push({ from: line.from, to: line.to, kind: "toc", source: t }); continue; }
    if (!t.startsWith("$$")) continue;
    if (t.length > 4 && t.endsWith("$$")) { out.push({ from: line.from, to: line.to, kind: "math", source: t.slice(2, -2).trim() }); continue; }
    const body = [t.slice(2)];
    for (let j = i + 1; j <= doc.lines; j++) {
      const l = doc.line(j);
      if (l.text.trim().endsWith("$$")) {
        body.push(l.text.trim().slice(0, -2));
        out.push({ from: line.from, to: l.to, kind: "math", source: body.join("\n").trim() });
        i = j;
        break;
      }
      body.push(l.text);
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

const touches = (state: EditorState, from: number, to: number) =>
  state.selection.ranges.some(r => r.from <= to && r.to >= from);

function build(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  let toc: ReturnType<typeof outlineOf> | null = null;
  for (const b of findBlocks(state)) {
    if (touches(state, b.from, b.to)) {
      // 編輯中的區塊：原文加底色，標示範圍
      for (let p = b.from; p <= b.to;) {
        const l = state.doc.lineAt(p);
        decos.push(Decoration.line({ class: `cm-md-src cm-md-src-${b.kind}` }).range(l.from));
        p = l.to + 1;
      }
      continue;
    }
    const pos = b.kind === "table" ? b.from + 2 : b.from;
    const widget =
      b.kind === "table" ? new TableWidget(b.source, pos)
      : b.kind === "math" ? new MathBlockWidget(b.source, pos)
      : b.kind === "mermaid" ? new MermaidWidget(b.source, pos)
      : b.kind === "frontmatter" ? new FrontMatterWidget(b.source, pos)
      : b.kind === "toc" ? new TocWidget(b.source, pos, (toc ??= outlineOf(state)))
      : new PageBreakWidget(b.source, pos);
    decos.push(Decoration.replace({ widget, block: true }).range(b.from, b.to));
  }
  return Decoration.set(decos, true);
}

export const blockPreview = StateField.define<DecorationSet>({
  create: state => build(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

/** front matter 結束位置（即時排版略過這段，避免 --- 被當成分隔線或標題） */
export function frontMatterEnd(state: EditorState): number {
  const fm = splitFrontMatter(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
  return fm.yaml !== null ? state.doc.lineAt(Math.max(0, fm.offset - 1)).to : -1;
}
