import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

/**
 * 稿件檔案轉換：匯出 Word / PDF / Markdown / 純文字，匯入 Word / Markdown / 純文字。
 *
 * Word 直接組 docx（OOXML），不另加套件；PDF 走 WebView 的列印對話框另存，
 * 中文字型交給系統處理，避免在前端嵌入數 MB 的字型檔。
 */

export interface Section { title: string; body: string }

const TITLE_NAMES = ["title", "標題", "題目"];
const isTitle = (s: string) => TITLE_NAMES.includes(s.trim().toLowerCase());

/** 常見段落名稱：Word 沒用標題樣式時，以此辨認段落分界 */
const KNOWN_HEADINGS = [
  "title", "abstract", "introduction", "background", "methods", "method", "materials and methods",
  "patients and methods", "case presentation", "case report", "case description", "results",
  "discussion", "conclusion", "conclusions", "references", "acknowledgments", "acknowledgements",
  "摘要", "前言", "背景", "方法", "研究方法", "材料與方法", "病例報告", "個案報告", "個案介紹", "結果", "討論", "結論", "參考文獻", "致謝",
];

function normalizeHeading(line: string): string {
  return line.trim().replace(/^[0-9IVX]+[.)、]\s*/i, "").replace(/[:：]$/, "").trim().toLowerCase();
}
const isKnownHeading = (line: string) => line.trim().length <= 40 && KNOWN_HEADINGS.includes(normalizeHeading(line));

function trimBody(lines: string[]): string {
  return lines.join("\n").replace(/^\n+|\n+$/g, "");
}

// ── 匯出：Word ────────────────────────────────────────────────────

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // XML 不允許的控制字元
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function paragraph(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  if (!text) return `<w:p>${pPr}</w:p>`;
  const runs = text.split("\t").map((part, i) =>
    `${i ? "<w:r><w:tab/></w:r>" : ""}<w:r><w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>`).join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="新細明體" w:cs="Times New Roman"/>
      <w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
</w:styles>`;

export function exportDocx(sections: Section[]): Uint8Array {
  const body: string[] = [];
  for (const s of sections) {
    const lines = s.body.split("\n");
    if (isTitle(s.title)) {
      lines.forEach(l => body.push(paragraph(l, "Title")));
      continue;
    }
    body.push(paragraph(s.title, "Heading1"));
    lines.forEach(l => body.push(paragraph(l)));
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>${body.join("")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "word/document.xml": strToU8(documentXml),
    "word/styles.xml": strToU8(STYLES_XML),
  });
}

// ── 匯出：Markdown / 純文字 ───────────────────────────────────────

export function exportMarkdown(sections: Section[]): string {
  return sections.map(s => isTitle(s.title) ? `# ${s.body.trim()}` : `## ${s.title}\n\n${s.body.trim()}`).join("\n\n") + "\n";
}

export function exportText(sections: Section[]): string {
  return sections.map(s => isTitle(s.title) ? s.body.trim() : `${s.title}\n\n${s.body.trim()}`).join("\n\n\n") + "\n";
}

// ── 匯出：PDF（列印對話框）──────────────────────────────────────

