import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { outlineOf, plainHeading } from "./outline";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });

describe("大綱", () => {
  it("ATX 與 Setext 標題、略過程式碼區塊", () => {
    const doc = "# 一\n\n內文\n\n## **二** ##\n\n```\n# 不是標題\n```\n\n三\n---\n\n### [連結](x)";
    expect(outlineOf(stateOf(doc)).map(i => [i.level, i.text])).toEqual([[1, "一"], [2, "二"], [2, "三"], [3, "連結"]]);
  });
  it("位置指向標題行首", () => {
    const items = outlineOf(stateOf("前言\n\n## 方法"));
    expect(items[0].pos).toBe(4);
  });
  it("去掉行內符號", () => {
    expect(plainHeading("## *斜* `碼` ~~刪~~ ##")).toBe("斜 碼 刪");
  });
});
