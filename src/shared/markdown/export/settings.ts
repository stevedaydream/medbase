/**
 * 列印與匯出的版面設定（PDF、Word、HTML 列印共用）。
 * PDF 走 WebView 列印：@page 的頁首頁尾（margin box）與頁碼由 Chromium 排版，
 * 列印對話框的預覽即為實際輸出。
 */
export type Paper = "A4" | "A5" | "B5" | "Letter";
export type PageNumber = "none" | "page" | "page-total";

export interface PrintSettings {
  title: string;
  paper: Paper;
  landscape: boolean;
  /** 邊界（mm） */
  margin: { top: number; right: number; bottom: number; left: number };
  /** 頁首文字（空白＝不顯示） */
  header: string;
  /** 頁尾文字（頁碼左邊） */
  footer: string;
  pageNumber: PageNumber;
  /** 這一層（含）以上的標題從新頁開始；0＝不自動換頁 */
  headingBreak: 0 | 1 | 2 | 3;
  /** 內文字級（pt） */
  fontSize: number;
  lineHeight: number;
  /** 文件開頭插入目錄（另外也可在內文用 [TOC]） */
  toc: boolean;
}

export const DEFAULT_PRINT: PrintSettings = {
  title: "",
  paper: "A4",
  landscape: false,
  margin: { top: 25, right: 20, bottom: 25, left: 20 },
  header: "",
  footer: "",
  pageNumber: "page-total",
  headingBreak: 0,
  fontSize: 12,
  lineHeight: 1.6,
  toc: false,
};

export function normalizePrint(p: Partial<PrintSettings> | null | undefined): PrintSettings {
  return { ...DEFAULT_PRINT, ...(p ?? {}), margin: { ...DEFAULT_PRINT.margin, ...(p?.margin ?? {}) } };
}

/** 紙張大小（mm，直式） */
export const PAPER_MM: Record<Paper, [number, number]> = {
  A4: [210, 297], A5: [148, 210], B5: [182, 257], Letter: [215.9, 279.4],
};

export function paperMm(p: PrintSettings): [number, number] {
  const [w, h] = PAPER_MM[p.paper];
  return p.landscape ? [h, w] : [w, h];
}

const cssStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/** 頁碼文字（CSS content） */
function pageNumberContent(p: PrintSettings): string {
  const parts: string[] = [];
  if (p.footer.trim()) parts.push(`${cssStr(p.footer.trim() + "　")}`);
  if (p.pageNumber === "page") parts.push(`"第 " counter(page) " 頁"`);
  if (p.pageNumber === "page-total") parts.push(`"第 " counter(page) " 頁，共 " counter(pages) " 頁"`);
  return parts.join(" ");
}

/** 列印用 CSS：紙張、邊界、頁首頁尾、換頁規則、避免切斷 */
export function printCss(p: PrintSettings): string {
  const [w, h] = paperMm(p);
  const m = p.margin;
  const footer = pageNumberContent(p);
  const breakSel = [1, 2, 3].filter(l => p.headingBreak && l <= p.headingBreak).map(l => `h${l}`).join(", ");
  return `
@page {
  size: ${w}mm ${h}mm;
  margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  ${p.header.trim() ? `@top-center { content: ${cssStr(p.header.trim())}; font-size: 9pt; color: #555; }` : ""}
  ${footer ? `@bottom-center { content: ${footer}; font-size: 9pt; color: #555; }` : ""}
}
html { font-size: ${p.fontSize}pt; }
body { line-height: ${p.lineHeight}; }
.md-pagebreak { break-after: page; height: 0; }
${breakSel ? `${breakSel} { break-before: page; }\nbody > :first-child { break-before: auto !important; }` : ""}
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
table, figure, pre, img, .md-math, .md-mermaid, blockquote { break-inside: avoid; }
tr { break-inside: avoid; }
p { orphans: 2; widows: 2; }
`;
}

/** 匯出文件（HTML／PDF／EPUB）的基本樣式：白底黑字，不跟隨 App 主題 */
export const DOC_CSS = `
body { font-family: "Times New Roman", "Noto Serif TC", "PMingLiU", "新細明體", serif; color: #111; background: #fff; margin: 0 auto; max-width: 52rem; padding: 0 1rem; }
h1, h2, h3, h4, h5, h6 { font-family: "Segoe UI", "Microsoft JhengHei", "微軟正黑體", sans-serif; line-height: 1.35; margin: 1.2em 0 0.5em; }
h1 { font-size: 1.8em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
p, ul, ol, blockquote, table, pre, figure { margin: 0 0 0.8em; }
a { color: #1d4ed8; }
code { font-family: Consolas, "Courier New", monospace; font-size: 0.9em; background: #f2f2f2; padding: 0 0.2em; border-radius: 3px; }
pre { background: #f6f8fa; padding: 0.7em 0.9em; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #ccc; padding-left: 0.9em; color: #444; margin-left: 0; }
table { border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 0.3em 0.6em; }
th { background: #f0f0f0; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #bbb; margin: 1.2em 0; }
.md-math { text-align: center; margin: 0.8em 0; }
.md-mermaid { text-align: center; }
.md-mermaid svg { max-width: 100%; height: auto; }
.md-toc { margin: 0 0 1.2em; padding: 0.6em 0.9em; border: 1px solid #ddd; }
.md-toc a { display: block; color: #111; text-decoration: none; }
.md-toc .md-toc-2 { padding-left: 1.2em; } .md-toc .md-toc-3 { padding-left: 2.4em; } .md-toc .md-toc-4, .md-toc .md-toc-5, .md-toc .md-toc-6 { padding-left: 3.6em; }
li.md-task { list-style: none; } li.md-task input { margin: 0 0.4em 0 -1.3em; }
.footnotes { font-size: 0.9em; } .footnotes-sep { margin-top: 2em; }
.md-img-missing { color: #b91c1c; }
`;