const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 開啟列印對話框，選「另存為 PDF」或「Microsoft Print to PDF」即可存成 PDF */
export function printAsPdf(docTitle: string, sections: Section[]): Promise<void> {
  const body = sections.map(s => {
    const paras = s.body.split("\n").map(l => `<p>${htmlEscape(l) || "&nbsp;"}</p>`).join("");
    return isTitle(s.title) ? `<h1>${s.body.split("\n").map(htmlEscape).join("<br>")}</h1>` : `<h2>${htmlEscape(s.title)}</h2>${paras}`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(docTitle)}</title>
<style>
  @page { size: A4; margin: 2.5cm; }
  body { font-family: "Times New Roman", "PMingLiU", "新細明體", serif; font-size: 12pt; line-height: 1.5; color: #000; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 18pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; page-break-after: avoid; }
  p { margin: 0 0 6pt; white-space: pre-wrap; }
</style></head><body>${body}</body></html>`;

  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    iframe.srcdoc = html;
    iframe.onload = () => {
      const win = iframe.contentWindow;
      const cleanup = () => { iframe.remove(); resolve(); };
      if (!win) { cleanup(); return; }
      win.addEventListener("afterprint", () => setTimeout(cleanup, 100));
      win.focus();
      win.print();
      // 部分環境不觸發 afterprint，保底移除
      setTimeout(() => { if (iframe.isConnected) cleanup(); }, 60_000);
    };
    document.body.appendChild(iframe);
  });
}

// ── 匯入 ─────────────────────────────────────────────────────────

/** 把「每段是否為標題」的段落序列切成區塊 */
function splitByHeadings(paras: { text: string; heading?: "title" | "heading" }[]): Section[] {
  const out: Section[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  const flush = () => { if (cur) out.push({ title: cur.title, body: trimBody(cur.lines) }); };
  for (const p of paras) {
    if (p.heading === "title") {
      // 連續多段標題樣式（多行標題）合併成同一個 Title
      if (cur?.title === "Title") { cur.lines.push(p.text); continue; }
      flush();
      cur = { title: "Title", lines: [p.text] };
    } else if (p.heading === "heading") {
      flush();
      cur = { title: p.text.trim() || "段落", lines: [] };
    } else {
      if (!cur) cur = { title: "內文", lines: [] };
      cur.lines.push(p.text);
    }
  }
  flush();
  return out;
}

/** 沒有標題樣式時，以常見段落名稱辨認分界；第一個段落前的文字視為標題 */
function splitByKnownNames(lines: string[]): Section[] {
  const paras = lines.map(text => ({ text, heading: isKnownHeading(text) ? "heading" as const : undefined }));
  if (!paras.some(p => p.heading)) return [{ title: "內文", body: trimBody(lines) }];
  const firstHeading = paras.findIndex(p => p.heading);
  const before = lines.slice(0, firstHeading).join("\n").trim();
  const sections = splitByHeadings(paras.slice(firstHeading));
  return before ? [{ title: "Title", body: before }, ...sections] : sections;
}

function readDocxParagraphs(bytes: Uint8Array): { text: string; styleName: string }[] {
  const files = unzipSync(bytes);
  const docXml = files["word/document.xml"];
  if (!docXml) throw new Error("不是有效的 Word（.docx）檔案");
  const parser = new DOMParser();
  const doc = parser.parseFromString(strFromU8(docXml), "application/xml");

  // styleId → 樣式名稱（中文版 Word 的標題 1 styleId 是 "1"，名稱仍是 "heading 1"）
  const styleNames = new Map<string, string>();
  if (files["word/styles.xml"]) {
    const styles = parser.parseFromString(strFromU8(files["word/styles.xml"]), "application/xml");
    for (const st of Array.from(styles.getElementsByTagNameNS(W_NS, "style"))) {
      const id = st.getAttributeNS(W_NS, "styleId") ?? st.getAttribute("w:styleId") ?? "";
      const nameEl = st.getElementsByTagNameNS(W_NS, "name")[0];
      const name = nameEl?.getAttributeNS(W_NS, "val") ?? nameEl?.getAttribute("w:val") ?? "";
      if (id) styleNames.set(id, name.toLowerCase());
    }
  }

  const textOf = (node: Node): string => {
    let s = "";
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType !== 1) return;
      const el = child as Element;
      if (el.namespaceURI === W_NS && el.localName === "t") s += el.textContent ?? "";
      else if (el.namespaceURI === W_NS && el.localName === "tab") s += "\t";
      else if (el.namespaceURI === W_NS && (el.localName === "br" || el.localName === "cr")) s += "\n";
      else if (el.namespaceURI === W_NS && (el.localName === "pPr" || el.localName === "rPr" || el.localName === "delText")) return;
      else s += textOf(el);
    });
    return s;
  };

  return Array.from(doc.getElementsByTagNameNS(W_NS, "p")).map(p => {
    const styleEl = p.getElementsByTagNameNS(W_NS, "pStyle")[0];
    const id = styleEl?.getAttributeNS(W_NS, "val") ?? styleEl?.getAttribute("w:val") ?? "";
    return { text: textOf(p), styleName: styleNames.get(id) ?? id.toLowerCase() };
  });
}

function importDocx(bytes: Uint8Array): Section[] {
  const paras = readDocxParagraphs(bytes);
  const tagged = paras.map(p => ({
    text: p.text,
    heading: p.styleName === "title" ? "title" as const
      : /^heading\s*[12]$/.test(p.styleName) ? "heading" as const
      : undefined,
  }));
  if (tagged.some(p => p.heading === "heading")) return splitByHeadings(tagged);
  return splitByKnownNames(paras.map(p => p.text));
}

function importMarkdown(text: string): Section[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some(l => /^#{1,3}\s+/.test(l))) return splitByKnownNames(lines);
  return splitByHeadings(lines.map(l => {
    const m = /^(#{1,3})\s+(.*)$/.exec(l);
    if (!m) return { text: l };
    return { text: m[2], heading: m[1].length === 1 ? "title" as const : "heading" as const };
  }));
}

/** 依副檔名匯入，回傳切好的段落 */
export function importManuscript(fileName: string, bytes: Uint8Array): Section[] {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  let sections: Section[];
  if (ext === "docx") sections = importDocx(bytes);
  else if (ext === "md" || ext === "markdown") sections = importMarkdown(new TextDecoder().decode(bytes));
  else if (ext === "txt") sections = splitByKnownNames(new TextDecoder().decode(bytes).replace(/\r\n?/g, "\n").split("\n"));
  else if (ext === "doc") throw new Error("不支援舊版 .doc，請在 Word 另存為 .docx 後再匯入");
  else throw new Error("只支援 .docx、.md、.txt");
  return sections.filter(s => s.title.trim() || s.body.trim());
}

/** 字數：英文以單字計、中日文以字計 */
export function wordCount(text: string): number {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const words = (text.replace(/[㐀-鿿豈-﫿]/g, " ").match(/[A-Za-z0-9]+(?:[''’-][A-Za-z0-9]+)*/g) ?? []).length;
  return cjk + words;
}
