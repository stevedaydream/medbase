<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MarkdownEditor from "@/components/markdown/MarkdownEditor.vue";
import MarkdownToolbar from "@/components/markdown/MarkdownToolbar.vue";
import MarkdownOutline from "@/components/markdown/MarkdownOutline.vue";
import FileTree from "@/components/markdown/FileTree.vue";
import ExportDialog from "@/components/markdown/ExportDialog.vue";
import type { OutlineItem } from "@/components/markdown/outline";
import {
  docs, activeTab, anyDirty, isDirty, tabTitle, loadSession, newDoc, openPath, openWithDialog, saveTab, closeTab,
  moveTab, activate, onEdited, acceptRecover, resolveExternal, checkAllExternal, resolveDocImage, saveDocImage,
  pickDocImage, docStats, notify, loadDocImage, docDir, type DocTab,
} from "@/composables/useDocTabs";

/**
 * Markdown 文件（pending.md 第 3 階段）：本機 .md 檔、多文件分頁、檔案樹、大綱、最近文件、
 * 自動儲存、草稿復原、外部修改偵測、專注／打字機模式。
 */
type EditorInst = InstanceType<typeof MarkdownEditor>;
const editors = ref<Record<string, EditorInst | undefined>>({});
const setEditorRef = (id: string) => (el: unknown) => { editors.value[id] = (el as EditorInst) ?? undefined; };
const activeEditor = computed(() => (docs.activeId ? editors.value[docs.activeId] : undefined));

const outline = ref<OutlineItem[]>([]);
const cursor = ref(0);
const inTable = ref(false);
const panel = ref<"files" | "outline" | "recent">("files");
const showSide = ref(true);
const treeVersion = ref(0);

// 同時保留編輯器實例的分頁數：超過時最久沒看的分頁卸載（內容與游標保留在分頁狀態）
const MAX_MOUNTED = 8;
const mountedOrder = ref<string[]>([]);
watch(() => docs.activeId, (id, prev) => {
  if (prev && editors.value[prev]) {
    const t = docs.tabs.find(x => x.id === prev);
    if (t) t.cursor = editors.value[prev]!.cursor();
  }
  if (!id) return;
  mountedOrder.value = [id, ...mountedOrder.value.filter(x => x !== id && docs.tabs.some(t => t.id === x))].slice(0, MAX_MOUNTED);
  inTable.value = false;
  nextTick(() => {
    const ed = editors.value[id];
    outline.value = ed?.outline() ?? [];
    cursor.value = ed?.cursor() ?? 0;
  });
}, { immediate: true });
const mountedTabs = computed(() => docs.tabs.filter(t => mountedOrder.value.includes(t.id)));

/** 編輯器剛建立時還原游標位置 */
async function onEditorReady(t: DocTab) {
  await nextTick();
  if (t.cursor) editors.value[t.id]?.jumpTo(t.cursor);
}

// ── 未儲存確認 ───────────────────────────────────────────────────
const confirmState = ref<{ title: string; resolve: (v: "save" | "discard" | "cancel") => void } | null>(null);
const askUnsaved = (title: string) => new Promise<"save" | "discard" | "cancel">(resolve => { confirmState.value = { title, resolve }; });
function answer(v: "save" | "discard" | "cancel") { confirmState.value?.resolve(v); confirmState.value = null; }

async function requestClose(t: DocTab): Promise<boolean> {
  if (isDirty(t)) {
    activate(t.id);
    const a = await askUnsaved(tabTitle(t));
    if (a === "cancel") return false;
    if (a === "save" && !(await saveTab(t))) return false;
  }
  await closeTab(t);
  return true;
}
async function closeMany(list: DocTab[]) {
  for (const t of list) if (!(await requestClose(t))) break;
}

