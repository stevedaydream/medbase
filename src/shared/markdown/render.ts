import MarkdownIt from "markdown-it";
import type { StateBlock, StateInline, Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import katex from "katex";

/**
 * 共用 Markdown 渲染（編輯器內預覽、HTML／PDF／EPUB 匯出）。
 * - 原文中的 HTML 不輸出（html: false），只認得 <!-- pagebreak --> 分頁標記
 * - 支援：GFM 表格、刪除線、待辦、註腳、$行內$／$$區塊$$ 公式（KaTeX）、```mermaid、[TOC]、YAML front matter
 */
export interface RenderOptions {
  /** 圖片網址轉換（相對路徑 → 可顯示的網址）；回傳空字串顯示替代文字 */
  image?: (src: string) => string;
  /** 公式輸出：html（需載入 KaTeX CSS）或 mathml（匯出用，不需字型） */
  math?: "html" | "mathml";
  /** mermaid 原始碼 → 已繪好的 SVG（匯出時提供）；回傳 null 時輸出原始碼 */
  mermaid?: (code: string) => string | null;
  /** 輸出 XHTML（EPUB） */
  xhtml?: boolean;
}

export const PAGE_BREAK = "<!-- pagebreak -->";
const PAGE_BREAK_RE = /^\s*<!--\s*pagebreak\s*-->\s*$/i;

/** 開頭的 YAML front matter（--- … ---），回傳內容與本文起點 */
export function splitFrontMatter(src: string): { yaml: string | null; body: string; offset: number } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { yaml: null, body: src, offset: 0 };
  return { yaml: m[1], body: src.slice(m[0].length), offset: m[0].length };
}

export function renderMath(tex: string, display: boolean, output: "html" | "mathml" = "html"): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, output, strict: "ignore" });
}

