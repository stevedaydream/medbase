import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildDocx } from "./docx";
import { buildHtml, emptyAssets, codeKey, type ExportAssets } from "./html";
import { buildLatex, texEscape } from "./latex";
import { buildEpub, splitChapters } from "./epub";
import { latexToOmml, parseXml } from "./omml";
import { normalizePrint, printCss, DEFAULT_PRINT } from "./settings";

const SAMPLE = [
  "---", "title: x", "---",
  "# 第一章", "", "內文 **粗體** *斜體* ~~刪除~~ `code` [連結](https://example.com)，公式 $a^2+b^2$。", "",
  "- 項目一", "  - 巢狀", "- 項目二", "", "1. 一", "2. 二", "",
  "- [ ] 待辦", "- [x] 完成", "",
  "> 引用", "", "| 欄 A | 欄 B |", "| :-- | --: |", "| 1 | 2 |", "",
  "$$", "\\frac{a}{b}", "$$", "", "```ts", "const x = 1;", "```", "",
  "註腳[^n]。", "", "<!-- pagebreak -->", "", "# 第二章", "", "![圖](assets/a.png)", "", "[^n]: 註腳內容",
].join("\n");

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const assets = (): ExportAssets => {
  const a = emptyAssets();
  a.images.set("assets/a.png", { bytes: PNG, mime: "image/png", width: 800, height: 400 });
  return a;
};
const S = normalizePrint({ title: "測試", header: "頁首文字", footer: "機密", pageNumber: "page-total", headingBreak: 1 });

describe("版面設定", () => {
  it("補齊預設值、產生 @page", () => {
    expect(normalizePrint({ margin: { top: 10 } as never }).margin).toEqual({ ...DEFAULT_PRINT.margin, top: 10 });
    const css = printCss(S);
    expect(css).toContain("size: 210mm 297mm");
    expect(css).toContain("@top-center");
    expect(css).toContain('counter(pages)');
    expect(css).toContain("h1 { break-before: page; }");
    expect(printCss(normalizePrint({ landscape: true }))).toContain("size: 297mm 210mm");
  });
});

describe("Word 匯出", () => {
  const files = unzipSync(buildDocx(SAMPLE, S, assets()));
  const doc = strFromU8(files["word/document.xml"]);
  it("必要檔案齊全", () => {
    for (const f of ["[Content_Types].xml", "word/styles.xml", "word/numbering.xml", "word/footnotes.xml", "word/header1.xml", "word/footer1.xml", "word/media/image1.png"]) {
      expect(files[f], f).toBeTruthy();
    }
  });
  it("標題、格式、連結", () => {
    expect(doc).toContain('<w:pStyle w:val="Title"/>');
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain("<w:b/>");
    expect(doc).toContain("<w:strike/>");
    expect(doc).toMatch(/<w:hyperlink r:id="rId\d+"/);
    expect(strFromU8(files["word/_rels/document.xml.rels"])).toContain('Target="https://example.com" TargetMode="External"');
  });
  it("清單編號、待辦、表格、程式碼", () => {
    expect(doc).toContain('<w:numPr><w:ilvl w:val="1"/>');
    expect(doc).toContain("☐ ");
    expect(doc).toContain("☑ ");
    expect(doc).toContain("<w:tbl>");
    expect(doc).toContain('<w:jc w:val="right"/>');
    expect(doc).toContain('<w:pStyle w:val="Code"/>');
  });
  it("公式轉成 Word 方程式", () => {
    expect(doc).toContain("<m:oMathPara>");
    expect(doc).toContain("<m:f>");
    expect(doc).toContain("<m:sSup>");
  });
  it("註腳、分頁、標題換頁、圖片、頁碼", () => {
    expect(doc).toContain('<w:footnoteReference w:id="1"/>');
    expect(strFromU8(files["word/footnotes.xml"])).toContain("註腳內容");
    expect(doc).toContain('<w:br w:type="page"/>');
    expect(doc).toContain("<w:pageBreakBefore/>");
    expect(doc).toContain("<wp:inline");
    expect(strFromU8(files["word/footer1.xml"])).toContain("NUMPAGES");
    expect(strFromU8(files["word/header1.xml"])).toContain("頁首文字");
  });
  it("文件 XML 可解析", () => {
    expect(() => parseXml(doc)).not.toThrow();
    // 開始與結束標籤數量一致（粗略檢查格式正確）
    const opens = (doc.match(/<w:p[ >]/g) ?? []).length, closes = (doc.match(/<\/w:p>/g) ?? []).length;
    expect(opens).toBe(closes);
  });
  it("找不到圖片時以文字代替", () => {
    const d = strFromU8(unzipSync(buildDocx("![缺](x.png)", DEFAULT_PRINT, emptyAssets()))["word/document.xml"]);
    expect(d).toContain("[圖片：缺]");
  });
});

