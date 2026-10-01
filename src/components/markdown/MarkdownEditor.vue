<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, shallowRef, nextTick } from "vue";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { syntaxHighlighting, syntaxTree, HighlightStyle, defaultHighlightStyle } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import "katex/dist/katex.min.css";
import { livePreview } from "./livePreview";
import { blockPreview } from "./blockPreview";
import { focusMode } from "./focusMode";
import { imageResolver, imageSaver, clearImageCache, type ImageResolver, type ImageSaver } from "./widgets";
import { outlineOf, type OutlineItem } from "./outline";
import {
  toggleWrap, setHeading, toggleBullet, toggleOrdered, toggleTask, toggleQuote, insertLink, insertHr,
  insertTable, insertMathBlock, insertCodeBlock, insertMermaid, insertToc, insertPageBreak, toggleInlineMath,
  insertFootnote, insertImage, tableAddRow, tableDelRow, tableAddCol, tableDelCol, tableAlign, tableFormat,
  tableNextCell, tableAt,
} from "./commands";
import type { Align } from "@/shared/markdown/table";

/**
 * Markdown 編輯器（CodeMirror 6，ADR-019）。
 * 內容永遠是 Markdown 原文；「排版」模式以裝飾隱藏語法並預覽表格、公式、圖表、圖片，
 * 「原始碼」模式顯示全部原文。換成另一份文件時（modelValue 由外部改變）重建狀態，復原紀錄不跨文件。
 */
const props = withDefaults(defineProps<{
  modelValue: string;
  source?: boolean;
  placeholder?: string;
  /** 相對路徑圖片 → 可顯示網址 */
  resolveImage?: ImageResolver;
  /** 貼上／拖入圖片時存檔，回傳寫進 Markdown 的路徑；不提供時不接受圖片 */
  saveImage?: ImageSaver;
  /** 專注模式：只有游標所在段落是正常顏色 */
  focus?: boolean;
  /** 打字機模式：游標所在行維持在畫面中間 */
  typewriter?: boolean;
  /** 多分頁時是否為目前分頁（隱藏時記住捲動位置，顯示時還原） */
  active?: boolean;
}>(), { source: false, placeholder: "", focus: false, typewriter: false, active: true });
const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "update:source", v: boolean): void;
  (e: "outline", items: OutlineItem[]): void;
  (e: "cursor", pos: number): void;
  (e: "inTable", v: boolean): void;
  (e: "notice", msg: string): void;
}>();

const host = ref<HTMLDivElement>();
const view = shallowRef<EditorView>();
const preview = new Compartment();
const focusComp = new Compartment();
let lastEmitted = props.modelValue;

const highlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--color-accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--color-muted)" },
  { tag: t.monospace, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.9em" },
  { tag: t.processingInstruction, color: "var(--color-muted)" },
  { tag: t.quote, color: "var(--color-fg-secondary)" },
  { tag: t.contentSeparator, color: "var(--color-muted)" },
]);

// CodeMirror 內建介面文字（搜尋面板）
const zhPhrases = EditorState.phrases.of({
  "Find": "搜尋", "Replace": "取代", "next": "下一個", "previous": "上一個", "all": "全部",
  "match case": "大小寫", "by word": "整個字", "regexp": "正規表示式", "replace": "取代", "replace all": "全部取代",
  "close": "關閉", "current match": "目前結果", "on line": "第幾行", "replaced $ matches": "已取代 $ 處",
  "replaced match on line $": "已取代第 $ 行", "Go to line": "跳到行", "go": "前往",
});

const shortcuts = keymap.of([
  { key: "Mod-b", run: v => toggleWrap(v, "**") },
  { key: "Mod-i", run: v => toggleWrap(v, "*") },
  { key: "Alt-Shift-5", run: v => toggleWrap(v, "~~") },
  { key: "Mod-Shift-`", run: v => toggleWrap(v, "`") },
  { key: "Mod-Shift-m", run: insertMathBlock },
  { key: "Mod-Shift-k", run: v => insertCodeBlock(v) },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-t", run: v => insertTable(v) },
  ...[0, 1, 2, 3, 4, 5, 6].map(n => ({ key: `Mod-${n}`, run: (v: EditorView) => setHeading(v, n) })),
  { key: "Mod-Shift-]", run: toggleBullet },
  { key: "Mod-Shift-[", run: toggleOrdered },
  { key: "Mod-Shift-q", run: toggleQuote },
  { key: "Mod-Enter", run: v => tableAt(v.state) ? tableAddRow(v) : false },
  { key: "Tab", run: v => tableNextCell(v, 1) },
  { key: "Shift-Tab", run: v => tableNextCell(v, -1) },
  { key: "Mod-/", run: () => { emit("update:source", !props.source); return true; } },
]);

