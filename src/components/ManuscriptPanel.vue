<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { phiWarning } from "@/composables/useResearch";
import {
  listSections, replaceSections, appendSections, updateSection, deleteSection, reorderSections,
  defaultSections, wordCount, type ManuscriptSection,
} from "@/composables/useManuscript";
import {
  exportDocx, exportMarkdown, exportText, printAsPdf, importManuscript, type Section,
} from "@/shared/manuscriptFiles";

/**
 * 專案詳情「稿件」頁籤：稿件依段落分區塊（頁籤）編輯，純文字自動儲存並隨個人雲端備份。
 * 可匯出 Word / PDF / Markdown / 純文字，也可匯入 Word / Markdown / 純文字並依標題自動分段。
 */
const props = defineProps<{ projectId: string; projectTitle: string; studyType: string | null }>();
const emit = defineEmits<{ (e: "toast", msg: string): void }>();

const sections = ref<ManuscriptSection[]>([]);
const activeId = ref<string | null>(null);
const loaded = ref(false);
const active = computed(() => sections.value.find(s => s.id === activeId.value) ?? null);

async function load(keepActive = true) {
  const prev = activeId.value;
  sections.value = await listSections(props.projectId);
  activeId.value = keepActive && prev && sections.value.some(s => s.id === prev) ? prev : sections.value[0]?.id ?? null;
  loaded.value = true;
}
onMounted(() => load(false));

// ── 編輯與自動儲存 ───────────────────────────────────────────────
const draftBody = ref("");
const draftTitle = ref("");
const saveState = ref<"saved" | "dirty" | "saving">("saved");
let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(active, (s) => {
  draftBody.value = s?.body ?? "";
  draftTitle.value = s?.title ?? "";
}, { immediate: true });

async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const s = active.value;
  if (!s || saveState.value !== "dirty") return;
  const patch: { title?: string; body?: string } = {};
  if (draftBody.value !== s.body) patch.body = draftBody.value;
  const t = draftTitle.value.trim();
  if (t && t !== s.title) patch.title = t;
  if (!Object.keys(patch).length) { saveState.value = "saved"; return; }
  saveState.value = "saving";
  await updateSection(s.id, props.projectId, patch);
  Object.assign(s, patch);
  saveState.value = "saved";
}

function onInput() {
  saveState.value = "dirty";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 800);
}

async function selectSection(id: string) {
  if (id === activeId.value) return;
  await flush();
  activeId.value = id;
}
onUnmounted(() => { flush(); });

const phi = computed(() => phiWarning(draftBody.value) ?? phiWarning(draftTitle.value));
const activeWords = computed(() => wordCount(draftBody.value));
const totalWords = computed(() => sections.value.reduce(
  (n, s) => n + wordCount(s.id === activeId.value ? draftBody.value : s.body), 0));

// ── 段落管理 ─────────────────────────────────────────────────────
async function createDefaults() {
  await replaceSections(props.projectId, defaultSections(props.studyType).map(title => ({ title, body: "" })));
  await load(false);
}

async function addSection() {
  await flush();
  await appendSections(props.projectId, [{ title: `新段落 ${sections.value.length + 1}`, body: "" }]);
  await load();
  activeId.value = sections.value[sections.value.length - 1]?.id ?? activeId.value;
  await nextTick();
  titleInput.value?.select();
}

async function move(delta: number) {
  const s = active.value;
  if (!s) return;
  await flush();
  const ids = sections.value.map(x => x.id);
  const i = ids.indexOf(s.id), j = i + delta;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await reorderSections(props.projectId, ids);
  await load();
}

const confirmDelete = ref(false);
async function removeActive() {
  const s = active.value;
  if (!s) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveState.value = "saved";
  const idx = sections.value.findIndex(x => x.id === s.id);
  await deleteSection(s.id, props.projectId);
  confirmDelete.value = false;
  await load();
  activeId.value = sections.value[Math.max(0, idx - 1)]?.id ?? null;
  emit("toast", `已刪除「${s.title}」`);
}

const titleInput = ref<HTMLInputElement | null>(null);

// ── 匯出 ─────────────────────────────────────────────────────────
const exportOpen = ref(false);

function currentSections(): Section[] {
  return sections.value.map(s => s.id === activeId.value
    ? { title: draftTitle.value.trim() || s.title, body: draftBody.value }
    : { title: s.title, body: s.body });
}