describe("OMML", () => {
  it("分數、根號、上下標、求和", () => {
    expect(latexToOmml("\\frac{1}{2}", false)).toContain("<m:f><m:num>");
    expect(latexToOmml("\\sqrt{x}", false)).toContain("<m:rad>");
    expect(latexToOmml("x_i^2", false)).toContain("<m:sSubSup>");
    expect(latexToOmml("\\sum_{i=1}^{n} i", true)).toContain('<m:chr m:val="∑"/>');
    expect(latexToOmml("\\hat{x}", false)).toContain("<m:acc>");
    expect(latexToOmml("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}", true)).toContain("<m:m>");
  });
  it("語法錯誤回傳 null", () => {
    expect(latexToOmml("\\frac{1}{", false)).toBeNull();
  });
});

describe("HTML 匯出", () => {
  const html = buildHtml(SAMPLE, S, assets());
  it("獨立檔案：圖片內嵌、公式 MathML、列印設定", () => {
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("<math");
    expect(html).toContain("@page");
    expect(html).toContain("<title>測試</title>");
    expect(html).not.toContain("title: x");
  });
  it("開頭插入目錄", () => {
    expect(buildHtml("# A", normalizePrint({ toc: true }), emptyAssets())).toContain('class="md-toc"');
  });
});

describe("LaTeX 匯出", () => {
  const tex = buildLatex(SAMPLE, S);
  it("文件結構", () => {
    expect(tex).toContain("\\documentclass[12pt]{ctexart}");
    expect(tex).toContain("\\section{第一章}");
    expect(tex).toContain("\\textbf{粗體}");
    expect(tex).toContain("\\begin{itemize}");
    expect(tex).toContain("\\begin{enumerate}");
    expect(tex).toContain("\\begin{tabular}{lr}");
    expect(tex).toContain("\\[\n\\frac{a}{b}\n\\]");
    expect(tex).toContain("\\footnote{註腳內容}");
    expect(tex).toContain("\\includegraphics");
    expect(tex).toContain("\\clearpage");
    expect(tex).toContain("\\pageref{LastPage}");
  });
  it("特殊字元跳脫", () => {
    expect(texEscape("50% & $5_x#")).toBe("50\\% \\& \\$5\\_x\\#");
  });
});

describe("EPUB 匯出", () => {
  it("依一級標題分章（程式碼區塊內的 # 不算）", () => {
    expect(splitChapters("前言\n# A\na\n```\n# 不是\n```\n# B\nb").map(c => c.title)).toEqual(["", "A", "B"]);
  });
  it("檔案結構", () => {
    const files = unzipSync(buildEpub(SAMPLE, S, assets(), "urn:uuid:test"));
    expect(strFromU8(files["mimetype"])).toBe("application/epub+zip");
    expect(Object.keys(files)[0]).toBe("mimetype");
    expect(files["OEBPS/images/img1.png"]).toBeTruthy();
    const opf = strFromU8(files["OEBPS/content.opf"]);
    expect(opf).toContain('<itemref idref="c2"/>');
    expect(opf).toContain('properties="mathml"');
    const c1 = strFromU8(files["OEBPS/chap1.xhtml"]);
    expect(c1).toContain('<input type="checkbox" disabled="disabled" />');
    expect(strFromU8(files["OEBPS/chap2.xhtml"])).toContain('src="images/img1.png"');
  });
});

