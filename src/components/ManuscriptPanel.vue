<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { phiWarning } from "@/composables/useResearch";
import {
  listSections, replaceSections, appendSections, updateSection, deleteSection, reorderSections,
  defaultSections, wordCount, saveAsset, loadAsset, type ManuscriptSection,
} from "@/composables/useManuscript";
import { exportText, importManuscript, type Section } from "@/shared/manuscriptFiles";
import {
  plainToMarkdown, sectionsToMarkdown, manuscriptTitle, assetSrc, assetIdOf, type SectionFormat,
} from "@/shared/manuscriptMarkdown";
import { renderMarkdown } from "@/shared/markdown/render";
import MarkdownEditor from "@/components/markdown/MarkdownEditor.vue";
import MarkdownToolbar from "@/components/markdown/MarkdownToolbar.vue";
import ExportDialog from "@/components/markdown/ExportDialog.vue";

/**
 * 專案詳情「稿件」頁籤：稿件依段落分區塊（頁籤）編輯，自動儲存並隨個人雲端備份。
 * 段落格式：md＝Markdown 編輯器（ADR-019）；text＝舊的純文字段落，預覽確認後可轉成 Markdown。
 * 匯出 PDF / Word / HTML / EPUB / LaTeX / Markdown（組稿成一份 Markdown 後匯出），以及純文字。
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

// ── Markdown 編輯器 ─────────────────────────────────────────────
const isMdActive = computed(() => active.value?.format === "md");
const editorRef = ref<InstanceType<typeof MarkdownEditor>>();
const sourceMode = ref(false);
const inTable = ref(false);
function onMdEdit(v: string) {
  draftBody.value = v;
  onInput();
}

// 稿件圖片：ms-asset:<id> → blob 網址
const blobUrls = new Map<string, string>();
async function resolveImage(src: string): Promise<string> {
  const id = assetIdOf(src);
  if (!id) return "";
  if (blobUrls.has(id)) return blobUrls.get(id)!;
  const a = await loadAsset(id);
  if (!a) return "";
  const url = URL.createObjectURL(new Blob([a.bytes], { type: a.mime }));
  blobUrls.set(id, url);
  return url;
}
onUnmounted(() => blobUrls.forEach(u => URL.revokeObjectURL(u)));

// 插入圖片前確認去識別化（規格 §6）
const phiConfirm = ref<{ name: string; checked: boolean; resolve: (ok: boolean) => void } | null>(null);
const confirmImage = (name: string) => new Promise<boolean>(resolve => { phiConfirm.value = { name, checked: false, resolve }; });
function answerImage(ok: boolean) { phiConfirm.value?.resolve(ok); phiConfirm.value = null; }

async function storeImage(file: Blob, name: string): Promise<string | null> {
  if (!(await confirmImage(name))) return null;
  const id = await saveAsset(props.projectId, file, name);
  return assetSrc(id);
}
const saveImage = (file: File) => storeImage(file, file.name);
async function pickImage() {
  const p = await openDialog({ title: "插入圖片", multiple: false, filters: [{ name: "圖片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }] }) as string | null;
  if (!p) return;
  const name = p.split(/[\\/]/).pop() ?? "image";
  const ext = name.split(".").pop()?.toLowerCase() ?? "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
  try {
    const src = await storeImage(new Blob([await readFile(p)], { type: mime }), name);
    if (src) editorRef.value?.image(src, name.replace(/\.[^.]+$/, ""));
  } catch (e) { emit("toast", `圖片儲存失敗：${(e as Error).message}`); }
}

// ── 純文字段落轉 Markdown（預覽後確認）───────────────────────────
const convertOpen = ref(false);
const convertPreview = computed(() => renderMarkdown(plainToMarkdown(draftBody.value)).html);
const textSections = computed(() => sections.value.filter(s => s.format !== "md"));
async function convert(all: boolean) {
  await flush();
  const list = all ? textSections.value : active.value ? [active.value] : [];
  for (const s of list) {
    const body = plainToMarkdown(s.id === activeId.value ? draftBody.value : s.body);
    await updateSection(s.id, props.projectId, { body, format: "md" });
  }
  convertOpen.value = false;
  await load();
  draftBody.value = active.value?.body ?? "";
  emit("toast", `已轉換 ${list.length} 個段落為 Markdown`);
}
const activeWords = computed(() => wordCount(draftBody.value));
const totalWords = computed(() => sections.value.reduce(
  (n, s) => n + wordCount(s.id === activeId.value ? draftBody.value : s.body), 0));

// ── 段落管理 ─────────────────────────────────────────────────────
async function createDefaults() {
  await replaceSections(props.projectId, defaultSections(props.studyType).map(title => ({ title, body: "", format: "md" as const })));
  await load(false);
}

async function addSection() {
  await flush();
  await appendSections(props.projectId, [{ title: `新段落 ${sections.value.length + 1}`, body: "", format: "md" }]);
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
const exportMenu = ref(false);

function currentSections(): (Section & { format: SectionFormat })[] {
  return sections.value.map(s => s.id === activeId.value
    ? { title: draftTitle.value.trim() || s.title, body: draftBody.value, format: s.format }
    : { title: s.title, body: s.body, format: s.format });
}

function safeFileName(name: string) {
  return (name.trim() || "manuscript").replace(/[\/:*?"<>|]/g, "_").slice(0, 80);
}

const exportName = computed(() => manuscriptTitle(currentSections(), props.projectTitle));
/** 組稿：全部段落合成一份 Markdown（純文字段落自動跳脫） */
const combinedMarkdown = () => sectionsToMarkdown(currentSections());
async function loadImage(src: string) {
  const id = assetIdOf(src);
  return id ? loadAsset(id) : null;
}

