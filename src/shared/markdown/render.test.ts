import { describe, it, expect } from "vitest";
import { renderMarkdown, splitFrontMatter, slugify } from "./render";

const r = (s: string, o = {}) => renderMarkdown(s, o).html;

describe("渲染", () => {
  it("front matter 不輸出", () => {
    const { yaml, body } = splitFrontMatter("---\ntitle: 測試\n---\n# 一");
    expect(yaml).toBe("title: 測試");
    expect(body).toBe("# 一");
    expect(r("---\ntitle: x\n---\n內文")).not.toContain("title");
  });
  it("表格、刪除線、待辦", () => {
    expect(r("| a | b |\n|:-|-:|\n| 1 | 2 |")).toContain('<td style="text-align:right">2</td>');
    expect(r("~~刪~~")).toContain("<s>刪</s>");
    const html = r("- [ ] 未完成\n- [x] 完成");
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(html).toContain("checked");
    expect(html).not.toContain("[ ]");
  });
  it("公式：行內、區塊；金額不誤判", () => {
    expect(r("質能 $E=mc^2$ 式")).toContain("katex");
    expect(r("$$\n\\frac{a}{b}\n$$")).toContain('class="md-math"');
    expect(r("$$ x^2 $$")).toContain('class="md-math"');
    expect(r("價格 $5 與 $10")).not.toContain("katex");
    expect(r("$x$", { math: "mathml" })).toContain("<math");
  });
  it("註腳", () => {
    const html = r("引用[^1]。\n\n[^1]: 註腳內容");
    expect(html).toContain("footnote-ref");
    expect(html).toContain("註腳內容");
  });
  it("[TOC] 與標題錨點", () => {
    const html = r("[TOC]\n\n# 一\n\n## 二 二\n\n## 二 二");
    expect(html).toContain('<h2 id="二-二">');
    expect(html).toContain('<h2 id="二-二-1">');
    expect(html).toContain('<nav class="md-toc"><a class="md-toc-1" href="#一">一</a>');
  });
  it("分頁標記與 mermaid", () => {
    expect(r("前\n\n<!-- pagebreak -->\n\n後")).toContain('class="md-pagebreak"');
    expect(r("```mermaid\ngraph TD; A-->B\n```")).toContain('<pre class="mermaid">graph TD; A--&gt;B');
  });
  it("原文 HTML 不輸出、危險連結不產生", () => {
    expect(r("<script>alert(1)</script>")).not.toContain("<script>");
    expect(r("[x](javascript:alert(1))")).not.toContain('href="javascript');
  });
  it("圖片網址轉換", () => {
    expect(r("![圖](a.png)", { image: (s: string) => `blob:${s}` })).toContain('src="blob:a.png"');
    expect(r("![圖](a.png)", { image: () => "" })).toContain("md-img-missing");
  });
  it("slug 重複加序號", () => {
    const used = new Map<string, number>();
    expect([slugify("A B", used), slugify("A B", used), slugify("！", used)]).toEqual(["a-b", "a-b-1", "section"]);
  });
});