describe("標題不重複", () => {
  it("文件以同名 # 標題開頭時不另加標題", () => {
    const d = strFromU8(unzipSync(buildDocx("# 研究\n\n內文", normalizePrint({ title: "研究" }), emptyAssets()))["word/document.xml"]);
    expect(d).not.toContain('w:val="Title"');
    expect(buildLatex("# 研究\n\n內文", normalizePrint({ title: "研究" }))).not.toContain("\maketitle");
    const d2 = strFromU8(unzipSync(buildDocx("# 其他\n\n內文", normalizePrint({ title: "研究" }), emptyAssets()))["word/document.xml"]);
    expect(d2).toContain('w:val="Title"');
  });
});

describe("原文 HTML 匯出", () => {
  it("Word：標題、置中、底線、上下標、顏色", () => {
    const d = strFromU8(unzipSync(buildDocx('<h1><center>資料正規劃\n<center/>\n\n文字 <u>底線</u> H<sub>2</sub>O <span style="color: red">紅</span>', DEFAULT_PRINT, emptyAssets()))["word/document.xml"]);
    expect(d).toContain('<w:pStyle w:val="Heading1"/><w:jc w:val="center"/>');
    expect(d).toContain("資料正規劃");
    expect(d).toContain('<w:u w:val="single"/>');
    expect(d).toContain('<w:vertAlign w:val="subscript"/>');
    expect(d).toContain('<w:color w:val="FF0000"/>');
  });
  it("LaTeX：HTML 標題轉章節", () => {
    expect(buildLatex("<h2>小節</h2>", DEFAULT_PRINT)).toContain("\subsection{小節}");
  });
  it("EPUB：HTML 區塊是合法 XHTML", () => {
    const files = unzipSync(buildEpub("<center>置中<br>換行", DEFAULT_PRINT, emptyAssets(), "urn:uuid:t"));
    const c = strFromU8(files["OEBPS/chap1.xhtml"]);
    expect(c).toContain('<div style="text-align: center">置中<br />換行</div>');
  });
});

describe("程式碼上色匯出", () => {
  const md = "```sql\nselect 1;\n-- 註解\n```";
  const assets = () => {
    const a = emptyAssets();
    a.code.set(codeKey("sql", "select 1;\n-- 註解\n"), [
      { text: "select", color: "CF222E" }, { text: " 1;\n" }, { text: "-- 註解", color: "6E7781", italic: true }, { text: "\n" },
    ]);
    return a;
  };
  it("HTML：行內樣式上色", () => {
    const html = buildHtml(md, DEFAULT_PRINT, assets());
    expect(html).toContain('<pre class="md-code"><code class="language-sql"><span style="color:#CF222E">select</span>');
    expect(html).toContain('<span style="color:#6E7781;font-style:italic">-- 註解</span>');
  });
  it("Word：每行一段、帶顏色，不多出空行", () => {
    const d = strFromU8(unzipSync(buildDocx(md, DEFAULT_PRINT, assets()))["word/document.xml"]);
    expect(d).toContain('<w:color w:val="CF222E"/>');
    expect((d.match(/<w:pStyle w:val="Code"\/>/g) ?? []).length).toBe(2);
  });
  it("沒有上色結果時維持單色", () => {
    expect(buildHtml(md, DEFAULT_PRINT, emptyAssets())).toContain('<pre><code class="language-sql">');
  });
  it("LaTeX：listings 認得的語言用 lstlisting", () => {
    const tex = buildLatex(md, DEFAULT_PRINT);
    expect(tex).toContain("\\begin{lstlisting}[language=SQL]");
    expect(buildLatex("```foo\nx\n```", DEFAULT_PRINT)).toContain("\\begin{verbatim}");
  });
});
