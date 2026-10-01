import { zipSync, strToU8 } from "fflate";
import { parseMarkdown, slugify, type Token } from "../render";
import { latexToOmml } from "./omml";
import { sanitizeHtml, sanitizeTag } from "../sanitize";
import { paperMm, type PrintSettings } from "./settings";
import { withToc, codeKey, type ExportAssets, type ImageAsset } from "./html";

/**
 * Markdown → Word（.docx，直接組 OOXML）。
 * 支援：標題、段落樣式、粗斜體刪除線、行內程式碼、超連結、清單（含編號與巢狀）、待辦、引用、程式碼區塊、
 * 分隔線、表格（對齊、表頭重複）、圖片、Word 原生註腳、公式（OMML，可在 Word 編輯）、mermaid（PNG）、
 * 目錄（TOC 欄位）、分頁符號、標題換頁、頁首、頁尾與頁碼、紙張與邊界。
 */

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};
const DOC_NS = Object.entries(NS).map(([k, v]) => `xmlns:${k}="${v}"`).join(" ");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const twip = (mm: number) => Math.round(mm * 56.6929);

interface RunStyle { b?: boolean; i?: boolean; s?: boolean; u?: boolean; code?: boolean; link?: string; va?: "subscript" | "superscript"; color?: string }

class Builder {
  rels: { id: string; type: string; target: string; external?: boolean }[] = [];
  media: { name: string; bytes: Uint8Array; ext: string }[] = [];
  footnotes: string[] = [];
  numbering: { numId: number; ordered: boolean; start: number }[] = [];
  private relSeq = 10;
  private docPrId = 1;
  footnoteIds = new Map<string, number>();
  contentWidthEmu: number;

  constructor(readonly settings: PrintSettings, readonly assets: ExportAssets) {
    const [w] = paperMm(settings);
    this.contentWidthEmu = Math.round((w - settings.margin.left - settings.margin.right) * 36000);
  }

  rel(type: string, target: string, external = false): string {
    const id = `rId${++this.relSeq}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  newList(ordered: boolean, start = 1): number {
    const numId = this.numbering.length + 1;
    this.numbering.push({ numId, ordered, start });
    return numId;
  }

  image(asset: ImageAsset, alt: string, maxWidthEmu = this.contentWidthEmu): string {
    const ext = asset.mime === "image/jpeg" ? "jpeg" : asset.mime === "image/gif" ? "gif" : "png";
    const name = `image${this.media.length + 1}.${ext}`;
    this.media.push({ name, bytes: asset.bytes, ext });
    const rid = this.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", `media/${name}`);
    // 96 dpi：1 px = 9525 EMU；超過版面寬度時等比縮小
    let cx = Math.max(1, Math.round(asset.width * 9525)), cy = Math.max(1, Math.round(asset.height * 9525));
    if (cx > maxWidthEmu) { cy = Math.round(cy * maxWidthEmu / cx); cx = maxWidthEmu; }
    const id = this.docPrId++;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${esc(alt || name)}" descr="${esc(alt)}"/>`
      + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
}

function textRun(text: string, st: RunStyle): string {
  if (!text) return "";
  const pr = [
    st.link ? `<w:rStyle w:val="Hyperlink"/>` : st.code ? `<w:rStyle w:val="InlineCode"/>` : "",
    st.b ? "<w:b/>" : "", st.i ? "<w:i/>" : "", st.s ? "<w:strike/>" : "",
    st.color ? `<w:color w:val="${st.color}"/>` : "", st.u ? `<w:u w:val="single"/>` : "",
    st.va ? `<w:vertAlign w:val="${st.va}"/>` : "",
  ].join("");
  return text.split("\t").map((part, i) =>
    `${i ? "<w:r><w:tab/></w:r>" : ""}<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>`).join("");
}

const isCjk = (c: string | undefined) => !!c && /[⺀-鿿豈-﫿＀-￯]/.test(c);

// ── 原文 HTML（已過白名單）→ Word ───────────────────────────────

const NAMED_COLORS: Record<string, string> = { red: "FF0000", blue: "0000FF", green: "008000", orange: "FFA500", purple: "800080", gray: "808080", grey: "808080", black: "000000", white: "FFFFFF", brown: "A52A2A", navy: "000080", teal: "008080" };
function hexColor(style: string): string | undefined {
  const v = /(?:^|;)\s*color:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
  if (!v) return undefined;
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (h) return (h.length === 3 ? h.split("").map(c => c + c).join("") : h).toUpperCase();
  const rgb = /^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (rgb) return rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return NAMED_COLORS[v];
}
const decodeEnt = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => decodeEnt(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "");

/** 行內 HTML 標籤改變文字樣式；回傳要直接輸出的內容（<br>、<img>） */
function applyInlineTag(b: Builder, tag: string, st: RunStyle, stack: { name: string; prev: RunStyle }[]): string {
  const m = /^<(\/?)([a-z][\w-]*)/i.exec(tag);
  if (!m) return "";
  const name = m[2].toLowerCase();
  if (!m[1]) {
    if (name === "br") return "<w:r><w:br/></w:r>";
    if (name === "img") {
      const a = b.assets.images.get(attr(tag, "src"));
      return a ? b.image(a, attr(tag, "alt")) : textRun(`[圖片：${attr(tag, "alt") || attr(tag, "src")}]`, { i: true });
    }
    stack.push({ name, prev: { ...st } });
    if (name === "b" || name === "strong") st.b = true;
    else if (name === "i" || name === "em") st.i = true;
    else if (name === "u" || name === "ins") st.u = true;
    else if (name === "s" || name === "del") st.s = true;
    else if (name === "sub") st.va = "subscript";
    else if (name === "sup") st.va = "superscript";
    else if (name === "code" || name === "kbd") st.code = true;
    const color = hexColor(attr(tag, "style"));
    if (color) st.color = color;
    return "";
  }
  const i = stack.map(x => x.name).lastIndexOf(name);
  if (i >= 0) { Object.keys(st).forEach(k => delete (st as Record<string, unknown>)[k]); Object.assign(st, stack[i].prev); stack.splice(i); }
  return "";
}

const BLOCK_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "li", "tr", "blockquote", "pre", "summary", "details", "table", "ul", "ol", "dt", "dd", "figure", "figcaption", "hr"]);