/** 貼上／拖入圖片：交給 saveImage 存檔後插入語法 */
const imageEvents = EditorView.domEventHandlers({
  paste(e, v) { return handleImageFiles(v, e.clipboardData?.files, e); },
  drop(e, v) {
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos != null && e.dataTransfer?.files.length) v.dispatch({ selection: { anchor: pos } });
    return handleImageFiles(v, e.dataTransfer?.files, e);
  },
});
function handleImageFiles(v: EditorView, files: FileList | undefined, e: Event): boolean {
  const imgs = Array.from(files ?? []).filter(f => f.type.startsWith("image/"));
  if (!imgs.length) return false;
  e.preventDefault();
  const saver = v.state.facet(imageSaver);
  if (!saver) { emit("notice", "這裡不能放圖片（內容會同步到雲端，請改用圖片網址）"); return true; }
  (async () => {
    for (const f of imgs) {
      try {
        const path = await saver(f);
        if (path) insertImage(v, path, f.name.replace(/\.[^.]+$/, ""));
      } catch (err) {
        emit("notice", `圖片儲存失敗：${(err as Error).message}`);
      }
    }
  })();
  return true;
}

// 大綱：編輯時延後計算，長文件不卡打字
let outlineTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleOutline(state: EditorState) {
  if (outlineTimer) clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => emit("outline", outlineOf(state)), 250);
}
const syntaxTreeChanged = (u: ViewUpdate) => syntaxTree(u.startState) !== syntaxTree(u.state);
let wasInTable = false;

const previewExt = (source: boolean): Extension => (source ? [] : [livePreview, blockPreview]);

function createState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      // 程式碼區塊依語言名稱（```ts）載入高亮
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(highlight),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      search({ top: true }),
      highlightSelectionMatches(),
      zhPhrases,
      shortcuts,
      keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      cmPlaceholder(props.placeholder),
      props.resolveImage ? imageResolver.of(props.resolveImage) : [],
      props.saveImage ? imageSaver.of(props.saveImage) : [],
      imageEvents,
      preview.of(previewExt(props.source)),
      focusComp.of(props.focus ? focusMode : []),
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      EditorView.updateListener.of(u => {
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head;
          emit("cursor", head);
          const inTable = !!tableAt(u.state);
          if (inTable !== wasInTable) { wasInTable = inTable; emit("inTable", inTable); }
          if (props.typewriter && !u.view.composing) {
            queueMicrotask(() => u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) }));
          }
        }
        if (u.docChanged || syntaxTreeChanged(u)) scheduleOutline(u.state);
        if (!u.docChanged) return;
        lastEmitted = u.state.doc.toString();
        emit("update:modelValue", lastEmitted);
      }),
    ],
  });
}

onMounted(() => {
  view.value = new EditorView({ state: createState(props.modelValue), parent: host.value! });
  scheduleOutline(view.value.state);
});
onBeforeUnmount(() => { if (outlineTimer) clearTimeout(outlineTimer); view.value?.destroy(); });

watch(() => props.modelValue, v => {
  if (!view.value || v === lastEmitted) return;
  lastEmitted = v;
  clearImageCache();
  view.value.setState(createState(v));
  scheduleOutline(view.value.state);
});
watch(() => props.source, s => {
  view.value?.dispatch({ effects: preview.reconfigure(previewExt(s)) });
});
watch(() => props.focus, f => {
  view.value?.dispatch({ effects: focusComp.reconfigure(f ? focusMode : []) });
});

