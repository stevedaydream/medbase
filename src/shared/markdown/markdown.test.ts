import { describe, it, expect } from "vitest";
import { isLegacyHtml } from "./format";
import { htmlToMarkdown } from "./fromHtml";

describe("備忘格式判斷", () => {
  it("Tiptap HTML 判為舊格式", () => {
    expect(isLegacyHtml("<p>內容</p>")).toBe(true);
    expect(isLegacyHtml("  <h3>標題</h3><ul><li>a</li></ul>")).toBe(true);
    expect(isLegacyHtml("<hr>")).toBe(true);
  });
  it("Markdown、空白不判為 HTML", () => {
    expect(isLegacyHtml("# 標題\n\n<p>段落內的 HTML</p>")).toBe(false);
    expect(isLegacyHtml("- 清單")).toBe(false);
    expect(isLegacyHtml("<details>摺疊</details>")).toBe(false);
    expect(isLegacyHtml("")).toBe(false);
    expect(isLegacyHtml(null)).toBe(false);
  });
});

describe("舊 HTML 轉 Markdown", () => {
  it("StarterKit 常見結構", () => {
    const html = "<h3>輪序規則</h3><p><strong>粗體</strong>、<em>斜體</em>、<s>刪除</s><br>第二行</p>"
      + "<ul><li><p>一</p></li><li><p>二</p></li></ul><ol><li><p>甲</p></li></ol>"
      + "<blockquote><p>引用</p></blockquote><hr><pre><code>code</code></pre>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("### 輪序規則");
    expect(md).toContain("**粗體**、*斜體*、~~刪除~~");
    expect(md).toMatch(/^-\s+一$/m);
    expect(md).toMatch(/^1\.\s+甲$/m);
    expect(md).toContain("> 引用");
    expect(md).toContain("---");
    expect(md).toContain("```\ncode\n```");
    expect(md.endsWith("\n")).toBe(true);
  });
  it("轉換結果不再被判為 HTML", () => {
    expect(isLegacyHtml(htmlToMarkdown("<p>段落</p>"))).toBe(false);
  });
});