function safeFileName(name: string) {
  return (name.trim() || "manuscript").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

async function doExport(kind: "docx" | "pdf" | "md" | "txt") {
  exportOpen.value = false;
  await flush();
  const secs = currentSections();
  if (!secs.length) { emit("toast", "還沒有稿件內容"); return; }
  const base = safeFileName(props.projectTitle);
  try {
    if (kind === "pdf") {
      await printAsPdf(props.projectTitle, secs);
      return;
    }
    const filters = {
      docx: { name: "Word 文件", extensions: ["docx"] },
      md:   { name: "Markdown", extensions: ["md"] },
      txt:  { name: "純文字", extensions: ["txt"] },
    }[kind];
    const path = await saveDialog({ title: "匯出稿件", defaultPath: `${base}.${kind}`, filters: [filters] });
    if (!path) return;
    if (kind === "docx") await writeFile(path, exportDocx(secs));
    else await writeTextFile(path, kind === "md" ? exportMarkdown(secs) : exportText(secs));
    emit("toast", "稿件已匯出");
  } catch (e) {
    emit("toast", `匯出失敗：${(e as Error).message}`);
  }
}

// ── 匯入 ─────────────────────────────────────────────────────────
const importPreview = ref<{ fileName: string; sections: Section[] } | null>(null);
const importPhi = computed(() => importPreview.value
  ? importPreview.value.sections.map(s => phiWarning(s.body) ?? phiWarning(s.title)).find(Boolean) ?? null
  : null);

async function pickImport() {
  await flush();
  const path = await openDialog({
    title: "匯入稿件",
    multiple: false,
    filters: [{ name: "稿件", extensions: ["docx", "md", "txt"] }],
  }) as string | null;
  if (!path) return;
  try {
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const parsed = importManuscript(fileName, await readFile(path));
    if (!parsed.length) { emit("toast", "檔案裡沒有可匯入的文字"); return; }
    importPreview.value = { fileName, sections: parsed };
  } catch (e) {
    emit("toast", `匯入失敗：${(e as Error).message}`);
  }
}

async function confirmImport(mode: "replace" | "append") {
  const p = importPreview.value;
  if (!p) return;
  importPreview.value = null;
  if (mode === "replace") await replaceSections(props.projectId, p.sections);
  else await appendSections(props.projectId, p.sections);
  await load(false);
  if (mode === "append") activeId.value = sections.value[sections.value.length - p.sections.length]?.id ?? activeId.value;
  emit("toast", `已匯入 ${p.sections.length} 個段落`);
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 gap-3">
    <!-- 工具列 -->
    <div class="flex items-center gap-2 flex-wrap shrink-0">
      <span class="text-xs text-muted tabular-nums">全文 {{ totalWords.toLocaleString() }} 字</span>
      <span class="text-xs" :class="saveState === 'saved' ? 'text-muted' : 'text-warning'">
        {{ saveState === 'saved' ? '已儲存' : saveState === 'saving' ? '儲存中…' : '編輯中…' }}
      </span>
      <div class="flex-1" />
      <button @click="pickImport"
        class="px-3 py-1.5 rounded-xl bg-elevated border border-hairline text-xs font-bold text-fg-secondary hover:text-fg cursor-pointer">
        匯入稿件
      </button>
      <div class="relative" @mouseleave="exportOpen = false">
        <button @click="exportOpen = !exportOpen" :disabled="!sections.length"
          class="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover disabled:opacity-40 cursor-pointer">
          匯出 ▾
        </button>
        <div v-if="exportOpen" class="absolute right-0 top-full mt-1 z-20 w-44 bg-surface border border-hairline rounded-xl shadow-2xl py-1 text-sm">
          <button @click="doExport('docx')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">Word（.docx）</button>
          <button @click="doExport('pdf')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">PDF（列印另存）</button>
          <button @click="doExport('md')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">Markdown（.md）</button>
          <button @click="doExport('txt')" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">純文字（.txt）</button>
        </div>
      </div>
    </div>

    <!-- 尚無稿件 -->
    <div v-if="loaded && !sections.length" class="flex-1 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-hairline bg-surface py-16">
      <p class="text-sm text-fg-secondary">這篇論文還沒有稿件</p>
      <div class="flex gap-2">
        <button @click="createDefaults"
          class="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover cursor-pointer">
          建立預設段落
        </button>
        <button @click="pickImport"
          class="px-4 py-2 rounded-xl bg-elevated border border-hairline text-xs font-bold text-fg-secondary hover:text-fg cursor-pointer">
          從 Word／文字檔匯入
        </button>
      </div>
      <p class="text-xs text-muted">預設段落：{{ defaultSections(studyType).join('、') }}</p>
    </div>

    <template v-else-if="sections.length">
      <!-- 段落頁籤 -->
      <div class="flex items-end gap-1 overflow-x-auto shrink-0 border-b border-hairline">
        <button v-for="s in sections" :key="s.id" @click="selectSection(s.id)"
          class="shrink-0 px-3 py-1.5 rounded-t-lg text-xs font-bold border border-b-0 transition-colors cursor-pointer"
          :class="s.id === activeId ? 'bg-surface border-hairline text-accent' : 'border-transparent text-muted hover:text-fg-secondary'">
          {{ s.id === activeId ? (draftTitle.trim() || s.title) : s.title }}
          <span class="ml-1 font-normal tabular-nums opacity-70">{{ wordCount(s.id === activeId ? draftBody : s.body) }}</span>
        </button>
        <button @click="addSection" title="新增段落"
          class="shrink-0 px-2.5 py-1.5 text-sm text-muted hover:text-accent cursor-pointer">＋</button>
      </div>

      <!-- 編輯區 -->
      <div v-if="active" class="flex-1 min-h-0 flex flex-col gap-2">
        <div class="flex items-center gap-2 shrink-0">
          <input ref="titleInput" v-model="draftTitle" @input="onInput" @blur="flush" placeholder="段落名稱"
            class="flex-1 max-w-xs px-3 py-1.5 rounded-xl bg-surface border border-hairline text-sm font-bold text-fg outline-none focus:border-accent/50" />
          <span class="text-xs text-muted tabular-nums">{{ activeWords.toLocaleString() }} 字</span>
          <div class="flex-1" />
          <button @click="move(-1)" :disabled="sections[0]?.id === active.id" title="往前移"
            class="px-2 py-1 rounded-lg text-xs text-muted hover:text-fg hover:bg-overlay/5 disabled:opacity-30 cursor-pointer">◀</button>
          <button @click="move(1)" :disabled="sections[sections.length - 1]?.id === active.id" title="往後移"
            class="px-2 py-1 rounded-lg text-xs text-muted hover:text-fg hover:bg-overlay/5 disabled:opacity-30 cursor-pointer">▶</button>
          <button v-if="!confirmDelete" @click="confirmDelete = true"
            class="px-2 py-1 rounded-lg text-xs text-danger hover:bg-danger/10 cursor-pointer">刪除段落</button>
          <template v-else>
            <span class="text-xs text-danger">確定刪除「{{ active.title }}」？</span>
            <button @click="removeActive" class="px-2 py-1 rounded-lg text-xs font-bold bg-danger text-white cursor-pointer">刪除</button>
            <button @click="confirmDelete = false" class="px-2 py-1 rounded-lg text-xs text-muted hover:text-fg cursor-pointer">取消</button>
          </template>
        </div>
        <p v-if="phi" class="shrink-0 px-3 py-1.5 rounded-lg bg-warning/10 text-warning text-xs font-bold">⚠ {{ phi }}</p>
        <textarea v-model="draftBody" @input="onInput" @blur="flush"
          :placeholder="`在這裡撰寫「${active.title}」…`"
          class="flex-1 min-h-0 w-full resize-none px-4 py-3 rounded-2xl bg-surface border border-hairline text-sm leading-relaxed text-fg outline-none focus:border-accent/50 font-serif" />
      </div>
    </template>
  </div>

  <!-- 匯入預覽 -->
  <Teleport to="body">
    <div v-if="importPreview" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="importPreview = null">
      <div class="w-[28rem] max-w-[95vw] max-h-[85vh] flex flex-col bg-surface border border-hairline rounded-2xl shadow-2xl p-6 gap-4">
        <div>
          <h3 class="text-sm font-black text-fg">匯入稿件</h3>
          <p class="text-xs text-muted mt-1">{{ importPreview.fileName }}：辨識出 {{ importPreview.sections.length }} 個段落</p>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto space-y-1">
          <div v-for="(s, i) in importPreview.sections" :key="i"
            class="flex items-baseline gap-2 px-3 py-1.5 rounded-lg bg-sunken text-sm">
            <span class="font-bold text-fg truncate">{{ s.title }}</span>
            <span class="flex-1 min-w-0 truncate text-xs text-muted">{{ s.body.slice(0, 60) }}</span>
            <span class="shrink-0 text-xs text-muted tabular-nums">{{ wordCount(s.body) }} 字</span>
          </div>
        </div>
        <p v-if="importPhi" class="px-3 py-1.5 rounded-lg bg-warning/10 text-warning text-xs font-bold">⚠ {{ importPhi }}</p>
        <p class="text-xs text-muted">段落依 Word 的「標題 1／標題 2」樣式或常見段落名稱（Abstract、Introduction…）切分。</p>
        <div class="flex gap-2 justify-end">
          <button @click="importPreview = null" class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary hover:text-fg cursor-pointer">取消</button>
          <button v-if="sections.length" @click="confirmImport('append')" class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary hover:text-fg cursor-pointer">附加到最後</button>
          <button @click="confirmImport('replace')" class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white hover:bg-accent-hover cursor-pointer">
            {{ sections.length ? '取代目前稿件' : '匯入' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
