import { Facet } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { createRenderer, renderMath } from "@/shared/markdown/render";
import { sanitizeHtml } from "@/shared/markdown/sanitize";
import type { OutlineItem } from "./outline";

/**
 * 即時排版用的顯示元件（表格、公式、Mermaid、圖片、front matter、目錄、分頁）。
 * 顯示內容都由原文產生；點一下就把游標移進原文，改回原文編輯。
 */

/** 圖片網址解析：相對路徑 → 可顯示的網址（由使用編輯器的頁面提供） */
export type ImageResolver = (src: string) => Promise<string> | string;
export const imageResolver = Facet.define<ImageResolver, ImageResolver | null>({ combine: v => v[0] ?? null });

/** 貼上／拖入圖片：存檔並回傳要寫進 Markdown 的路徑；回傳 null 代表不支援 */
export type ImageSaver = (file: File) => Promise<string | null>;
export const imageSaver = Facet.define<ImageSaver, ImageSaver | null>({ combine: v => v[0] ?? null });

const renderer = createRenderer();

function moveInto(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos } });
  view.focus();
}

abstract class BlockWidget extends WidgetType {
  constructor(readonly source: string, readonly pos: number) { super(); }
  eq(o: BlockWidget) { return o.source === this.source && o.pos === this.pos && o.constructor === this.constructor; }
  abstract render(dom: HTMLElement, view: EditorView): void;
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = `cm-md-block ${this.cls}`;
    this.render(dom, view);
    dom.addEventListener("mousedown", e => {
      if ((e.target as HTMLElement).closest("a[data-pos]")) return;
      e.preventDefault();
      moveInto(view, this.pos);
    });
    return dom;
  }
  abstract get cls(): string;
  ignoreEvent() { return false; }
}

export class TableWidget extends BlockWidget {
  get cls() { return "cm-md-table"; }
  render(dom: HTMLElement) { dom.innerHTML = renderer.render(this.source); }
}

export class MathBlockWidget extends BlockWidget {
  get cls() { return "cm-md-mathblock"; }
  render(dom: HTMLElement) { dom.innerHTML = renderMath(this.source, true); }
}

export class FrontMatterWidget extends BlockWidget {
  get cls() { return "cm-md-frontmatter"; }
  render(dom: HTMLElement) {
    dom.title = "文件屬性（YAML front matter），點一下編輯";
    const rows = this.source.split("\n").filter(l => l.trim());
    dom.textContent = "";
    const head = document.createElement("div");
    head.className = "cm-md-fm-head";
    head.textContent = "文件屬性";
    dom.appendChild(head);
    for (const l of rows) {
      const line = document.createElement("div");
      const m = /^([^:#]+):\s*(.*)$/.exec(l);
      if (m) {
        const k = document.createElement("span"); k.className = "cm-md-fm-key"; k.textContent = m[1].trim();
        const v = document.createElement("span"); v.textContent = m[2];
        line.append(k, v);
      } else line.textContent = l;
      dom.appendChild(line);
    }
  }
}

/** 原文 HTML 區塊：白名單過濾後顯示；相對路徑圖片非同步換成可顯示網址 */
export class HtmlWidget extends BlockWidget {
  get cls() { return "cm-md-html"; }
  render(dom: HTMLElement, view: EditorView) {
    const PENDING = "md-pending:";
    // 先放進 template（不會載入圖片），換好網址再放進畫面
    const tpl = document.createElement("template");
    const clean = sanitizeHtml(this.source, { resolveSrc: s => PENDING + encodeURIComponent(s) });
    // 整段都被過濾掉（例如 <script>）：顯示提示，避免看起來像空白
    if (!clean.replace(/<[^>]+>/g, "").trim() && !/<(img|hr|br)\b/.test(clean)) {
      dom.textContent = "（已略過不支援的 HTML，點一下查看原文）";
      dom.classList.add("cm-md-html-skipped");
      return;
    }
    tpl.innerHTML = clean;
    const resolve = view.state.facet(imageResolver);
    for (const img of Array.from(tpl.content.querySelectorAll("img"))) {
      const raw = img.getAttribute("src") ?? "";
      if (!raw.startsWith(PENDING)) continue;
      const src = decodeURIComponent(raw.slice(PENDING.length));
      img.removeAttribute("src");
      const fail = () => { img.replaceWith(Object.assign(document.createElement("span"), { className: "cm-md-error", textContent: `🖼 ${img.alt || src}（找不到圖片）` })); };
      if (!resolve) { fail(); continue; }
      Promise.resolve(resolve(src)).then(u => { if (u) img.src = u; else fail(); }).catch(fail);
    }
    dom.appendChild(tpl.content);
  }
}

export class PageBreakWidget extends BlockWidget {
  get cls() { return "cm-md-pagebreak"; }
  render(dom: HTMLElement) { dom.textContent = "分頁"; dom.title = "列印與匯出時從這裡換頁"; }
}

export class TocWidget extends BlockWidget {
  constructor(source: string, pos: number, readonly items: OutlineItem[]) { super(source, pos); }
  eq(o: TocWidget) { return super.eq(o) && JSON.stringify(o.items) === JSON.stringify(this.items); }
  get cls() { return "cm-md-toc"; }
  render(dom: HTMLElement, view: EditorView) {
    const head = document.createElement("div");
    head.className = "cm-md-fm-head";
    head.textContent = "目錄";
    dom.appendChild(head);
    if (!this.items.length) { const p = document.createElement("div"); p.textContent = "（沒有標題）"; dom.appendChild(p); }
    const min = Math.min(...this.items.map(i => i.level), 6);
    for (const it of this.items) {
      const a = document.createElement("a");
      a.textContent = it.text;
      a.dataset.pos = String(it.pos);
      a.style.paddingLeft = `${(it.level - min) * 1}rem`;
      a.addEventListener("mousedown", e => {
        e.preventDefault();
        view.dispatch({ selection: { anchor: it.pos }, effects: EditorView.scrollIntoView(it.pos, { y: "start" }) });
        view.focus();
      });
      dom.appendChild(a);
    }
  }
}

let mermaidSeq = 0;
let mermaidReady: Promise<typeof import("mermaid")["default"]> | null = null;
function loadMermaid() {
  mermaidReady ??= import("mermaid").then(m => m.default);
  return mermaidReady;
}
const isDark = () => document.documentElement.dataset.theme === "dark";

/** Mermaid 轉 SVG（編輯器與匯出共用） */
export async function renderMermaid(code: string, theme: "dark" | "default" = isDark() ? "dark" : "default", forExport = false): Promise<string> {
  const mermaid = await loadMermaid();
  // 匯出時不用 HTML 標籤（foreignObject）：EPUB 需要合法 XHTML，轉 PNG 時 canvas 也不會被鎖
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, htmlLabels: !forExport, flowchart: { htmlLabels: !forExport } });
  const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, code);
  return svg;
}

