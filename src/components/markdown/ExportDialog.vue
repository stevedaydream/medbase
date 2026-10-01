<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { dirname, join } from "@tauri-apps/api/path";
import { getDb, dbWrite } from "@/db";
import { normalizePrint, type PrintSettings, type Paper, type PageNumber } from "@/shared/markdown/export/settings";
import { buildHtml } from "@/shared/markdown/export/html";
import { buildDocx } from "@/shared/markdown/export/docx";
import { buildEpub } from "@/shared/markdown/export/epub";
import { buildLatex } from "@/shared/markdown/export/latex";
import { prepareAssets, printHtml, type ImageLoader } from "./exportAssets";

/**
 * 匯出對話框（Markdown 文件、論文稿件共用）：PDF（列印）、Word、HTML、EPUB、LaTeX、Markdown。
 * 版面設定記在 app_settings，下次沿用。
 */
const props = defineProps<{
  open: boolean;
  /** 取得要匯出的 Markdown（開啟對話框時才讀，拿到最新內容） */
  getMarkdown: () => string;
  /** 預設檔名（不含副檔名）與標題 */
  baseName: string;
  defaultDir?: string | null;
  loadImage: ImageLoader;
}>();
const emit = defineEmits<{ (e: "close"): void; (e: "notice", msg: string): void }>();

type Kind = "pdf" | "docx" | "html" | "epub" | "tex" | "md";
const KINDS: { key: Kind; label: string; desc: string }[] = [
  { key: "pdf", label: "PDF", desc: "開啟列印對話框，選「另存為 PDF」；右側即實際分頁預覽" },
  { key: "docx", label: "Word", desc: ".docx，公式為 Word 方程式、註腳為 Word 註腳" },
  { key: "html", label: "HTML", desc: "單一檔案，圖片內嵌" },
  { key: "epub", label: "EPUB", desc: "電子書，依一級標題分章" },
  { key: "tex", label: "LaTeX", desc: ".tex（XeLaTeX），圖片一併複製" },
  { key: "md", label: "Markdown", desc: ".md，引用的圖片一併複製到 assets" },
];

const SETTINGS_KEY = "md_print_settings";
const kind = ref<Kind>("pdf");
const s = ref<PrintSettings>(normalizePrint(null));
const busy = ref(false);
const warnings = ref<string[]>([]);
const usesPage = computed(() => kind.value === "pdf" || kind.value === "docx" || kind.value === "tex" || kind.value === "html");

watch(() => props.open, async o => {
  if (!o) return;
  warnings.value = [];
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key = ?", [SETTINGS_KEY]);
    const saved = rows[0] ? JSON.parse(rows[0].value) as Partial<PrintSettings> & { kind?: Kind } : null;
    s.value = normalizePrint(saved);
    if (saved?.kind) kind.value = saved.kind;
  } catch { s.value = normalizePrint(null); }
  s.value.title = props.baseName;
}, { immediate: true });

async function remember() {
  const { title: _t, ...rest } = s.value;
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [SETTINGS_KEY, JSON.stringify({ ...rest, kind: kind.value })]).catch(() => {});
}

const safeName = (n: string) => (n.trim() || "document").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
const EXT: Record<Kind, string> = { pdf: "pdf", docx: "docx", html: "html", epub: "epub", tex: "tex", md: "md" };
const FILTER: Record<Kind, string> = { pdf: "PDF", docx: "Word 文件", html: "HTML", epub: "EPUB 電子書", tex: "LaTeX", md: "Markdown" };

/** 相對路徑圖片複製到匯出檔旁（Markdown、LaTeX） */
async function copyImages(md: string, target: string) {
  const { collectSources } = await import("./exportAssets");
  const dir = await dirname(target);
  for (const src of collectSources(md).images) {
    if (/^(https?:|data:|[a-zA-Z]:[\\/]|\/)/i.test(src)) continue;
    const raw = await props.loadImage(src).catch(() => null);
    if (!raw) { warnings.value.push(`找不到圖片：${src}`); continue; }
    const dest = await join(dir, decodeURI(src));
    const destDir = await dirname(dest);
    if (!(await exists(destDir))) await mkdir(destDir, { recursive: true });
    await writeFile(dest, raw.bytes);
  }
}

async function run() {
  busy.value = true;
  warnings.value = [];
  try {
    await remember();
    const md = props.getMarkdown();
    const settings = { ...s.value };
    const needAssets = kind.value !== "md" && kind.value !== "tex";
    const prep = needAssets ? await prepareAssets(md, props.loadImage, { png: kind.value === "docx" }) : null;
    warnings.value.push(...(prep?.warnings ?? []));
    if (kind.value === "pdf") {
      await printHtml(buildHtml(md, settings, prep!.assets));
      if (!warnings.value.length) emit("close");
      return;
    }
    const base = safeName(props.baseName);
    const defaultPath = props.defaultDir ? await join(props.defaultDir, `${base}.${EXT[kind.value]}`) : `${base}.${EXT[kind.value]}`;
    const path = await saveDialog({ title: `匯出 ${FILTER[kind.value]}`, defaultPath, filters: [{ name: FILTER[kind.value], extensions: [EXT[kind.value]] }] });
    if (!path) return;
    if (kind.value === "docx") await writeFile(path, buildDocx(md, settings, prep!.assets));
    else if (kind.value === "html") await writeTextFile(path, buildHtml(md, settings, prep!.assets));
    else if (kind.value === "epub") await writeFile(path, buildEpub(md, settings, prep!.assets));
    else if (kind.value === "tex") { await writeTextFile(path, buildLatex(md, settings)); await copyImages(md, path); }
    else { await writeTextFile(path, md); await copyImages(md, path); }
    emit("notice", `已匯出：${path.split(/[\\/]/).pop()}`);
    if (!warnings.value.length) emit("close");
  } catch (e) {
    warnings.value.push(`匯出失敗：${(e as Error).message ?? e}`);
  } finally {
    busy.value = false;
  }
}

