import { describe, it, expect } from "vitest";
import { sanitizeHtml, sanitizeTag } from "./sanitize";
import { renderMarkdown } from "./render";

describe("HTML 白名單", () => {
  it("Typora 常見寫法：<h1><center> 與寫錯的 <center/>", () => {
    expect(sanitizeHtml("<h1><center>資料正規劃\n    <center/>"))
      .toBe('<h1><div style="text-align: center">資料正規劃\n    <div style="text-align: center"></div></div></h1>');
  });
  it("危險內容移除", () => {
    expect(sanitizeHtml('<p onclick="x()">a<script>alert(1)</script>b</p>')).toBe("<p>ab</p>");
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<img src="javascript:x">')).toBe("");
    expect(sanitizeHtml('<iframe src="https://x"></iframe>後')).toBe("後");
    expect(sanitizeHtml('<div style="background:url(x); color: red">c</div>')).toBe('<div style="color: red">c</div>');
    expect(sanitizeHtml("<object><param>x</param></object>y")).toBe("y");
  });
  it("屬性與舊標籤轉換", () => {
    expect(sanitizeHtml('<p align="center">置中</p>')).toBe('<p style="text-align: center">置中</p>');
    expect(sanitizeHtml('<font color="red" size="5">紅</font>')).toBe('<span style="color: red; font-size: 1.5em">紅</span>');
    expect(sanitizeHtml('<a href="https://e.com">e</a>')).toBe('<a href="https://e.com" target="_blank" rel="noopener noreferrer">e</a>');
    expect(sanitizeHtml('<img src="a.png" width="50%">', { resolveSrc: s => `blob:${s}` })).toBe('<img src="blob:a.png" width="50%">');
    expect(sanitizeHtml("<br>", { xhtml: true })).toBe("<br />");
    expect(sanitizeHtml("<details open><summary>摘要</summary>內容</details>")).toBe('<details open="open"><summary>摘要</summary>內容</details>');
  });
  it("不認得的標籤只留內容、文字跳脫", () => {
    expect(sanitizeHtml("<custom>文字</custom> a < b & c")).toBe("文字 a &lt; b &amp; c");
  });
  it("單一標籤過濾", () => {
    expect(sanitizeTag("<u>")).toBe("<u>");
    expect(sanitizeTag("</center>")).toBe("</div>");
    expect(sanitizeTag('<span onclick="x" style="color:blue">')).toBe('<span style="color: blue">');
    expect(sanitizeTag("<script>")).toBe("");
  });
});

describe("Markdown 內的 HTML", () => {
  const r = (s: string, o = {}) => renderMarkdown(s, o).html;
  it("區塊 HTML 顯示、行內 HTML 套用", () => {
    expect(r("<h1><center>資料正規劃\n    <center/>")).toContain('<h1><div style="text-align: center">資料正規劃');
    expect(r("文字 <u>底線</u> 與 H<sub>2</sub>O")).toContain("<u>底線</u> 與 H<sub>2</sub>O");
  });
  it("段落內沒關的標籤自動關閉、多餘的結束標籤丟掉", () => {
    expect(r("a <b>粗")).toBe("<p>a <b>粗</b></p>\n");
    expect(r("a </i>b")).toBe("<p>a b</p>\n");
  });
  it("分頁標記仍是分頁，不被當成 HTML 註解", () => {
    expect(r("<!-- pagebreak -->")).toContain('class="md-pagebreak"');
  });
  it("待辦核取方塊不被過濾", () => {
    expect(r("- [x] 完成")).toContain('<input type="checkbox" disabled checked>');
  });
  it("HTML 圖片走同一個網址轉換", () => {
    expect(r('<img src="a.png">', { image: (s: string) => `blob:${s}` })).toContain('src="blob:a.png"');
  });
});