/** HTML 區塊 → 段落：標題、置中／靠右、行內樣式、圖片、換行；表格列以「｜」分隔 */
function htmlBlock(b: Builder, html: string, out: string[]) {
  let runs: string[] = [];
  let pPr: string[] = [];
  const st: RunStyle = {};
  const stack: { name: string; prev: RunStyle }[] = [];
  const blockStack: { name: string; pPr: string[] }[] = [];
  const flush = () => {
    if (runs.some(r => r.trim())) out.push(para(runs.join(""), pPr));
    runs = [];
  };
  for (const m of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const piece = m[0];
    if (!piece.startsWith("<")) { const text = decodeEnt(piece).replace(/\s*\n\s*/g, " "); if (text.trim() || runs.length) runs.push(textRun(text, st)); continue; }
    const t = /^<(\/?)([a-z][\w-]*)/i.exec(piece);
    if (!t) continue;
    const name = t[2].toLowerCase();
    if (BLOCK_TAGS.has(name)) {
      flush();
      if (name === "hr") { out.push(para("", [`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>`])); continue; }
      if (!t[1]) {
        blockStack.push({ name, pPr });
        const align = /text-align:\s*(center|right|justify)/i.exec(attr(piece, "style"))?.[1]?.toLowerCase();
        const h = /^h([1-6])$/.exec(name)?.[1];
        pPr = [
          h ? `<w:pStyle w:val="Heading${h}"/>` : pPr.find(x => x.includes("pStyle")) ?? "",
          align ? `<w:jc w:val="${align === "justify" ? "both" : align}"/>` : pPr.find(x => x.includes("w:jc")) ?? "",
        ].filter(Boolean);
        if (name === "pre") st.code = true;
      } else {
        const i = blockStack.map(x => x.name).lastIndexOf(name);
        if (i >= 0) { pPr = blockStack[i].pPr; blockStack.splice(i); }
        if (name === "pre") st.code = false;
      }
      continue;
    }
    if (name === "td" || name === "th") { if (t[1] && runs.length) runs.push(textRun("　｜　", {})); continue; }
    runs.push(applyInlineTag(b, piece, st, stack));
  }
  flush();
}