// ── 分頁列：拖曳排序（Pointer Events，BF-001）與右鍵選單 ─────────
const drag = ref<{ id: string; startX: number; moved: boolean } | null>(null);
const tabEls = ref<HTMLElement[]>([]);
function onTabDown(e: PointerEvent, t: DocTab) {
  if (e.button === 1) { e.preventDefault(); requestClose(t); return; }
  if (e.button !== 0) return;
  drag.value = { id: t.id, startX: e.clientX, moved: false };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onTabMove(e: PointerEvent) {
  const d = drag.value;
  if (!d) return;
  if (!d.moved && Math.abs(e.clientX - d.startX) < 6) return;
  d.moved = true;
  const from = docs.tabs.findIndex(t => t.id === d.id);
  const to = tabEls.value.findIndex(el => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
  if (to >= 0 && to !== from) moveTab(from, to);
}
function onTabUp(t: DocTab) {
  if (drag.value && !drag.value.moved) activate(t.id);
  drag.value = null;
}

const menu = ref<{ x: number; y: number; tab: DocTab } | null>(null);
function openMenu(e: MouseEvent, t: DocTab) { menu.value = { x: e.clientX, y: e.clientY, tab: t }; }
async function menuAction(kind: "close" | "others" | "right" | "copy" | "reveal") {
  const m = menu.value;
  menu.value = null;
  if (!m) return;
  const i = docs.tabs.indexOf(m.tab);
  if (kind === "close") await requestClose(m.tab);
  else if (kind === "others") await closeMany(docs.tabs.filter(t => t !== m.tab));
  else if (kind === "right") await closeMany(docs.tabs.slice(i + 1));
  else if (kind === "copy" && m.tab.path) { await navigator.clipboard.writeText(m.tab.path); notify("已複製路徑"); }
  else if (kind === "reveal" && m.tab.path) {
    try { const { revealItemInDir } = await import("@tauri-apps/plugin-opener"); await revealItemInDir(m.tab.path); }
    catch (e) { notify(`無法開啟檔案總管：${(e as Error).message ?? e}`); }
  }
}

// ── 資料夾與新增檔案 ──────────────────────────────────────────────
async function pickFolder() {
  const p = await openDialog({ title: "選擇文件資料夾", directory: true, defaultPath: docs.folder ?? undefined }) as string | null;
  if (p) { docs.folder = p; panel.value = "files"; showSide.value = true; }
}

const newFileDir = ref<string | null>(null);
const newFileName = ref("");
function askNewFile(dir: string) { newFileDir.value = dir; newFileName.value = ""; }
async function createFile() {
  const dir = newFileDir.value;
  let name = newFileName.value.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!dir || !name) return;
  if (!/\.(md|markdown|txt)$/i.test(name)) name += ".md";
  const path = await join(dir, name);
  if (await exists(path)) { notify(`已有同名檔案：${name}`); return; }
  await writeTextFile(path, `# ${name.replace(/\.[^.]+$/, "")}\n\n`);
  newFileDir.value = null;
  treeVersion.value++;
  await openPath(path);
}

// ── 圖片（依各分頁的檔案位置）────────────────────────────────────
const imageResolverOf = (t: DocTab) => (src: string) => resolveDocImage(t, src);
const imageSaverOf = (t: DocTab) => (file: File) => saveDocImage(t, file);
async function pickImage() {
  const t = activeTab.value;
  if (!t) return;
  const p = await pickDocImage(t);
  if (p) activeEditor.value?.image(p);
}

// ── 匯出 ─────────────────────────────────────────────────────────
const exportOpen = ref(false);
const exportDir = ref<string | null>(null);
const exportTab = ref<DocTab | null>(null);
async function openExport() {
  const t = activeTab.value;
  if (!t) return;
  exportTab.value = t;
  exportDir.value = await docDir(t);
  exportOpen.value = true;
}
const exportName = computed(() => {
  const t = exportTab.value;
  if (!t) return "";
  return /^#\s+(.+)$/m.exec(t.content)?.[1]?.trim() || tabTitle(t).replace(/\.[^.]+$/, "");
});

async function save(as = false) {
  const t = activeTab.value;
  if (!t) return;
  const hadPath = !!t.path;
  if (await saveTab(t, as)) {
    notify(`已儲存：${tabTitle(t)}`);
    if (!hadPath || as) { treeVersion.value++; editors.value[t.id]?.refreshImages(); }
  }
}

// ── 快捷鍵 ───────────────────────────────────────────────────────
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || confirmState.value) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); save(e.shiftKey); }
  else if (k === "n") { e.preventDefault(); newDoc(); }
  else if (k === "o") { e.preventDefault(); openWithDialog(); }
  else if (k === "w") { e.preventDefault(); if (activeTab.value) requestClose(activeTab.value); }
  else if (k === "\\") { e.preventDefault(); showSide.value = !showSide.value; }
  else if (k === "p") { e.preventDefault(); openExport(); }
  else if (k === "tab" && docs.tabs.length > 1) {
    e.preventDefault();
    const i = docs.tabs.findIndex(t => t.id === docs.activeId);
    const n = docs.tabs.length;
    activate(docs.tabs[(i + (e.shiftKey ? n - 1 : 1)) % n].id);
  }
}