// 分頁隱藏時記住捲動位置與游標，顯示時還原
let savedScroll = 0;
watch(() => props.active, async a => {
  const v = view.value;
  if (!v) return;
  if (!a) { savedScroll = v.scrollDOM.scrollTop; return; }
  await nextTick();
  v.requestMeasure();
  v.scrollDOM.scrollTop = savedScroll;
  v.focus();
});

/** 跳到指定位置並捲到畫面上方 */
function jumpTo(pos: number) {
  const v = view.value;
  if (!v) return;
  const p = Math.min(pos, v.state.doc.length);
  v.dispatch({ selection: { anchor: p }, effects: EditorView.scrollIntoView(p, { y: "start", yMargin: 24 }) });
  v.focus();
}

/** 工具列呼叫：對目前的編輯器執行指令 */
function run(fn: (v: EditorView) => boolean) {
  if (view.value) fn(view.value);
}
defineExpose({
  bold: () => run(v => toggleWrap(v, "**")),
  italic: () => run(v => toggleWrap(v, "*")),
  strike: () => run(v => toggleWrap(v, "~~")),
  code: () => run(v => toggleWrap(v, "`")),
  heading: (n: number) => run(v => setHeading(v, n)),
  bullet: () => run(toggleBullet),
  ordered: () => run(toggleOrdered),
  task: () => run(toggleTask),
  quote: () => run(toggleQuote),
  link: () => run(insertLink),
  hr: () => run(insertHr),
  table: (rows?: number, cols?: number) => run(v => insertTable(v, rows, cols)),
  tableAddRow: () => run(tableAddRow),
  tableDelRow: () => run(tableDelRow),
  tableAddCol: () => run(tableAddCol),
  tableDelCol: () => run(tableDelCol),
  tableAlign: (a: Align) => run(v => tableAlign(v, a)),
  tableFormat: () => run(tableFormat),
  mathBlock: () => run(insertMathBlock),
  mathInline: () => run(toggleInlineMath),
  codeBlock: () => run(v => insertCodeBlock(v)),
  mermaid: () => run(insertMermaid),
  toc: () => run(insertToc),
  pageBreak: () => run(insertPageBreak),
  footnote: () => run(insertFootnote),
  image: (path: string, alt?: string) => run(v => insertImage(v, path, alt)),
  search: () => run(openSearchPanel),
  undo: () => run(undo),
  redo: () => run(redo),
  focus: () => view.value?.focus(),
  jumpTo,
  /** 目前游標位置（重開分頁時還原） */
  cursor: () => view.value?.state.selection.main.head ?? 0,
  /** 目前的大綱（切換分頁時立即更新側欄） */
  outline: () => (view.value ? outlineOf(view.value.state) : []),
  /** 圖片存放位置變了（另存新檔）時重新載入圖片 */
  refreshImages: () => { clearImageCache(); const v = view.value; if (v) v.setState(createState(v.state.doc.toString())); },
});
</script>

<template>
  <div ref="host" class="md-editor h-full" :class="{ 'md-source': source, 'md-typewriter': typewriter }" />
</template>

<style>
.md-editor .cm-editor { height: 100%; background: transparent; color: var(--color-fg); font-size: 0.875rem; }
.md-editor .cm-editor.cm-focused { outline: none; }
.md-editor .cm-scroller { font-family: inherit; line-height: 1.7; overflow: auto; }
.md-editor .cm-content { padding: 1rem 0; caret-color: var(--color-fg); max-width: 52rem; }
.md-editor.md-typewriter .cm-content { padding-bottom: 50vh; }
.md-editor .cm-line { padding: 0 0.25rem; }
.md-editor .cm-cursor { border-left-color: var(--color-fg); }
.md-editor .cm-selectionBackground, .md-editor .cm-focused .cm-selectionBackground { background: color-mix(in srgb, var(--color-accent) 25%, transparent) !important; }
.md-editor .cm-placeholder { color: var(--color-muted); }