/** 行內 token → runs */
function inline(b: Builder, children: Token[] | null): string {
  if (!children) return "";
  const st: RunStyle = {};
  const htmlStack: { name: string; prev: RunStyle }[] = [];
  const out: string[] = [];
  let linkRuns: string[] | null = null;
  let linkRid = "";
  const push = (x: string) => (linkRuns ?? out).push(x);
  let prevText = "";
  for (let i = 0; i < children.length; i++) {
    const t = children[i];
    switch (t.type) {
      case "text": push(textRun(t.content, st)); prevText = t.content; break;
      case "softbreak": {
        // 中文之間的換行不加空白
        const next = children[i + 1]?.content ?? "";
        if (!(isCjk(prevText.slice(-1)) && isCjk(next[0]))) push(textRun(" ", st));
        break;
      }
      case "hardbreak": push("<w:r><w:br/></w:r>"); break;
      case "strong_open": st.b = true; break;
      case "strong_close": st.b = false; break;
      case "em_open": st.i = true; break;
      case "em_close": st.i = false; break;
      case "s_open": st.s = true; break;
      case "s_close": st.s = false; break;
      case "code_inline": push(textRun(t.content, { ...st, code: true })); break;
      case "link_open": {
        const href = String(t.attrGet("href") ?? "");
        if (href.startsWith("#")) break;
        linkRid = b.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", href, true);
        st.link = href;
        linkRuns = [];
        break;
      }
      case "link_close":
        if (linkRuns) { out.push(`<w:hyperlink r:id="${linkRid}" w:history="1">${linkRuns.join("")}</w:hyperlink>`); linkRuns = null; }
        st.link = undefined;
        break;
      case "image": {
        const src = String(t.attrGet("src") ?? "");
        const a = b.assets.images.get(src);
        push(a ? b.image(a, t.content) : textRun(`[圖片：${t.content || src}]`, { i: true }));
        break;
      }
      case "math_inline": push(latexToOmml(t.content, false) ?? textRun(`$${t.content}$`, { i: true })); break;
      case "footnote_ref": {
        const label = String((t.meta as { label?: string; id: number })?.label ?? (t.meta as { id: number }).id);
        const id = b.footnoteIds.get(label) ?? (b.footnoteIds.set(label, b.footnoteIds.size + 1), b.footnoteIds.size);
        push(`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`);
        break;
      }
      case "html_inline":
        if ((t.meta as { trusted?: boolean } | null)?.trusted) push(textRun(/checked/.test(t.content) ? "☑ " : "☐ ", {}));
        else { const tag = sanitizeTag(t.content); if (tag) push(applyInlineTag(b, tag, st, htmlStack)); }
        break;
      default:
        if (t.content) push(textRun(t.content, st));
    }
  }
  return out.join("");
}

interface ListItem { numId: number; level: number; used: boolean }
interface Ctx { quote: number; items: ListItem[]; first: boolean }

