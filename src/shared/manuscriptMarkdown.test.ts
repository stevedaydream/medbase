import { describe, it, expect } from "vitest";
import { plainToMarkdown, shiftHeadings, sectionsToMarkdown, manuscriptTitle, assetIdOf, assetSrc } from "./manuscriptMarkdown";
import { renderMarkdown } from "./markdown/render";

/** 渲染後的純文字（去標籤、還原實體、換行正規化） */
const textOf = (md: string) => renderMarkdown(md).html
  .replace(/<br\s*\/?>\n?/g, "\n").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/ /g, " ").trim();

describe("純文字轉 Markdown：顯示結果與原文相同", () => {
  const cases = [
    "一般段落",
    "*星號* 與 _底線_ 與 `反引號` 與 [方括號](x) 與 <角括號> 與 $5 與 $x$ 與 ~~波浪~~ 與 a|b",
    "# 不是標題\n- 不是清單\n+ 也不是\n> 不是引用\n1. 不是編號\n2) 也不是\n---\n===",
    "第一行\n第二行（同段換行）\n\n第二段",
    "多個   空白",
    "\\反斜線\\",
  ];
  for (const c of cases) {
    it(JSON.stringify(c).slice(0, 30), () => {
      expect(textOf(plainToMarkdown(c))).toBe(c.replace(/^ +| +$/gm, ""));
    });
  }
  it("不產生任何語法元素", () => {
    const html = renderMarkdown(plainToMarkdown("# a\n- b\n> c\n**d**\n| e | f |\n|---|---|")).html;
    expect(html).not.toMatch(/<(h\d|ul|ol|blockquote|strong|table)/);
  });
});

describe("組稿", () => {
  it("標題下移、程式碼區塊內不動", () => {
    expect(shiftHeadings("# A\n```\n# x\n```\n## B", 2)).toBe("### A\n```\n# x\n```\n#### B");
    expect(shiftHeadings("###### Z", 2)).toBe("###### Z");
  });
  it("Title 段落成為文件標題，其他段落用 ##；純文字段落跳脫", () => {
    const md = sectionsToMarkdown([
      { title: "Title", body: "研究標題", format: "text" },
      { title: "Introduction", body: "# 內文 *星號*", format: "text" },
      { title: "Methods", body: "# 小節\n\n**粗體**", format: "md" },
    ]);
    expect(md).toBe("# 研究標題\n\n## Introduction\n\n\\# 內文 \\*星號\\*\n\n## Methods\n\n### 小節\n\n**粗體**\n");
  });
  it("文件標題與圖片引用", () => {
    expect(manuscriptTitle([{ title: "Title", body: "A\nB" }], "x")).toBe("A");
    expect(manuscriptTitle([], "備用")).toBe("備用");
    expect(assetIdOf(assetSrc("abc"))).toBe("abc");
    expect(assetIdOf("a.png")).toBeNull();
  });
});