// 關閉視窗時有未儲存的文件：先問
let unlistenClose: (() => void) | null = null;
const onFocus = () => { checkAllExternal(); };

onMounted(async () => {
  await loadSession();
  if (!docs.tabs.length) newDoc();
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("focus", onFocus);
  try {
    unlistenClose = await getCurrentWindow().onCloseRequested(async ev => {
      if (!anyDirty.value) return;
      ev.preventDefault();
      for (const t of docs.tabs.filter(isDirty)) {
        activate(t.id);
        const a = await askUnsaved(tabTitle(t));
        if (a === "cancel") return;
        if (a === "save" && !(await saveTab(t))) return;
        if (a === "discard") t.saved = t.content;
      }
      await getCurrentWindow().destroy();
    });
  } catch { /* 網頁版沒有視窗 API */ }
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("focus", onFocus);
  unlistenClose?.();
});

const stats = computed(() => (activeTab.value ? docStats(activeTab.value) : null));
const openPaths = computed(() => docs.tabs.map(t => t.path).filter((p): p is string => !!p));
const folderName = computed(() => docs.folder?.split(/[\\/]/).filter(Boolean).pop() ?? "");
const toggleCls = (on: boolean) => on ? "bg-accent/10 border-accent/30 text-accent" : "border-hairline text-muted hover:text-fg";
</script>