.md-editor .cm-md-h { font-weight: 800; color: var(--color-fg); }
.md-editor .cm-md-h1 { font-size: 1.6em; line-height: 1.4; padding-top: 0.6em; }
.md-editor .cm-md-h2 { font-size: 1.35em; line-height: 1.4; padding-top: 0.5em; }
.md-editor .cm-md-h3 { font-size: 1.15em; padding-top: 0.4em; border-left: 3px solid var(--color-accent); padding-left: 0.5rem; }
.md-editor .cm-md-h4, .md-editor .cm-md-h5, .md-editor .cm-md-h6 { font-size: 1em; padding-top: 0.3em; }
.md-editor .cm-md-quote { border-left: 3px solid var(--color-hairline); padding-left: 0.75rem; color: var(--color-fg-secondary); }
.md-editor .cm-md-codeblock { background: var(--color-sunken); font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.85em; }
/* 程式碼區塊標籤列（語言選單、複製） */
.md-editor .cm-md-code-head { position: relative; }
.md-editor .cm-md-codebar { display: flex; justify-content: flex-end; gap: 0.35rem; position: relative; cursor: text; font-family: inherit; }
.md-editor .cm-md-codebar button { font-size: 0.75rem; padding: 0 0.5rem; border-radius: 0.35rem; color: var(--color-muted); cursor: pointer; line-height: 1.5; }
.md-editor .cm-md-codebar button:hover { color: var(--color-fg); background: color-mix(in srgb, var(--color-fg) 8%, transparent); }
.md-editor .cm-md-codelang { font-weight: 700; color: var(--color-accent) !important; }
.md-editor .cm-md-codelang-empty { font-weight: 400; color: var(--color-muted) !important; font-style: italic; }
.md-editor .cm-md-langmenu { position: absolute; right: 3.5rem; top: 1.6em; z-index: 20; width: 13rem; display: flex; flex-direction: column; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 0.6rem; box-shadow: 0 10px 30px rgb(0 0 0 / 0.2); padding: 0.35rem; font-family: inherit; }
.md-editor .cm-md-langmenu input { width: 100%; padding: 0.25rem 0.5rem; border-radius: 0.4rem; border: 1px solid var(--color-hairline); background: var(--color-sunken); color: var(--color-fg); font-size: 0.8rem; outline: none; }
.md-editor .cm-md-langlist { display: flex; flex-direction: column; max-height: 14rem; overflow-y: auto; margin-top: 0.3rem; }
.md-editor .cm-md-langitem { text-align: left; font-size: 0.8rem !important; padding: 0.2rem 0.5rem !important; color: var(--color-fg) !important; }
.md-editor .cm-md-langitem-active { background: color-mix(in srgb, var(--color-accent) 15%, transparent) !important; }
.md-editor .cm-md-langitem-current { font-weight: 700; color: var(--color-accent) !important; }
.md-editor .cm-md-hr { background: linear-gradient(var(--color-hairline), var(--color-hairline)) center / 100% 1px no-repeat; }
.md-editor .cm-md-bullet { color: var(--color-muted); display: inline-block; width: 1em; text-align: center; }
.md-editor .cm-md-task { margin: 0 0.35em 0 0; vertical-align: middle; cursor: pointer; accent-color: var(--color-accent); }
.md-editor .cm-md-done { color: var(--color-muted); text-decoration: line-through; }
.md-editor .cm-md-fnref { color: var(--color-accent); font-size: 0.8em; vertical-align: super; }
.md-editor .cm-md-fndef { color: var(--color-fg-secondary); font-size: 0.9em; }
.md-editor .cm-md-dim { opacity: 0.35; transition: opacity .15s; }
.md-editor .cm-md-collapsed { height: 0; overflow: hidden; padding: 0; }

