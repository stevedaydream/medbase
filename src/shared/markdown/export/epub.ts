import { zipSync, strToU8 } from "fflate";
import { renderMarkdown, splitFrontMatter } from "../render";
import { DOC_CSS, type PrintSettings } from "./settings";
import { withToc, type ExportAssets } from "./html";

/**
 * Markdown → EPUB 3：依一級標題分章；圖片放進 images/、mermaid 內嵌 SVG、公式用 MathML。
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };

/** 依 # 標題切章；第一個 # 之前的內容自成一章 */
export function splitChapters(md: string): { title: string; body: string }[] {
  const lines = md.split("\n");
  const out: { title: string; body: string[] }[] = [];
  let inFence = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    const m = !inFence && /^#\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ title: m[1].replace(/[*_`~]/g, ""), body: [l] });
    else (out[out.length - 1] ?? (out.push({ title: "", body: [] }), out[0])).body.push(l);
  }
  return out.map(c => ({ title: c.title, body: c.body.join("\n") })).filter(c => c.body.trim());
}

export function buildEpub(md: string, settings: PrintSettings, assets: ExportAssets, uid = `urn:uuid:${crypto.randomUUID()}`): Uint8Array {
  const title = settings.title.trim() || "文件";
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  files["mimetype"] = [strToU8("application/epub+zip"), { level: 0 }];

  // 圖片：每個 src 一個檔案
  const imageNames = new Map<string, string>();
  const manifestImages: string[] = [];
  for (const [src, a] of assets.images) {
    const name = `images/img${imageNames.size + 1}.${EXT[a.mime] ?? "png"}`;
    imageNames.set(src, name);
    files[`OEBPS/${name}`] = a.bytes;
    manifestImages.push(`<item id="img${imageNames.size}" href="${name}" media-type="${a.mime}"/>`);
  }

  const chapters = splitChapters(withToc(splitFrontMatter(md).body, settings));
  const navItems: string[] = [];
  const manifest: string[] = [];
  const spine: string[] = [];
  chapters.forEach((c, i) => {
    const { html } = renderMarkdown(c.body, {
      xhtml: true, math: "mathml",
      image: src => imageNames.get(src) ?? (/^https?:/i.test(src) ? src : ""),
      mermaid: code => assets.mermaidSvg.get(code) ?? null,
    });
    const file = `chap${i + 1}.xhtml`;
    const name = c.title || (i === 0 ? title : `第 ${i + 1} 章`);
    files[`OEBPS/${file}`] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-Hant" lang="zh-Hant">
<head><meta charset="utf-8"/><title>${esc(name)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${html}</body></html>`);
    const mathml = /<math[\s>]/.test(html) ? " mathml" : "";
    const svg = /<svg[\s>]/.test(html) ? " svg" : "";
    const props = (mathml + svg).trim();
    manifest.push(`<item id="c${i + 1}" href="${file}" media-type="application/xhtml+xml"${props ? ` properties="${props}"` : ""}/>`);
    spine.push(`<itemref idref="c${i + 1}"/>`);
    navItems.push(`<li><a href="${file}">${esc(name)}</a></li>`);
  });

  files["META-INF/container.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  files["OEBPS/style.css"] = strToU8(DOC_CSS);
  files["OEBPS/nav.xhtml"] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-Hant"><head><meta charset="utf-8"/><title>目錄</title></head>
<body><nav epub:type="toc" id="toc"><h1>目錄</h1><ol>${navItems.join("")}</ol></nav></body></html>`);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files["OEBPS/content.opf"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-Hant">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${esc(uid)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>zh-Hant</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${manifest.join("")}${manifestImages.join("")}</manifest>
<spine>${spine.join("")}</spine>
</package>`);
  return zipSync(files as Parameters<typeof zipSync>[0]);
}