async function openExport() {
  exportMenu.value = false;
  await flush();
  if (!sections.value.length) { emit("toast", "還沒有稿件內容"); return; }
  exportOpen.value = true;
}

async function exportPlainText() {
  exportMenu.value = false;
  await flush();
  const secs = currentSections();
  if (!secs.length) { emit("toast", "還沒有稿件內容"); return; }
  try {
    const path = await saveDialog({ title: "匯出稿件", defaultPath: `${safeFileName(props.projectTitle)}.txt`, filters: [{ name: "純文字", extensions: ["txt"] }] });
    if (!path) return;
    await writeTextFile(path, exportText(secs));
    emit("toast", "稿件已匯出");
  } catch (e) {
    emit("toast", `匯出失敗：${(e as Error).message}`);
  }
}

// ── 匯入 ─────────────────────────────────────────────────────────
// .md 匯入為 Markdown 段落；Word／純文字維持純文字段落（可再轉換）
const importPreview = ref<{ fileName: string; sections: Section[]; format: SectionFormat } | null>(null);
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
    importPreview.value = { fileName, sections: parsed, format: /\.(md|markdown)$/i.test(fileName) ? "md" : "text" };
  } catch (e) {
    emit("toast", `匯入失敗：${(e as Error).message}`);
  }
}

