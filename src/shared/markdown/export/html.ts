import { renderMarkdown } from "../render";
import { DOC_CSS, printCss, type PrintSettings } from "./settings";

/** 匯出時預先準備好的素材（由瀏覽器端 exportAssets 產生；測試可給空的） */
export interface ImageAsset { bytes: Uint8Array; mime: string; width: number; height: number }
/** 上色後的程式碼片段（含換行字元）；color 為 6 碼十六進位、不含 # */
export interface CodeSeg { text: string; color?: string; bold?: boolean; italic?: boolean }
export interface ExportAssets {
  /** Markdown 中的圖片 src → 檔案內容 */
  images: Map<string, ImageAsset>;
  /** mermaid 原始碼 → SVG（HTML、EPUB） */
  mermaidSvg: Map<string, string>;
  /** mermaid 原始碼 → PNG（Word） */
  mermaidPng: Map<string, ImageAsset>;
  /** 程式碼區塊上色結果，key 見 codeKey */
  code: Map<string, CodeSeg[]>;
}
export const emptyAssets = (): ExportAssets => ({ images: new Map(), mermaidSvg: new Map(), mermaidPng: new Map(), code: new Map() });
export const codeKey = (lang: string, code: string) => `${lang.toLowerCase()}\u0000${code}`;

const escCode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** 上色片段 → HTML（行內樣式，EPUB、列印都不需外部 CSS） */
export function codeSegsHtml(segs: CodeSeg[]): string {
  return segs.map(s => {
    const style = [s.color ? `color:#${s.color}` : "", s.bold ? "font-weight:bold" : "", s.italic ? "font-style:italic" : ""].filter(Boolean).join(";");
    return style ? `<span style="${style}">${escCode(s.text)}</span>` : escCode(s.text);
  }).join("");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const dataUri = (a: ImageAsset) => `data:${a.mime};base64,${b64(a.bytes)}`;

/** 設定「開頭插入目錄」時在內文最前面加 [TOC] */
export const withToc = (md: string, s: PrintSettings) => (s.toc && !/^\s*\[toc\]\s*$/im.test(md) ? `[TOC]\n\n${md}` : md);

/**
 * 完整、獨立的 HTML 文件：圖片內嵌成 data URI、公式用 MathML（不需字型檔）、mermaid 內嵌 SVG。
 * forPrint：加上 @page 與換頁規則（PDF 列印）；一般 HTML 匯出也帶著，用瀏覽器列印時一樣分頁。
 */
export function buildHtml(md: string, settings: PrintSettings, assets: ExportAssets): string {
  const { html } = renderMarkdown(withToc(md, settings), {
    math: "mathml",
    image: src => { const a = assets.images.get(src); return a ? dataUri(a) : /^(https?:|data:)/i.test(src) ? src : ""; },
    mermaid: code => assets.mermaidSvg.get(code) ?? null,
    highlight: (code, lang) => { const s = assets.code.get(codeKey(lang, code)); return s ? codeSegsHtml(s) : null; },
  });
  const title = escapeHtml(settings.title || "文件");
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${DOC_CSS}
@media print { body { max-width: none; padding: 0; } }
${printCss(settings)}</style>
</head><body>
${html}</body></html>
`;
}