export class MermaidWidget extends BlockWidget {
  get cls() { return "cm-md-mermaid"; }
  render(dom: HTMLElement) {
    dom.textContent = "圖表繪製中…";
    renderMermaid(this.source)
      .then(svg => { dom.innerHTML = svg; })
      .catch(e => { dom.textContent = `圖表語法錯誤：${(e as Error).message?.split("\n")[0] ?? e}`; dom.classList.add("cm-md-error"); });
  }
}

const imageCache = new Map<string, Promise<string>>();

export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly pos: number) { super(); }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-image";
    const img = document.createElement("img");
    img.alt = this.alt;
    img.title = this.alt || this.src;
    const resolve = view.state.facet(imageResolver);
    const fail = () => { wrap.textContent = `🖼 ${this.alt || this.src}（找不到圖片）`; wrap.classList.add("cm-md-error"); };
    const direct = /^(https?:|data:|blob:)/i.test(this.src);
    const url = direct ? Promise.resolve(this.src) : resolve
      ? (imageCache.get(this.src) ?? (() => { const p = Promise.resolve(resolve(this.src)); imageCache.set(this.src, p); return p; })())
      : Promise.resolve("");
    url.then(u => { if (!u) fail(); else img.src = u; }).catch(fail);
    img.onerror = fail;
    wrap.appendChild(img);
    wrap.addEventListener("mousedown", e => { e.preventDefault(); moveInto(view, this.pos); });
    return wrap;
  }
  ignoreEvent() { return false; }
}

/** 文件位置改變（另一份文件）時清掉圖片快取 */
export const clearImageCache = () => imageCache.clear();

export class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string, readonly pos: number) { super(); }
  eq(o: InlineMathWidget) { return o.tex === this.tex && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const s = document.createElement("span");
    s.className = "cm-md-math";
    s.innerHTML = renderMath(this.tex, false);
    s.addEventListener("mousedown", e => { e.preventDefault(); moveInto(view, this.pos + 1); });
    return s;
  }
  ignoreEvent() { return false; }
}

// ── 程式碼區塊語言標籤（Typora 風格）──────────────────────────────

interface LangOption { label: string; value: string; keys: string }
let langOptions: LangOption[] | null = null;
/** 語言清單：CodeMirror 支援上色的語言＋ Mermaid 圖表 */
function getLangOptions(): LangOption[] {
  if (langOptions) return langOptions;
  const opts: LangOption[] = languages.map(d => {
    const simple = d.name.toLowerCase().replace(/\s+/g, "");
    const value = /^[a-z0-9-]+$/.test(simple) ? simple : (d.alias.find(a => /^[a-z0-9-]+$/.test(a)) ?? simple);
    return { label: d.name, value, keys: [d.name, ...d.alias, ...d.extensions].join(" ").toLowerCase() };
  });
  opts.push({ label: "Mermaid 圖表", value: "mermaid", keys: "mermaid 圖表 flowchart diagram" });
  opts.push({ label: "純文字", value: "text", keys: "text plain txt 純文字" });
  langOptions = opts.sort((a, b) => a.label.localeCompare(b.label));
  return langOptions;
}