function para(content: string, pPr: string[] = []): string {
  const pr = pPr.filter(Boolean).join("");
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ""}${content}</w:p>`;
}

/** 區塊 token → 段落；回傳下一個要處理的 index */
function blocks(b: Builder, toks: Token[], start: number, end: number, ctx: Ctx, out: string[]) {
  const listStack: { numId: number; ordered: boolean }[] = [];
  const headings: { level: number; text: string }[] = [];
  for (let i = start; i < end; i++) {
    const t = toks[i];
    const quotePr = ctx.quote ? `<w:pStyle w:val="Quote"/><w:ind w:left="${360 * ctx.quote}"/>` : "";
    switch (t.type) {
      case "heading_open": {
        const level = Number(t.tag.slice(1));
        const inl = toks[i + 1];
        const brk = b.settings.headingBreak && level <= b.settings.headingBreak && !ctx.first ? "<w:pageBreakBefore/>" : "";
        const text = inl.children?.filter(c => c.type === "text" || c.type === "code_inline").map(c => c.content).join("") ?? "";
        headings.push({ level, text });
        out.push(para(`<w:bookmarkStart w:id="${out.length}" w:name="_${esc(slugify(text, new Map())).slice(0, 38)}"/>${inline(b, inl.children)}<w:bookmarkEnd w:id="${out.length}"/>`,
          [`<w:pStyle w:val="Heading${level}"/>`, brk]));
        ctx.first = false;
        i += 2;
        break;
      }
      case "paragraph_open": {
        const inl = toks[i + 1];
        const item = ctx.items[ctx.items.length - 1];
        // 清單項目的第一段編號；同一項目的後續段落只縮排
        const listPr = !item ? ""
          : !item.used ? `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${item.level}"/><w:numId w:val="${item.numId}"/></w:numPr>`
          : `<w:pStyle w:val="ListParagraph"/><w:ind w:left="${480 * (item.level + 1)}"/>`;
        if (item) item.used = true;
        out.push(para(inline(b, inl.children), [listPr, quotePr]));
        ctx.first = false;
        i += 2;
        break;
      }
      case "bullet_list_open": case "ordered_list_open": {
        const ordered = t.type === "ordered_list_open";
        const startAttr = Number(t.attrGet("start") ?? 1) || 1;
        const parent = listStack[listStack.length - 1];
        const numId = !parent || parent.ordered !== ordered || ordered ? b.newList(ordered, startAttr) : parent.numId;
        listStack.push({ numId, ordered });
        break;
      }
      case "bullet_list_close": case "ordered_list_close": listStack.pop(); break;
      case "list_item_open": {
        const top = listStack[listStack.length - 1];
        ctx.items.push({ numId: top.numId, level: Math.min(8, listStack.length - 1), used: false });
        break;
      }
      case "list_item_close": ctx.items.pop(); break;
      case "blockquote_open": ctx.quote++; break;
      case "blockquote_close": ctx.quote = Math.max(0, ctx.quote - 1); break;
      case "fence": case "code_block": {
        const info = t.info.trim().split(/\s+/)[0]?.toLowerCase();
        if (info === "mermaid") {
          const png = b.assets.mermaidPng.get(t.content);
          if (png) { out.push(para(b.image(png, "圖表"), [`<w:jc w:val="center"/>`])); break; }
        }
        // 有上色結果時逐行輸出有顏色的文字；否則單色
        const segs = info ? b.assets.code.get(codeKey(info, t.content)) : undefined;
        if (segs) {
          let lineRuns: string[] = [];
          const flushLine = () => { out.push(para(lineRuns.join("") || textRun(" ", {}), [`<w:pStyle w:val="Code"/>`])); lineRuns = []; };
          const all = segs.slice();
          // 結尾的換行不另外產生空行
          const last = all[all.length - 1];
          if (last && last.text.endsWith("\n")) all[all.length - 1] = { ...last, text: last.text.slice(0, -1) };
          for (const s of all) {
            s.text.split("\n").forEach((part, k) => {
              if (k > 0) flushLine();
              if (part) lineRuns.push(textRun(part, { color: s.color, b: s.bold, i: s.italic }));
            });
          }
          flushLine();
        } else {
          const lines = t.content.replace(/\n$/, "").split("\n");
          lines.forEach(l => out.push(para(textRun(l || " ", {}), [`<w:pStyle w:val="Code"/>`])));
        }
        ctx.first = false;
        break;
      }
      case "math_block": {
        const om = latexToOmml(t.content, true);
        out.push(om ? `<w:p>${om}</w:p>` : para(textRun(t.content, { i: true }), [`<w:jc w:val="center"/>`]));
        ctx.first = false;
        break;
      }
      case "html_block":
        htmlBlock(b, sanitizeHtml(t.content), out);
        ctx.first = false;
        break;
      case "hr":
        out.push(para("", [`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>`]));
        break;
      case "page_break":
        out.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
        break;
      case "toc":
        out.push(tocField());
        break;
      case "table_open": {
        let j = i;
        while (j < end && toks[j].type !== "table_close") j++;
        out.push(table(b, toks.slice(i, j + 1)));
        ctx.first = false;
        i = j;
        break;
      }
      case "footnote_block_open": {
        let j = i;
        while (j < end && toks[j].type !== "footnote_block_close") j++;
        footnoteBlock(b, toks.slice(i + 1, j));
        i = j;
        break;
      }
      default: break;
    }
  }
  return headings;
}

