/**
 * Markdown 內嵌 HTML 的白名單過濾（編輯器預覽、匯出共用；不依賴 DOM，node 測試可跑）。
 * - 只留排版用的標籤與屬性；script／style／iframe 等連同內容移除，事件屬性（on*）一律移除
 * - 連結只允許 http(s)、mailto、站內錨點；圖片允許 http(s)、data:image、相對路徑（交給 resolveSrc）
 * - style 只留顏色、對齊、字級、粗細、寬高，值不得含 url( 或 expression
 * - 補齊沒關閉的標籤；<center>、<font> 轉成 div／span＋style（XHTML 也合法）
 * - <x/> 若不是空元素，比照瀏覽器當作開始標籤
 */

const BLOCK = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "blockquote", "pre", "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "details", "summary", "figure", "figcaption", "hr", "dl", "dt", "dd"];
const INLINE = ["span", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "sub", "sup", "mark", "kbd",
  "code", "small", "big", "abbr", "cite", "q", "a", "img", "br", "font", "center"];
const ALLOWED = new Set([...BLOCK, ...INLINE]);
const VOID = new Set(["br", "hr", "img"]);
/** 連同內容一起移除 */
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "select", "svg", "math", "canvas", "audio", "video", "frame", "frameset"]);

const ATTRS: Record<string, string[]> = {
  "*": ["title", "align", "style"],
  a: ["href"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan"], th: ["colspan", "rowspan"],
  details: ["open"],
  font: ["color", "size"],
  ol: ["start"],
};
const STYLE_PROPS = new Set(["color", "background-color", "background", "text-align", "font-size", "font-weight", "font-style",
  "text-decoration", "width", "height", "max-width", "margin-left", "margin-right", "padding"]);

export interface SanitizeOptions {
  /** 圖片相對路徑 → 可顯示網址；回傳空字串移除圖片 */
  resolveSrc?: (src: string) => string;
  /** 輸出 XHTML（空元素加 /） */
  xhtml?: boolean;
}

const escText = (s: string) => s.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decodeAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function cleanStyle(style: string): string {
  return style.split(";").map(d => {
    const i = d.indexOf(":");
    if (i < 0) return "";
    const prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || /url\s*\(|expression|javascript:|[<>"\\]/i.test(val) || val.length > 80) return "";
    return `${prop}: ${val}`;
  }).filter(Boolean).join("; ");
}

const FONT_SIZES = ["", "0.63em", "0.82em", "1em", "1.13em", "1.5em", "2em", "3em"];

function cleanAttrs(tag: string, raw: string, opts: SanitizeOptions): { tag: string; attrs: string } | null {
  const allowed = new Set([...(ATTRS["*"] ?? []), ...(ATTRS[tag] ?? [])]);
  const out: Record<string, string> = {};
  const styles: string[] = [];
  for (const m of raw.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const name = m[1].toLowerCase();
    const val = decodeAttr(m[2] ?? m[3] ?? m[4] ?? "");
    if (name.startsWith("on") || !allowed.has(name)) continue;
    if (name === "style") { const s = cleanStyle(val); if (s) styles.push(s); continue; }
    if (name === "align") { if (/^(left|center|right|justify)$/i.test(val)) styles.push(`text-align: ${val.toLowerCase()}`); continue; }
    if (name === "href") {
      if (!/^(https?:|mailto:|#)/i.test(val.trim())) continue;
      out.href = val.trim();
      continue;
    }
    if (name === "src") {
      const v = val.trim();
      if (/^(javascript|vbscript|file):/i.test(v) || (/^data:/i.test(v) && !/^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(v))) return null;
      const url = /^(https?:|data:)/i.test(v) ? v : opts.resolveSrc ? opts.resolveSrc(v) : v;
      if (!url) return null;
      out.src = url;
      continue;
    }
    if ((name === "width" || name === "height") && !/^\d+(%|px)?$/.test(val)) continue;
    if ((name === "colspan" || name === "rowspan" || name === "start") && !/^\d{1,3}$/.test(val)) continue;
    if (name === "color") { if (/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))$/i.test(val)) styles.push(`color: ${val}`); continue; }
    if (name === "size") { const n = Number(val); if (n >= 1 && n <= 7) styles.push(`font-size: ${FONT_SIZES[n]}`); continue; }
    if (name === "open") { out.open = "open"; continue; }
    out[name] = val;
  }
  let t = tag;
  if (tag === "center") { t = "div"; styles.unshift("text-align: center"); }
  if (tag === "font") t = "span";
  if (tag === "strike") t = "s";
  if (tag === "big") { t = "span"; styles.push("font-size: 1.2em"); }
  if (tag === "img" && !out.src) return null;
  if (tag === "a" && out.href && !out.href.startsWith("#")) { out.target = "_blank"; out.rel = "noopener noreferrer"; }
  if (styles.length) out.style = styles.join("; ");
  const attrs = Object.entries(out).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  return { tag: t, attrs };
}

/** 過濾並補齊 HTML 片段 */
export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): string {
  const out: string[] = [];
  const stack: { src: string; out: string }[] = [];
  let dropDepth = 0;
  let dropTag = "";
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:doctype)?[^>]*>|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (dropDepth) {
      const close = m[1]?.toLowerCase(), open = m[2]?.toLowerCase();
      if (open === dropTag && !m[4]) dropDepth++;
      if (close === dropTag) dropDepth--;
      continue;
    }
    if (m[5] !== undefined) { out.push(escText(m[5])); continue; }
    if (m[1]) {
      const name = m[1].toLowerCase();
      const i = stack.map(s => s.src).lastIndexOf(name);
      if (i < 0) continue;
      // 關閉中間沒關的標籤
      while (stack.length > i) out.push(`</${stack.pop()!.out}>`);
      continue;
    }
    if (m[2]) {
      const name = m[2].toLowerCase();
      if (DROP_CONTENT.has(name)) { if (!m[4]) { dropDepth = 1; dropTag = name; } continue; }
      if (!ALLOWED.has(name)) continue;
      const c = cleanAttrs(name, m[3] ?? "", opts);
      if (!c) continue;
      if (VOID.has(name)) { out.push(`<${c.tag}${c.attrs}${opts.xhtml ? " />" : ">"}`); continue; }
      // 段落內不能再開段落：遇到新的 p 先關掉上一個
      if (name === "p" && stack.length && stack[stack.length - 1].src === "p") out.push(`</${stack.pop()!.out}>`);
      out.push(`<${c.tag}${c.attrs}>`);
      stack.push({ src: name, out: c.tag });
      continue;
    }
    // 註解、doctype：丟掉
  }
  while (stack.length) out.push(`</${stack.pop()!.out}>`);
  return out.join("");
}

/** 只過濾單一標籤（markdown-it 的行內 HTML 是一個個分開的標籤），不補齊 */
export function sanitizeTag(tag: string, opts: SanitizeOptions = {}): string {
  const m = /^<\/\s*([a-zA-Z][\w-]*)\s*>$|^<([a-zA-Z][\w-]*)([\s\S]*?)\s*(\/?)>$/.exec(tag.trim());
  if (!m) return "";
  if (m[1]) {
    const name = m[1].toLowerCase();
    if (!ALLOWED.has(name) || VOID.has(name)) return "";
    return `</${name === "center" ? "div" : name === "font" || name === "big" ? "span" : name === "strike" ? "s" : name}>`;
  }
  const name = m[2].toLowerCase();
  if (!ALLOWED.has(name)) return "";
  const c = cleanAttrs(name, m[3] ?? "", opts);
  if (!c) return "";
  return VOID.has(name) ? `<${c.tag}${c.attrs}${opts.xhtml ? " />" : ">"}` : `<${c.tag}${c.attrs}>`;
}