<template>
  <div class="flex h-full bg-surface rounded-2xl border border-hairline overflow-hidden text-fg" @click="menu = null">
    <!-- 側欄 -->
    <aside v-if="showSide" class="w-60 shrink-0 flex flex-col border-r border-hairline bg-sunken">
      <div class="flex shrink-0 border-b border-hairline text-2xs font-bold">
        <button v-for="p in ([['files', '檔案'], ['outline', '大綱'], ['recent', '最近']] as const)" :key="p[0]" @click="panel = p[0]"
          class="flex-1 py-2 cursor-pointer" :class="panel === p[0] ? 'text-accent border-b-2 border-accent' : 'text-muted hover:text-fg'">{{ p[1] }}</button>
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <template v-if="panel === 'files'">
          <div class="flex items-center gap-1 mb-2">
            <span class="flex-1 min-w-0 truncate text-xs font-bold text-fg" :title="docs.folder ?? ''">{{ folderName || '尚未選擇資料夾' }}</span>
            <button v-if="docs.folder" @click="askNewFile(docs.folder)" title="新增文件" class="px-1.5 text-muted hover:text-accent cursor-pointer">＋</button>
            <button v-if="docs.folder" @click="treeVersion++" title="重新整理" class="px-1.5 text-muted hover:text-accent cursor-pointer">⟳</button>
            <button @click="pickFolder" title="選擇資料夾" class="px-1.5 text-muted hover:text-accent cursor-pointer">📂</button>
          </div>
          <FileTree v-if="docs.folder" :dir="docs.folder" :active="activeTab?.path" :open-paths="openPaths" :version="treeVersion"
            @open="openPath" @new-file="askNewFile" />
          <button v-else @click="pickFolder" class="w-full mt-4 py-2 rounded-xl border border-dashed border-hairline text-xs text-muted hover:text-accent cursor-pointer">選擇存放文件的資料夾</button>
        </template>
        <MarkdownOutline v-else-if="panel === 'outline'" :items="outline" :cursor="cursor" @jump="activeEditor?.jumpTo($event)" />
        <template v-else>
          <p v-if="!docs.recent.length" class="text-xs text-muted text-center py-4">還沒有最近開啟的文件</p>
          <button v-for="p in docs.recent" :key="p" @click="openPath(p)" :title="p"
            class="block w-full text-left px-2 py-1.5 rounded-md hover:bg-overlay/5 cursor-pointer">
            <span class="block text-xs font-bold text-fg truncate">{{ p.split(/[\\/]/).pop() }}</span>
            <span class="block text-2xs text-muted truncate">{{ p }}</span>
          </button>
        </template>
      </div>
    </aside>

    <div class="flex-1 min-w-0 flex flex-col">
      <!-- 分頁列 -->
      <div class="flex items-end gap-0.5 px-2 pt-1.5 border-b border-hairline bg-sunken shrink-0 overflow-x-auto">
        <button @click="showSide = !showSide" title="側欄（Ctrl+\）" class="self-center mr-1 px-1.5 text-muted hover:text-fg cursor-pointer">☰</button>
        <div v-for="t in docs.tabs" :key="t.id" ref="tabEls"
          @pointerdown="onTabDown($event, t)" @pointermove="onTabMove" @pointerup="onTabUp(t)" @contextmenu.prevent="openMenu($event, t)"
          class="group shrink-0 flex items-center gap-1.5 max-w-52 pl-3 pr-1.5 py-1.5 rounded-t-lg text-xs border border-b-0 select-none cursor-pointer"
          :class="[t.id === docs.activeId ? 'bg-surface border-hairline text-fg font-bold' : 'border-transparent text-muted hover:text-fg-secondary',
                   drag?.id === t.id && drag.moved ? 'opacity-60' : '']"
          :title="t.path ?? '尚未儲存'">
          <span class="truncate">{{ tabTitle(t) }}</span>
          <span v-if="t.external" class="text-warning" title="檔案已在外部修改">⚠</span>
          <button @pointerdown.stop @click.stop="requestClose(t)" class="w-4 h-4 flex items-center justify-center rounded hover:bg-overlay/10 cursor-pointer"
            :title="isDirty(t) ? '未儲存' : '關閉（Ctrl+W）'">
            <span v-if="isDirty(t)" class="group-hover:hidden w-2 h-2 rounded-full bg-accent" />
            <span :class="isDirty(t) ? 'hidden group-hover:inline' : ''">×</span>
          </button>
        </div>
        <button @click="newDoc()" title="新增文件（Ctrl+N）" class="self-center ml-1 px-2 text-muted hover:text-accent cursor-pointer">＋</button>
      </div>

      <!-- 檔案動作與模式 -->
      <div class="flex items-center gap-1.5 px-4 py-1.5 border-b border-hairline shrink-0 text-2xs flex-wrap">
        <button @click="openWithDialog" class="px-2.5 py-1 rounded-lg border border-hairline text-muted hover:text-fg cursor-pointer">開啟（Ctrl+O）</button>
        <button @click="save()" :disabled="!activeTab" class="px-2.5 py-1 rounded-lg border border-hairline text-muted hover:text-fg cursor-pointer">儲存（Ctrl+S）</button>
        <button @click="save(true)" :disabled="!activeTab" class="px-2.5 py-1 rounded-lg border border-hairline text-muted hover:text-fg cursor-pointer">另存新檔</button>
        <button @click="activeEditor?.search()" class="px-2.5 py-1 rounded-lg border border-hairline text-muted hover:text-fg cursor-pointer">搜尋取代（Ctrl+F）</button>
        <button @click="openExport" :disabled="!activeTab" class="px-2.5 py-1 rounded-lg border border-hairline text-muted hover:text-fg cursor-pointer">匯出／列印（Ctrl+P）</button>
        <div class="flex-1" />
        <button @click="docs.autosave = !docs.autosave" class="px-2.5 py-1 rounded-lg border font-bold cursor-pointer" :class="toggleCls(docs.autosave)" title="編輯後自動存檔">自動儲存</button>
        <button @click="docs.focus = !docs.focus" class="px-2.5 py-1 rounded-lg border font-bold cursor-pointer" :class="toggleCls(docs.focus)" title="只有游標所在段落是正常顏色">專注</button>
        <button @click="docs.typewriter = !docs.typewriter" class="px-2.5 py-1 rounded-lg border font-bold cursor-pointer" :class="toggleCls(docs.typewriter)" title="游標所在行維持在畫面中間">打字機</button>
      </div>

      <template v-if="activeTab">
        <MarkdownToolbar class="px-4 py-1.5 border-b border-hairline shrink-0" :editor="activeEditor" :source="activeTab.source"
          :in-table="inTable" :pick-image="activeTab.path ? pickImage : undefined" @update:source="activeTab.source = $event" />

        <!-- 提示：草稿復原、外部修改 -->
        <div v-if="activeTab.recover != null" class="flex items-center gap-2 px-4 py-2 bg-warning/10 text-warning text-xs font-bold shrink-0">
          <span class="flex-1">上次關閉前有未儲存的修改。</span>
          <button @click="acceptRecover(activeTab, true)" class="px-3 py-1 rounded-lg bg-warning text-white cursor-pointer">還原未儲存的內容</button>
          <button @click="acceptRecover(activeTab, false)" class="px-3 py-1 rounded-lg border border-warning/40 cursor-pointer">捨棄</button>
        </div>
        <div v-if="activeTab.external" class="flex items-center gap-2 px-4 py-2 bg-warning/10 text-warning text-xs font-bold shrink-0">
          <span class="flex-1">{{ activeTab.external === 'deleted' ? '檔案已被移動或刪除。' : '檔案已被其他程式修改，而這裡有未儲存的修改。' }}</span>
          <button v-if="activeTab.external === 'changed'" @click="resolveExternal(activeTab, 'reload')" class="px-3 py-1 rounded-lg bg-warning text-white cursor-pointer">改用檔案的版本</button>
          <button @click="resolveExternal(activeTab, 'keep')" class="px-3 py-1 rounded-lg border border-warning/40 cursor-pointer">保留我的版本</button>
        </div>
      </template>

      <!-- 編輯區：每個分頁一個編輯器（保留各自的游標與復原紀錄） -->
      <div class="flex-1 min-h-0 relative">
        <div v-for="t in mountedTabs" :key="t.id" v-show="t.id === docs.activeId" class="absolute inset-0 px-8">
          <MarkdownEditor :ref="setEditorRef(t.id)" :model-value="t.content" @update:model-value="onEdited(t, $event)"
            v-model:source="t.source" :active="t.id === docs.activeId" :focus="docs.focus" :typewriter="docs.typewriter"
            :resolve-image="imageResolverOf(t)" :save-image="imageSaverOf(t)" placeholder="開始寫作…"
            @vue:mounted="onEditorReady(t)"
            @outline="t.id === docs.activeId && (outline = $event)" @cursor="t.id === docs.activeId && (cursor = $event)"
            @in-table="t.id === docs.activeId && (inTable = $event)" @notice="notify" />
        </div>
        <div v-if="!docs.tabs.length" class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
          <p class="text-sm">沒有開啟的文件</p>
          <div class="flex gap-2">
            <button @click="newDoc()" class="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold cursor-pointer">新增文件</button>
            <button @click="openWithDialog" class="px-4 py-2 rounded-xl border border-hairline text-xs font-bold cursor-pointer">開啟檔案</button>
          </div>
        </div>
      </div>

      <!-- 狀態列 -->
      <div v-if="activeTab && stats" class="flex items-center gap-4 px-4 py-1 border-t border-hairline bg-sunken text-2xs text-muted shrink-0">
        <span class="flex-1 min-w-0 truncate">{{ activeTab.path ?? '尚未儲存' }}</span>
        <span>{{ stats.words.toLocaleString() }} 字</span>
        <span>{{ stats.chars.toLocaleString() }} 字元</span>
        <span>{{ stats.lines.toLocaleString() }} 行</span>
        <span :class="isDirty(activeTab) ? 'text-warning font-bold' : ''">{{ isDirty(activeTab) ? (docs.autosave && activeTab.path ? '自動儲存中…' : '未儲存') : '已儲存' }}</span>
      </div>
    </div>
  </div>

  <ExportDialog v-if="exportTab" :open="exportOpen" :base-name="exportName" :default-dir="exportDir"
    :get-markdown="() => exportTab!.content" :load-image="src => loadDocImage(exportTab!, src)"
    @close="exportOpen = false" @notice="notify" />

  <!-- 分頁右鍵選單 -->
  <Teleport to="body">
    <div v-if="menu" class="fixed z-[9500] w-44 py-1 rounded-xl border border-hairline bg-surface shadow-2xl text-xs text-fg"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button @click="menuAction('close')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">關閉</button>
      <button @click="menuAction('others')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">關閉其他分頁</button>
      <button @click="menuAction('right')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">關閉右側分頁</button>
      <template v-if="menu.tab.path">
        <div class="my-1 border-t border-hairline" />
        <button @click="menuAction('copy')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">複製檔案路徑</button>
        <button @click="menuAction('reveal')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">在檔案總管中顯示</button>
      </template>
    </div>

    <!-- 未儲存確認 -->
    <div v-if="confirmState" class="fixed inset-0 z-[9600] flex items-center justify-center bg-sunken/60 backdrop-blur-sm">
      <div class="w-96 bg-surface border border-hairline rounded-2xl shadow-2xl p-6 space-y-4 text-fg">
        <p class="text-sm font-bold">「{{ confirmState.title }}」有未儲存的修改，要儲存嗎？</p>
        <div class="flex justify-end gap-2">
          <button @click="answer('cancel')" class="px-4 py-2 rounded-xl text-xs font-bold border border-hairline text-fg-secondary cursor-pointer">取消</button>
          <button @click="answer('discard')" class="px-4 py-2 rounded-xl text-xs font-bold border border-danger/30 text-danger cursor-pointer">不儲存</button>
          <button @click="answer('save')" class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white cursor-pointer">儲存</button>
        </div>
      </div>
    </div>

    <!-- 新增文件 -->
    <div v-if="newFileDir" class="fixed inset-0 z-[9600] flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="newFileDir = null">
      <div class="w-96 bg-surface border border-hairline rounded-2xl shadow-2xl p-6 space-y-3 text-fg">
        <p class="text-sm font-bold">新增文件</p>
        <p class="text-2xs text-muted truncate">{{ newFileDir }}</p>
        <input v-model="newFileName" @keydown.enter="createFile" @keydown.esc="newFileDir = null" autofocus placeholder="檔名（自動加 .md）"
          class="w-full px-3 py-2 rounded-xl bg-sunken border border-hairline text-sm outline-none focus:border-accent/50" />
        <div class="flex justify-end gap-2">
          <button @click="newFileDir = null" class="px-4 py-2 rounded-xl text-xs font-bold border border-hairline cursor-pointer">取消</button>
          <button @click="createFile" :disabled="!newFileName.trim()" class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white disabled:opacity-40 cursor-pointer">建立</button>
        </div>
      </div>
    </div>

    <Transition name="toast">
      <div v-if="docs.notice" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-surface border border-hairline text-fg text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
        {{ docs.notice }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
