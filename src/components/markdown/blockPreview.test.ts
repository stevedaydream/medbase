import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { findBlocks } from "./blockPreview";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
const kinds = (doc: string) => findBlocks(stateOf(doc)).map(b => [b.kind, b.source]);

describe("區塊預覽範圍", () => {
  it("front matter、表格、公式、mermaid、目錄、分頁", () => {
    const doc = [
      "---", "title: x", "---", "", "[TOC]", "", "| a | b |", "|---|---|", "| 1 | 2 |", "",
      "$$", "x^2", "$$", "", "$$ y $$", "", "```mermaid", "graph TD; A-->B", "```", "", "<!-- pagebreak -->",
    ].join("\n");
    expect(kinds(doc)).toEqual([
      ["frontmatter", "title: x"],
      ["toc", "[TOC]"],
      ["table", "| a | b |\n|---|---|\n| 1 | 2 |"],
      ["math", "x^2"],
      ["math", "y"],
      ["mermaid", "graph TD; A-->B"],
      ["pagebreak", "<!-- pagebreak -->"],
    ]);
  });
  it("程式碼區塊內的 $$ 與 [TOC] 不算", () => {
    expect(kinds("```\n$$\nx\n$$\n[TOC]\n```")).toEqual([]);
  });
  it("沒有結尾的 $$ 不算公式", () => {
    expect(kinds("$$\nx\n")).toEqual([]);
  });
});
