<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, shallowRef } from "vue";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { livePreview } from "./livePreview";
import {
  toggleWrap, setHeading, toggleBullet, toggleOrdered, toggleTask, toggleQuote, insertLink, insertHr,
} from "./commands";

/**
 * Markdown 編輯器（CodeMirror 6，ADR 見 project_decisions.md）。
 * 內容永遠是 Markdown 原文；「排版」模式以裝飾隱藏語法，「原始碼」模式顯示全部原文。
 * 換成另一份文件時（modelValue 由外部改變）重建狀態，復原紀錄不跨文件。
 */
const props = withDefaults(defineProps<{ modelValue: string; source?: boolean; placeholder?: string }>(), {
  source: false, placeholder: "",
});
const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "update:source", v: boolean): void;
}>();

const host = ref<HTMLDivElement>();
const view = shallowRef<EditorView>();
const preview = new Compartment();
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

const shortcuts = keymap.of([
  { key: "Mod-b", run: v => toggleWrap(v, "**") },
  { key: "Mod-i", run: v => toggleWrap(v, "*") },
  { key: "Alt-Shift-5", run: v => toggleWrap(v, "~~") },
  { key: "Mod-Shift-`", run: v => toggleWrap(v, "`") },
  { key: "Mod-k", run: insertLink },
  ...[0, 1, 2, 3, 4, 5, 6].map(n => ({ key: `Mod-${n}`, run: (v: EditorView) => setHeading(v, n) })),
  { key: "Mod-Shift-]", run: toggleBullet },
  { key: "Mod-Shift-[", run: toggleOrdered },
  { key: "Mod-Shift-q", run: toggleQuote },
  { key: "Mod-/", run: () => { emit("update:source", !props.source); return true; } },
]);

function createState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      shortcuts,
      keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      cmPlaceholder(props.placeholder),
      preview.of(props.source ? [] : livePreview),
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      EditorView.updateListener.of(u => {
        if (!u.docChanged) return;
        lastEmitted = u.state.doc.toString();
        emit("update:modelValue", lastEmitted);
      }),
    ],
  });
}

onMounted(() => {
  view.value = new EditorView({ state: createState(props.modelValue), parent: host.value! });
});
onBeforeUnmount(() => view.value?.destroy());

watch(() => props.modelValue, v => {
  if (!view.value || v === lastEmitted) return;
  lastEmitted = v;
  view.value.setState(createState(v));
});
watch(() => props.source, s => {
  view.value?.dispatch({ effects: preview.reconfigure(s ? [] : livePreview) });
});

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
  undo: () => run(undo),
  redo: () => run(redo),
  focus: () => view.value?.focus(),
});
</script>

<template>
  <div ref="host" class="md-editor h-full" :class="{ 'md-source': source }" />
</template>

<style>
.md-editor .cm-editor { height: 100%; background: transparent; color: var(--color-fg); font-size: 0.875rem; }
.md-editor .cm-editor.cm-focused { outline: none; }
.md-editor .cm-scroller { font-family: inherit; line-height: 1.7; overflow: auto; }
.md-editor .cm-content { padding: 1rem 0; caret-color: var(--color-fg); max-width: 52rem; }
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
.md-editor .cm-md-hr { background: linear-gradient(var(--color-hairline), var(--color-hairline)) center / 100% 1px no-repeat; }
.md-editor .cm-md-bullet { color: var(--color-muted); display: inline-block; width: 1em; text-align: center; }
.md-editor .cm-md-task { margin: 0 0.35em 0 0; vertical-align: middle; cursor: pointer; accent-color: var(--color-accent); }
.md-editor .cm-md-done { color: var(--color-muted); text-decoration: line-through; }

/* 原始碼模式：等寬字、不套標題大小 */
.md-editor.md-source .cm-scroller { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.85em; }
</style>
