<script setup lang="ts">
import { computed } from "vue";
import type MarkdownEditor from "./MarkdownEditor.vue";

/**
 * Markdown 編輯器共用工具列（備忘錄、Markdown 文件、論文稿件）。
 * 右側固定放「排版／原始碼」切換；其餘按鈕直接呼叫編輯器指令。
 */
const props = defineProps<{
  editor: InstanceType<typeof MarkdownEditor> | undefined;
  source: boolean;
  /** 游標在表格內：顯示表格操作列 */
  inTable?: boolean;
  /** 提供時顯示「插入圖片」按鈕（由頁面開檔案選擇） */
  pickImage?: () => void;
}>();
const emit = defineEmits<{ (e: "update:source", v: boolean): void }>();

type Tool = { label: string; title: string; run: () => void; cls?: string };
const ed = () => props.editor;
const groups = computed<Tool[][]>(() => [
  [
    { label: "B", title: "粗體（Ctrl+B）", run: () => ed()?.bold(), cls: "font-black" },
    { label: "I", title: "斜體（Ctrl+I）", run: () => ed()?.italic(), cls: "italic" },
    { label: "S", title: "刪除線（Alt+Shift+5）", run: () => ed()?.strike(), cls: "line-through" },
    { label: "</>", title: "行內程式碼（Ctrl+Shift+`）", run: () => ed()?.code(), cls: "font-mono" },
  ],
  [1, 2, 3].map(n => ({ label: `H${n}`, title: `標題 ${n}（Ctrl+${n}；Ctrl+0 改回段落）`, run: () => ed()?.heading(n), cls: "font-bold" })),
  [
    { label: "•", title: "項目清單（Ctrl+Shift+]）", run: () => ed()?.bullet() },
    { label: "1.", title: "編號清單（Ctrl+Shift+[）", run: () => ed()?.ordered() },
    { label: "☐", title: "待辦清單", run: () => ed()?.task() },
    { label: "❝", title: "引用（Ctrl+Shift+Q）", run: () => ed()?.quote() },
  ],
  [
    { label: "🔗", title: "連結（Ctrl+K）", run: () => ed()?.link() },
    ...(props.pickImage ? [{ label: "🖼", title: "插入圖片（也可直接貼上或拖入）", run: () => props.pickImage!() }] : []),
    { label: "▦", title: "表格（Ctrl+T）", run: () => ed()?.table() },
    { label: "∑", title: "公式區塊（Ctrl+Shift+M）；行內公式用 $…$", run: () => ed()?.mathBlock() },
    { label: "{ }", title: "程式碼區塊（Ctrl+Shift+K）", run: () => ed()?.codeBlock(), cls: "font-mono" },
    { label: "◇", title: "Mermaid 圖表", run: () => ed()?.mermaid() },
    { label: "¹", title: "註腳", run: () => ed()?.footnote() },
    { label: "目錄", title: "插入目錄 [TOC]", run: () => ed()?.toc() },
    { label: "—", title: "分隔線", run: () => ed()?.hr() },
    { label: "⤓", title: "分頁（列印與匯出時換頁）", run: () => ed()?.pageBreak() },
  ],
  [
    { label: "↶", title: "復原（Ctrl+Z）", run: () => ed()?.undo() },
    { label: "↷", title: "重做（Ctrl+Y／Ctrl+Shift+Z）", run: () => ed()?.redo() },
  ],
]);

const tableTools: Tool[] = [
  { label: "＋列", title: "在下方加一列", run: () => ed()?.tableAddRow() },
  { label: "－列", title: "刪除這一列", run: () => ed()?.tableDelRow() },
  { label: "＋欄", title: "在右邊加一欄", run: () => ed()?.tableAddCol() },
  { label: "－欄", title: "刪除這一欄", run: () => ed()?.tableDelCol() },
  { label: "靠左", title: "這一欄靠左", run: () => ed()?.tableAlign("left") },
  { label: "置中", title: "這一欄置中", run: () => ed()?.tableAlign("center") },
  { label: "靠右", title: "這一欄靠右", run: () => ed()?.tableAlign("right") },
  { label: "整理", title: "重新對齊表格原文", run: () => ed()?.tableFormat() },
];
</script>

<template>
  <div class="flex items-center gap-0.5 flex-wrap">
    <template v-for="(group, gi) in groups" :key="gi">
      <div v-if="gi" class="w-px h-4 bg-overlay/10 mx-1.5" />
      <button v-for="b in group" :key="b.label" @click="b.run()" :title="b.title"
        class="min-w-8 px-2 py-1.5 rounded-lg text-xs text-muted hover:text-fg hover:bg-overlay/5 transition-all cursor-pointer"
        :class="b.cls">{{ b.label }}</button>
    </template>
    <div class="flex-1" />
    <slot />
    <button @click="emit('update:source', !source)" title="切換排版／原始碼（Ctrl+/）"
      class="px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer"
      :class="source ? 'bg-accent/10 border-accent/30 text-accent' : 'border-hairline text-muted hover:text-fg'">
      {{ source ? '原始碼' : '排版' }}
    </button>
    <!-- 表格操作：游標在表格內才出現 -->
    <div v-if="inTable" class="basis-full flex items-center gap-0.5 pt-1 text-xs">
      <span class="text-muted font-bold mr-1">表格</span>
      <button v-for="b in tableTools" :key="b.label" @click="b.run()" :title="b.title"
        class="px-2 py-1 rounded-md text-muted hover:text-fg hover:bg-overlay/5 cursor-pointer">{{ b.label }}</button>
      <span class="text-muted ml-2">Tab／Shift+Tab 換格，Ctrl+Enter 加一列</span>
    </div>
  </div>
</template>