async function confirmImport(mode: "replace" | "append") {
  const p = importPreview.value;
  if (!p) return;
  importPreview.value = null;
  const withFormat = p.sections.map(s => ({ ...s, format: p.format }));
  if (mode === "replace") await replaceSections(props.projectId, withFormat);
  else await appendSections(props.projectId, withFormat);
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
      <div class="relative" @mouseleave="exportMenu = false">
        <button @click="exportMenu = !exportMenu" :disabled="!sections.length"
          class="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover disabled:opacity-40 cursor-pointer">
          匯出 ▾
        </button>
        <div v-if="exportMenu" class="absolute right-0 top-full mt-1 z-20 w-56 bg-surface border border-hairline rounded-xl shadow-2xl py-1 text-sm">
          <button @click="openExport" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">PDF／Word／HTML／EPUB／LaTeX／Markdown…</button>
          <button @click="exportPlainText" class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer">純文字（.txt）</button>
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
        <!-- Markdown 段落 -->
        <template v-if="isMdActive">
          <MarkdownToolbar class="shrink-0 px-3 py-1 rounded-xl bg-surface border border-hairline" :editor="editorRef"
            v-model:source="sourceMode" :in-table="inTable" :pick-image="pickImage" />
          <div class="flex-1 min-h-0 px-5 rounded-2xl bg-surface border border-hairline font-serif">
            <MarkdownEditor :key="active.id" ref="editorRef" :model-value="draftBody" @update:model-value="onMdEdit"
              v-model:source="sourceMode" :resolve-image="resolveImage" :save-image="saveImage"
              :placeholder="`在這裡撰寫「${active.title}」…（支援 Markdown：表格、公式、圖片、註腳）`"
              @in-table="inTable = $event" @notice="emit('toast', $event)" />
          </div>
        </template>
        <!-- 舊的純文字段落 -->
        <template v-else>
          <div class="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/5 text-xs text-fg-secondary">
            <span class="flex-1">這是舊的純文字段落。轉成 Markdown 後可使用表格、公式、圖片與格式；轉換前可先預覽，內容不會改變。</span>
            <button @click="convertOpen = true" class="px-3 py-1 rounded-lg bg-accent text-white font-bold cursor-pointer">預覽並轉換</button>
          </div>
          <textarea v-model="draftBody" @input="onInput" @blur="flush"
            :placeholder="`在這裡撰寫「${active.title}」…`"
            class="flex-1 min-h-0 w-full resize-none px-4 py-3 rounded-2xl bg-surface border border-hairline text-sm leading-relaxed text-fg outline-none focus:border-accent/50 font-serif" />
        </template>
      </div>
    </template>
  </div>

  <ExportDialog :open="exportOpen" :base-name="exportName" :get-markdown="combinedMarkdown" :load-image="loadImage"
    @close="exportOpen = false" @notice="emit('toast', $event)" />

  <Teleport to="body">
    <!-- 純文字轉 Markdown 預覽 -->
    <div v-if="convertOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="convertOpen = false">
      <div class="w-[48rem] max-w-[95vw] max-h-[85vh] flex flex-col bg-surface border border-hairline rounded-2xl shadow-2xl p-6 gap-4 text-fg">
        <div>
          <h3 class="text-sm font-black">轉換為 Markdown：{{ active?.title }}</h3>
          <p class="text-xs text-muted mt-1">原文中的 * # - 等符號會保留為文字，換行與段落不變。轉換後顯示如右側。</p>
        </div>
        <div class="flex-1 min-h-0 grid grid-cols-2 gap-3">
          <div class="flex flex-col min-h-0"><p class="text-xs font-bold text-muted mb-1">原文</p>
            <pre class="flex-1 overflow-auto rounded-xl bg-sunken p-3 text-xs whitespace-pre-wrap font-serif">{{ draftBody }}</pre></div>
          <div class="flex flex-col min-h-0"><p class="text-xs font-bold text-muted mb-1">轉換後</p>
            <div class="ms-preview flex-1 overflow-auto rounded-xl bg-sunken p-3 text-xs font-serif" v-html="convertPreview" /></div>
        </div>
        <div class="flex gap-2 justify-end">
          <button @click="convertOpen = false" class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary cursor-pointer">取消</button>
          <button v-if="textSections.length > 1" @click="convert(true)" class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary cursor-pointer">全部 {{ textSections.length }} 個純文字段落都轉換</button>
          <button @click="convert(false)" class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white cursor-pointer">轉換這一段</button>
        </div>
      </div>
    </div>

    <!-- 插入圖片：去識別化確認 -->
    <div v-if="phiConfirm" class="fixed inset-0 z-[9400] flex items-center justify-center bg-sunken/60 backdrop-blur-sm">
      <div class="w-[26rem] bg-surface border border-hairline rounded-2xl shadow-2xl p-6 space-y-4 text-fg">
        <h3 class="text-sm font-black">插入圖片：{{ phiConfirm.name }}</h3>
        <p class="text-xs text-fg-secondary leading-relaxed">論文專案不得存放可識別病人的資訊。圖片會存在本機並隨個人備份上傳。</p>
        <label class="flex items-start gap-2 text-xs font-bold cursor-pointer select-none">
          <input type="checkbox" v-model="phiConfirm.checked" class="accent-accent mt-0.5" />
          我確認這張圖片不含病人臉部、姓名、病歷號、檢體號、日期或其他可識別資訊（影像已去識別化）
        </label>
        <div class="flex justify-end gap-2">
          <button @click="answerImage(false)" class="px-4 py-2 rounded-xl text-xs font-bold border border-hairline cursor-pointer">取消</button>
          <button @click="answerImage(true)" :disabled="!phiConfirm.checked" class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white disabled:opacity-40 cursor-pointer">插入</button>
        </div>
      </div>
    </div>
  </Teleport>
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

<style scoped>
.ms-preview :deep(p) { margin: 0 0 0.6em; }
</style>