/** 標題錨點：中文保留，空白改成 -，重複時加序號 */
export function slugify(text: string, used: Map<string, number>): string {
  const base = text.trim().toLowerCase().replace(/[\s]+/g, "-").replace(/[^\p{L}\p{N}\-_]/gu, "") || "section";
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src, start = state.pos;
  if (src[start] !== "$" || src[start + 1] === "$") return false;
  // $ 後不能是空白、前一字不能是跳脫
  if (/\s/.test(src[start + 1] ?? " ")) return false;
  let end = start + 1;
  while ((end = src.indexOf("$", end)) !== -1) {
    if (src[end - 1] !== "\\" && !/\s/.test(src[end - 1])) break;
    end++;
  }
  if (end === -1 || end === start + 1) return false;
  // 結尾 $ 後緊接數字時不算公式（例如「$5 與 $10」）
  if (/\d/.test(src[end + 1] ?? "")) return false;
  if (!silent) {
    const tok = state.push("math_inline", "math", 0);
    tok.content = src.slice(start + 1, end);
    tok.markup = "$";
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const first = state.src.slice(pos, max).trim();
  if (!first.startsWith("$$")) return false;
  if (silent) return true;
  // 單行 $$ … $$
  if (first.length > 4 && first.endsWith("$$")) {
    const tok = state.push("math_block", "math", 0);
    tok.content = first.slice(2, -2).trim();
    tok.map = [startLine, startLine + 1];
    tok.markup = "$$";
    state.line = startLine + 1;
    return true;
  }
  let next = startLine;
  const lines: string[] = [first.slice(2)];
  let closed = false;
  while (++next < endLine) {
    const s = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
    if (s.trim().endsWith("$$")) { lines.push(s.trim().slice(0, -2)); closed = true; break; }
    lines.push(s);
  }
  if (!closed) return false;
  const tok = state.push("math_block", "math", 0);
  tok.content = lines.join("\n").trim();
  tok.map = [startLine, next + 1];
  tok.markup = "$$";
  state.line = next + 1;
  return true;
}

function simpleLineRule(name: string, test: (line: string) => boolean) {
  return (state: StateBlock, startLine: number, _end: number, silent: boolean) => {
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
    if (!test(line)) return false;
    if (silent) return true;
    const tok = state.push(name, "", 0);
    tok.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  };
}

export interface Heading { level: number; text: string; id: string }

export function createRenderer(opts: RenderOptions = {}): ReturnType<typeof MarkdownIt> {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, xhtmlOut: !!opts.xhtml });
  md.use(footnote);
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.block.ruler.before("paragraph", "page_break", simpleLineRule("page_break", l => PAGE_BREAK_RE.test(l)));
  md.block.ruler.before("paragraph", "toc", simpleLineRule("toc", l => /^\[toc\]\s*$/i.test(l.trim())));

  const output = opts.math ?? "html";
  md.renderer.rules.math_inline = (t, i) => renderMath(t[i].content, false, output);
  md.renderer.rules.math_block = (t, i) => `<div class="md-math">${renderMath(t[i].content, true, output)}</div>\n`;
  md.renderer.rules.page_break = () => `<div class="md-pagebreak"></div>\n`;
  md.renderer.rules.toc = (_t, _i, _o, env) => {
    const hs = ((env as { headings?: Heading[] }).headings) ?? [];
    if (!hs.length) return "";
    const min = Math.min(...hs.map(h => h.level));
    return `<nav class="md-toc">${hs.map(h =>
      `<a class="md-toc-${h.level - min + 1}" href="#${md.utils.escapeHtml(h.id)}">${md.utils.escapeHtml(h.text)}</a>`).join("")}</nav>\n`;
  };

  // ```mermaid：輸出原始碼容器，由呼叫端（瀏覽器）轉成 SVG
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, o, env, self) => {
    const info = tokens[idx].info.trim().split(/\s+/)[0]?.toLowerCase();
    if (info === "mermaid") {
      const svg = opts.mermaid?.(tokens[idx].content);
      if (svg) return `<figure class="md-mermaid">${svg}</figure>\n`;
      return `<pre class="mermaid">${md.utils.escapeHtml(tokens[idx].content)}</pre>\n`;
    }
    return fence(tokens, idx, o, env, self);
  };

  // 圖片網址
  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, o, env, self) => {
    const tok = tokens[idx];
    const src = String(tok.attrGet("src") ?? "");
    if (opts.image) {
      const url = opts.image(src);
      if (!url) return `<span class="md-img-missing">[${md.utils.escapeHtml(tok.content || src)}]</span>`;
      tok.attrSet("src", url);
    }
    return image(tokens, idx, o, env, self);
  };

  // 標題錨點＋收集大綱；待辦清單核取方塊
  md.core.ruler.push("headings_tasks", state => {
    const used = new Map<string, number>();
    const headings: Heading[] = [];
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === "heading_open") {
        const text = toks[i + 1]?.children?.filter(c => c.type === "text" || c.type === "code_inline").map(c => c.content).join("") ?? "";
        const id = slugify(text, used);
        t.attrSet("id", id);
        headings.push({ level: Number(t.tag.slice(1)), text, id });
      }
      if (t.type === "inline" && toks[i - 1]?.type === "paragraph_open" && toks[i - 2]?.type === "list_item_open") {
        const first = t.children?.[0];
        const m = first?.type === "text" ? /^\[([ xX])\]\s+/.exec(first.content) : null;
        if (first && m) {
          first.content = first.content.slice(m[0].length);
          const box = new state.Token("html_inline", "", 0);
          box.content = opts.xhtml
            ? `<input type="checkbox" disabled="disabled"${m[1] === " " ? "" : ' checked="checked"'} /> `
            : `<input type="checkbox" disabled${m[1] === " " ? "" : " checked"}> `;
          t.children!.unshift(box);
          toks[i - 2].attrJoin("class", "md-task");
        }
      }
    }
    (state.env as { headings?: Heading[] }).headings = headings;
  });
  return md;
}

/** 整份文件轉 HTML（front matter 不輸出） */
export function renderMarkdown(src: string, opts: RenderOptions = {}): { html: string; headings: Heading[]; frontMatter: string | null } {
  const { yaml, body } = splitFrontMatter(src);
  const md = createRenderer(opts);
  // 標題在解析階段收集，[TOC] 渲染時已知全部標題
  const env: { headings?: Heading[] } = {};
  const html = md.renderer.render(md.parse(body, env), md.options, env);
  return { html, headings: env.headings ?? [], frontMatter: yaml };
}

/** 給 Word／LaTeX 轉換用的 token 序列 */
export type { Token };
export function parseMarkdown(src: string): { tokens: Token[]; env: Record<string, unknown>; frontMatter: string | null } {
  const { yaml, body } = splitFrontMatter(src);
  const md = createRenderer();
  const env: Record<string, unknown> = {};
  return { tokens: md.parse(body, env), env, frontMatter: yaml };
}