function table(b: Builder, toks: Token[]): string {
  const rows: string[] = [];
  let cells: string[] = [];
  let header = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "thead_open") header = true;
    if (t.type === "thead_close") header = false;
    if (t.type === "tr_open") cells = [];
    if (t.type === "th_open" || t.type === "td_open") {
      const align = /text-align:(\w+)/.exec(String(t.attrGet("style") ?? ""))?.[1];
      const jc = align === "center" ? "center" : align === "right" ? "right" : "left";
      const content = inline(b, toks[i + 1].children);
      const runs = t.type === "th_open" ? content.replace(/<w:r>(?!<w:rPr>)/g, "<w:r><w:rPr><w:b/></w:rPr>") : content;
      cells.push(`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${t.type === "th_open" ? `<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>` : ""}</w:tcPr>${para(runs, [`<w:jc w:val="${jc}"/>`, `<w:spacing w:after="0"/>`])}</w:tc>`);
    }
    if (t.type === "tr_close") rows.push(`<w:tr>${header ? "<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>"}${cells.join("")}</w:tr>`);
  }
  const border = (s: string) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>`
    + `<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${rows.join("")}</w:tbl><w:p/>`;
}

function footnoteBlock(b: Builder, toks: Token[]) {
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== "footnote_open") continue;
    const meta = toks[i].meta as { id: number; label?: string };
    const label = String(meta.label ?? meta.id);
    const id = b.footnoteIds.get(label);
    let j = i;
    const paras: string[] = [];
    while (j < toks.length && toks[j].type !== "footnote_close") {
      if (toks[j].type === "inline") paras.push(inline(b, (toks[j].children ?? []).filter(c => c.type !== "footnote_anchor")));
      j++;
    }
    if (id) {
      const body = paras.map((p, k) => `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${k === 0 ? `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>` : ""}${p}</w:p>`).join("");
      b.footnotes[id] = `<w:footnote w:id="${id}">${body}</w:footnote>`;
    }
    i = j;
  }
}

function tocField(): string {
  return `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>目錄</w:t></w:r></w:p>`
    + `<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`
    + `<w:r><w:t>（開啟文件時選「是」更新目錄，或在目錄上按右鍵 → 更新功能變數）</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
}

const STYLES = (s: PrintSettings) => {
  const sz = Math.round(s.fontSize * 2);
  const line = Math.round(240 * s.lineHeight);
  const heading = (n: number, size: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n <= 2 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>`
    + `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="微軟正黑體"/><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS.w}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="新細明體" w:cs="Times New Roman"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
${heading(1, sz + 12)}${heading(2, sz + 6)}${heading(3, sz + 3)}${heading(4, sz)}${heading(5, sz)}${heading(6, sz)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BBBBBB"/></w:pBdr></w:pPr><w:rPr><w:color w:val="444444"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="細明體"/><w:sz w:val="${sz - 4}"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="InlineCode"><w:name w:val="Inline Code"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1D4ED8"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="${sz - 4}"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="${sz + 6}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
};

function numberingXml(b: Builder): string {
  const lvl = (ordered: boolean, i: number) => {
    const bullets = ["•", "◦", "▪"];
    const fmt = ordered ? ["decimal", "lowerLetter", "lowerRoman"][i % 3] : "bullet";
    const text = ordered ? `%${i + 1}.` : bullets[i % 3];
    return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${480 * (i + 1)}" w:hanging="360"/></w:pPr>${ordered ? "" : `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>`}</w:lvl>`;
  };
  const abstract = (id: number, ordered: boolean) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(ordered, i)).join("")}</w:abstractNum>`;
  const nums = b.numbering.map(n => `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="${n.ordered ? 1 : 0}"/>${n.ordered ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.start}"/></w:lvlOverride>` : ""}</w:num>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${NS.w}">${abstract(0, false)}${abstract(1, true)}${nums}</w:numbering>`;
}

function headerFooter(kind: "hdr" | "ftr", content: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind} xmlns:w="${NS.w}" xmlns:r="${NS.r}">${content}</w:${kind}>`;
}

const field = (instr: string) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

/** 文件第一個區塊是否就是與標題相同的一級標題 */
export function startsWithTitle(tokens: Token[], title: string): boolean {
  const i = tokens.findIndex(t => t.type !== "toc");
  const t = tokens[i];
  return !!t && t.type === "heading_open" && t.tag === "h1" && (tokens[i + 1]?.content ?? "").trim() === title.trim();
}