function langLabel(lang: string): string {
  if (!lang) return "";
  const l = lang.split(/\s+/)[0];
  if (l.toLowerCase() === "mermaid") return "Mermaid 圖表";
  return LanguageDescription.matchLanguageName(languages, l, true)?.name ?? l;
}

export class CodeLangWidget extends WidgetType {
  constructor(readonly lang: string, readonly lineFrom: number, readonly code: string) { super(); }
  eq(o: CodeLangWidget) { return o.lang === this.lang && o.lineFrom === this.lineFrom && o.code === this.code; }

  /** 把開頭圍欄的語言改成 value */
  private setLang(view: EditorView, value: string) {
    const line = view.state.doc.lineAt(this.lineFrom);
    const m = /^(\s*)(`{3,}|~{3,})/.exec(line.text);
    if (!m) return;
    const from = line.from + m[0].length;
    view.dispatch({ changes: { from, to: line.to, insert: value }, userEvent: "input" });
    view.focus();
  }

  toDOM(view: EditorView) {
    const bar = document.createElement("span");
    bar.className = "cm-md-codebar";
    const langBtn = document.createElement("button");
    langBtn.type = "button";
    langBtn.className = "cm-md-codelang";
    langBtn.textContent = langLabel(this.lang) || "選擇語言";
    if (!this.lang) langBtn.classList.add("cm-md-codelang-empty");
    langBtn.title = "選擇程式語言（上色依此語言）";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "cm-md-codecopy";
    copyBtn.textContent = "複製";
    copyBtn.title = "複製程式碼";
    copyBtn.addEventListener("mousedown", e => e.preventDefault());
    copyBtn.addEventListener("click", async e => {
      e.preventDefault();
      try { await navigator.clipboard.writeText(this.code); copyBtn.textContent = "已複製"; }
      catch { copyBtn.textContent = "無法複製"; }
      setTimeout(() => { copyBtn.textContent = "複製"; }, 1500);
    });

    let menu: HTMLElement | null = null;
    const close = () => { menu?.remove(); menu = null; document.removeEventListener("mousedown", outside, true); };
    const outside = (e: MouseEvent) => { if (!bar.contains(e.target as Node)) close(); };
    langBtn.addEventListener("mousedown", e => e.preventDefault());
    langBtn.addEventListener("click", e => {
      e.preventDefault();
      if (menu) { close(); return; }
      menu = document.createElement("span");
      menu.className = "cm-md-langmenu";
      const input = document.createElement("input");
      input.placeholder = "搜尋語言…";
      input.value = "";
      const list = document.createElement("span");
      list.className = "cm-md-langlist";
      let active = 0;
      let shown: LangOption[] = [];
      const render = () => {
        const q = input.value.trim().toLowerCase();
        shown = getLangOptions().filter(o => !q || o.keys.includes(q) || o.label.toLowerCase().includes(q)).slice(0, 80);
        // 輸入的文字不在清單時，也可以直接用（自訂語言名稱）
        if (q && !shown.some(o => o.value === q)) shown.push({ label: `使用「${input.value.trim()}」`, value: input.value.trim(), keys: q });
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.textContent = "";
        shown.forEach((o, i) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = `cm-md-langitem${i === active ? " cm-md-langitem-active" : ""}${o.value === this.lang ? " cm-md-langitem-current" : ""}`;
          item.textContent = o.label;
          item.addEventListener("mousedown", ev => { ev.preventDefault(); close(); this.setLang(view, o.value); });
          list.appendChild(item);
        });
      };
      input.addEventListener("input", () => { active = 0; render(); });
      input.addEventListener("keydown", ev => {
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          ev.preventDefault();
          active = (active + (ev.key === "ArrowDown" ? 1 : shown.length - 1)) % Math.max(1, shown.length);
          render();
          list.children[active]?.scrollIntoView({ block: "nearest" });
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          const o = shown[active];
          close();
          if (o) this.setLang(view, o.value);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          close();
          view.focus();
        }
        ev.stopPropagation();
      });
      menu.append(input, list);
      bar.appendChild(menu);
      render();
      input.focus();
      document.addEventListener("mousedown", outside, true);
    });

    // 點標籤列空白處：游標移到圍欄行，改為編輯原文
    bar.addEventListener("mousedown", e => {
      if ((e.target as HTMLElement).closest("button, input, .cm-md-langmenu")) return;
      e.preventDefault();
      const line = view.state.doc.lineAt(this.lineFrom);
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });
    bar.append(langBtn, copyBtn);
    return bar;
  }
  // 標籤列內的點擊、輸入都由元件自己處理，不交給編輯器
  ignoreEvent() { return true; }
}