/* 原文 HTML（白名單過濾後） */
.md-editor .cm-md-html-skipped { font-size: 0.75em; color: var(--color-muted); font-style: italic; }
.md-editor .cm-md-html h1 { font-size: 1.6em; font-weight: 800; }
.md-editor .cm-md-html h2 { font-size: 1.35em; font-weight: 800; }
.md-editor .cm-md-html h3 { font-size: 1.15em; font-weight: 800; }
.md-editor .cm-md-html h4, .md-editor .cm-md-html h5, .md-editor .cm-md-html h6 { font-weight: 800; }
.md-editor .cm-md-html p { margin: 0.3em 0; }
.md-editor .cm-md-html ul { list-style: disc; padding-left: 1.5em; }
.md-editor .cm-md-html ol { list-style: decimal; padding-left: 1.5em; }
.md-editor .cm-md-html table { border-collapse: collapse; }
.md-editor .cm-md-html th, .md-editor .cm-md-html td { border: 1px solid var(--color-hairline); padding: 0.2rem 0.5rem; }
.md-editor .cm-md-html img { max-width: 100%; }
.md-editor .cm-md-html a { color: var(--color-accent); text-decoration: underline; }
.md-editor .cm-md-html summary { cursor: pointer; font-weight: 700; }
.md-editor .cm-md-html mark, .md-editor .cm-html-mark { background: color-mix(in srgb, var(--color-warning) 35%, transparent); color: inherit; }
.md-editor .cm-md-html kbd, .md-editor .cm-html-kbd { font-family: var(--font-mono, monospace); font-size: 0.85em; border: 1px solid var(--color-hairline); border-bottom-width: 2px; border-radius: 4px; padding: 0 0.3em; }
.md-editor .cm-html-b, .md-editor .cm-html-strong { font-weight: 700; }
.md-editor .cm-html-i, .md-editor .cm-html-em { font-style: italic; }
.md-editor .cm-html-u, .md-editor .cm-html-ins { text-decoration: underline; }
.md-editor .cm-html-s, .md-editor .cm-html-del, .md-editor .cm-html-strike { text-decoration: line-through; }
.md-editor .cm-html-sub { vertical-align: sub; font-size: 0.8em; }
.md-editor .cm-html-sup { vertical-align: super; font-size: 0.8em; }
.md-editor .cm-html-small { font-size: 0.85em; }
.md-editor .cm-html-big { font-size: 1.2em; }
.md-editor .cm-html-code { font-family: var(--font-mono, monospace); font-size: 0.9em; }

/* 區塊預覽 */
.md-editor .cm-md-block { cursor: text; margin: 0.25rem 0; border-radius: 0.5rem; }
.md-editor .cm-md-block:hover { outline: 1px dashed var(--color-hairline); outline-offset: 2px; }
.md-editor .cm-md-table table { border-collapse: collapse; font-size: 0.95em; }
.md-editor .cm-md-table th, .md-editor .cm-md-table td { border: 1px solid var(--color-hairline); padding: 0.25rem 0.6rem; }
.md-editor .cm-md-table th { background: var(--color-sunken); font-weight: 700; }
.md-editor .cm-md-mathblock { text-align: center; padding: 0.25rem 0; overflow-x: auto; }
.md-editor .cm-md-mermaid { display: flex; justify-content: center; padding: 0.5rem 0; overflow-x: auto; }
.md-editor .cm-md-frontmatter, .md-editor .cm-md-toc { background: var(--color-sunken); padding: 0.5rem 0.75rem; font-size: 0.85em; color: var(--color-fg-secondary); }
.md-editor .cm-md-fm-head { font-size: 0.75em; font-weight: 800; color: var(--color-muted); margin-bottom: 0.15rem; }
.md-editor .cm-md-fm-key { font-weight: 700; margin-right: 0.5rem; color: var(--color-fg); }
.md-editor .cm-md-toc a { display: block; cursor: pointer; color: var(--color-accent); }
.md-editor .cm-md-pagebreak { text-align: center; font-size: 0.7em; color: var(--color-muted); border-top: 1px dashed var(--color-hairline); padding-top: 0.1rem; }
.md-editor .cm-md-error { color: var(--color-danger); font-size: 0.85em; }
.md-editor .cm-md-image img { max-width: 100%; max-height: 28rem; border-radius: 0.35rem; vertical-align: middle; cursor: text; }
.md-editor .cm-md-src { background: color-mix(in srgb, var(--color-sunken) 70%, transparent); font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.9em; }
.md-editor .cm-panels { background: var(--color-surface); border-color: var(--color-hairline); color: var(--color-fg); }
.md-editor .cm-panels input, .md-editor .cm-panels button { font-size: 0.8rem; }
.md-editor .cm-searchMatch { background: color-mix(in srgb, var(--color-warning) 35%, transparent); }
.md-editor .cm-searchMatch-selected { background: color-mix(in srgb, var(--color-accent) 40%, transparent); }

/* 原始碼模式：等寬字、不套標題大小 */
.md-editor.md-source .cm-scroller { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.85em; }
</style>