export function buildDocx(md: string, settings: PrintSettings, assets: ExportAssets): Uint8Array {
  const b = new Builder(settings, assets);
  const { tokens } = parseMarkdown(withToc(md, settings));
  const body: string[] = [];
  // 文件已用同名的 # 標題開頭時不再另加標題（避免重複）
  const showTitle = !!settings.title.trim() && !startsWithTitle(tokens, settings.title);
  if (showTitle) body.push(para(textRun(settings.title.trim(), {}), [`<w:pStyle w:val="Title"/>`]));
  // 註腳需要先編號：先掃過引用順序
  for (const t of tokens) t.children?.forEach(c => {
    if (c.type === "footnote_ref") {
      const label = String((c.meta as { label?: string; id: number }).label ?? (c.meta as { id: number }).id);
      if (!b.footnoteIds.has(label)) b.footnoteIds.set(label, b.footnoteIds.size + 1);
    }
  });
  blocks(b, tokens, 0, tokens.length, { quote: 0, items: [], first: !showTitle }, body);

  // 頁首頁尾
  const [w, h] = paperMm(settings).map(twip);
  const m = settings.margin;
  const sect: string[] = [];
  if (settings.header.trim()) {
    const rid = b.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", "header1.xml");
    sect.push(`<w:headerReference w:type="default" r:id="${rid}"/>`);
  }
  const hasFooter = settings.pageNumber !== "none" || settings.footer.trim();
  if (hasFooter) {
    const rid = b.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", "footer1.xml");
    sect.push(`<w:footerReference w:type="default" r:id="${rid}"/>`);
  }
  const footerContent = [
    settings.footer.trim() ? textRun(settings.footer.trim() + "　", {}) : "",
    settings.pageNumber === "page" ? textRun("第 ", {}) + field("PAGE") + textRun(" 頁", {}) : "",
    settings.pageNumber === "page-total" ? textRun("第 ", {}) + field("PAGE") + textRun(" 頁，共 ", {}) + field("NUMPAGES") + textRun(" 頁", {}) : "",
  ].join("");

  const sectPr = `<w:sectPr>${sect.join("")}<w:pgSz w:w="${w}" w:h="${h}"${settings.landscape ? ` w:orient="landscape"` : ""}/>`
    + `<w:pgMar w:top="${twip(m.top)}" w:right="${twip(m.right)}" w:bottom="${twip(m.bottom)}" w:left="${twip(m.left)}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${DOC_NS}><w:body>${body.join("")}${sectPr}</w:body></w:document>`;

  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:m="${NS.m}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}">`
    + `<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>`
    + `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`
    + b.footnotes.filter(Boolean).join("") + `</w:footnotes>`;

  const fixedRels = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>`,
    `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>`,
  ];
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fixedRels.join("")}`
    + b.rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ` TargetMode="External"` : ""}/>`).join("") + `</Relationships>`;

  const hasToc = tokens.some(t => t.type === "toc");
  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${NS.w}">${hasToc ? `<w:updateFields w:val="true"/>` : ""}<w:defaultTabStop w:val="480"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  const exts = [...new Set(b.media.map(x => x.ext))];
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + exts.map(e => `<Default Extension="${e}" ContentType="image/${e}"/>`).join("")
      + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
      + `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
      + `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`
      + `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>`
      + `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`
      + (settings.header.trim() ? `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` : "")
      + (hasFooter ? `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` : "")
      + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
      + `</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
      + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(settings.title)}</dc:title></cp:coreProperties>`),
    "word/document.xml": strToU8(documentXml),
    "word/_rels/document.xml.rels": strToU8(relsXml),
    "word/styles.xml": strToU8(STYLES(settings)),
    "word/numbering.xml": strToU8(numberingXml(b)),
    "word/footnotes.xml": strToU8(footnotesXml),
    "word/settings.xml": strToU8(settingsXml),
  };
  if (settings.header.trim()) files["word/header1.xml"] = strToU8(headerFooter("hdr", para(textRun(settings.header.trim(), {}), [`<w:pStyle w:val="Header"/>`])));
  if (hasFooter) files["word/footer1.xml"] = strToU8(headerFooter("ftr", para(footerContent, [`<w:pStyle w:val="Footer"/>`])));
  for (const x of b.media) files[`word/media/${x.name}`] = x.bytes;
  return zipSync(files);
}
