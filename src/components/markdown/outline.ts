import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export interface OutlineItem { level: number; text: string; pos: number }

/** 去掉行內 Markdown 符號，只留標題文字 */
export function plainHeading(raw: string): string {
  return raw
    .replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|\*|_|`)/g, "")
    .trim();
}

/** 文件大綱：ATX（#）與 Setext（===／---）標題 */
export function outlineOf(state: EditorState): OutlineItem[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const out: OutlineItem[] = [];
  tree.iterate({
    enter: node => {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(node.name);
      if (!m) return node.name === "Document" ? undefined : false;
      const line = state.doc.lineAt(node.from);
      out.push({ level: Number(m[2]), text: plainHeading(line.text) || "（未命名）", pos: line.from });
      return false;
    },
  });
  return out;
}