const PAPERS: Paper[] = ["A4", "A5", "B5", "Letter"];
const PAGE_NUMBERS: { v: PageNumber; label: string }[] = [
  { v: "page-total", label: "第 1 頁，共 N 頁" }, { v: "page", label: "第 1 頁" }, { v: "none", label: "不顯示" },
];
const field = "w-full px-2.5 py-1.5 rounded-lg bg-sunken border border-hairline text-xs text-fg outline-none focus:border-accent/50";
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[9300] flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm" @click.self="emit('close')">
      <div class="w-[44rem] max-w-[95vw] max-h-[90vh] flex flex-col bg-surface border border-hairline rounded-2xl shadow-2xl text-fg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-hairline shrink-0">
          <h3 class="text-sm font-black">匯出</h3>
          <button @click="emit('close')" class="text-muted hover:text-fg text-lg leading-none cursor-pointer">×</button>
        </div>
        <div class="flex-1 overflow-y-auto p-5 space-y-5">
          <div class="grid grid-cols-3 gap-2">
            <button v-for="k in KINDS" :key="k.key" @click="kind = k.key"
              class="text-left px-3 py-2.5 rounded-xl border cursor-pointer"
              :class="kind === k.key ? 'border-accent bg-accent/5' : 'border-hairline hover:border-accent/40'">
              <span class="block text-sm font-black" :class="kind === k.key ? 'text-accent' : 'text-fg'">{{ k.label }}</span>
              <span class="block text-2xs text-muted mt-0.5 leading-snug">{{ k.desc }}</span>
            </button>
          </div>

          <section class="space-y-3">
            <label class="block">
              <span class="text-2xs font-bold text-muted">文件標題</span>
              <input v-model="s.title" :class="field" />
            </label>
            <template v-if="usesPage">
              <p class="text-xs font-black text-fg-secondary pt-1">版面與分頁</p>
              <div class="grid grid-cols-4 gap-3">
                <label class="block"><span class="text-2xs font-bold text-muted">紙張</span>
                  <select v-model="s.paper" :class="field"><option v-for="p in PAPERS" :key="p" :value="p">{{ p }}</option></select></label>
                <label class="block"><span class="text-2xs font-bold text-muted">方向</span>
                  <select v-model="s.landscape" :class="field"><option :value="false">直式</option><option :value="true">橫式</option></select></label>
                <label class="block"><span class="text-2xs font-bold text-muted">字級（pt）</span>
                  <input v-model.number="s.fontSize" type="number" min="8" max="20" step="0.5" :class="field" /></label>
                <label class="block"><span class="text-2xs font-bold text-muted">行距</span>
                  <input v-model.number="s.lineHeight" type="number" min="1" max="3" step="0.1" :class="field" /></label>
              </div>
              <div class="grid grid-cols-4 gap-3">
                <label v-for="side in (['top', 'right', 'bottom', 'left'] as const)" :key="side" class="block">
                  <span class="text-2xs font-bold text-muted">{{ { top: '上', right: '右', bottom: '下', left: '左' }[side] }}邊界（mm）</span>
                  <input v-model.number="s.margin[side]" type="number" min="0" max="60" :class="field" />
                </label>
              </div>
              <div class="grid grid-cols-3 gap-3">
                <label class="block"><span class="text-2xs font-bold text-muted">頁首文字</span>
                  <input v-model="s.header" placeholder="不顯示" :class="field" /></label>
                <label class="block"><span class="text-2xs font-bold text-muted">頁尾文字</span>
                  <input v-model="s.footer" placeholder="不顯示" :class="field" /></label>
                <label class="block"><span class="text-2xs font-bold text-muted">頁碼</span>
                  <select v-model="s.pageNumber" :class="field"><option v-for="p in PAGE_NUMBERS" :key="p.v" :value="p.v">{{ p.label }}</option></select></label>
              </div>
              <div class="grid grid-cols-3 gap-3 items-end">
                <label class="block"><span class="text-2xs font-bold text-muted">標題前自動換頁</span>
                  <select v-model="s.headingBreak" :class="field">
                    <option :value="0">不換頁</option><option :value="1">一級標題</option>
                    <option :value="2">一、二級標題</option><option :value="3">一至三級標題</option>
                  </select></label>
                <label class="flex items-center gap-2 text-xs pb-1.5 cursor-pointer select-none col-span-2">
                  <input type="checkbox" v-model="s.toc" class="accent-accent" />在文件開頭插入目錄
                </label>
              </div>
              <p class="text-2xs text-muted leading-relaxed">
                手動分頁：在內文工具列按「⤓」插入分頁標記。表格、圖片、公式、程式碼區塊不會被切到兩頁，標題不會單獨留在頁尾。
                <template v-if="kind === 'pdf'">按「匯出」後開啟列印對話框，右側預覽就是實際的 PDF 分頁。</template>
              </p>
            </template>
          </section>

          <div v-if="warnings.length" class="rounded-xl bg-warning/10 text-warning text-xs p-3 space-y-1">
            <p v-for="(w, i) in warnings" :key="i">⚠ {{ w }}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-5 py-3.5 border-t border-hairline shrink-0">
          <button @click="emit('close')" class="px-4 py-2 rounded-xl text-xs font-bold border border-hairline text-fg-secondary cursor-pointer">關閉</button>
          <button @click="run" :disabled="busy" class="px-5 py-2 rounded-xl text-xs font-bold bg-accent text-white disabled:opacity-40 cursor-pointer">
            {{ busy ? '處理中…' : kind === 'pdf' ? '預覽與列印' : '匯出' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
