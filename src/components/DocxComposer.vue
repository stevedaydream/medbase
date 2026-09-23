<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { getDb } from "@/db";
import { DOCX_TEMPLATES, dayCount } from "@/shared/docxTemplates";
import type { MetaValues, BlockValues, MetaField } from "@/shared/docxTemplates";
// 檔案讀取、提示組裝、模板填充見 shared/docxCompose（手機共用，ADR-013）
import { readSourceFile, buildGeminiParts, generateBlocks, renderDocx, type SourceFile } from "@/shared/docxCompose";

const props = defineProps<{
  template: "case" | "leave";
  apiKey: string;
  model: string;
}>();
const emit = defineEmits<{ (e: "toast", msg: string): void }>();

type UploadedFile = SourceFile;

const tpl = computed(() => DOCX_TEMPLATES[props.template]);

// ── State ──────────────────────────────────────────────────────────────
const meta        = reactive<MetaValues>({});
const blocks      = reactive<BlockValues>({});
const files       = ref<UploadedFile[]>([]);
const manualText  = ref("");
const deidentify  = ref(props.template === "case");
const isGenerating = ref(false);
const isExporting  = ref(false);
const fileInput   = ref<HTMLInputElement | null>(null);

// 依模板初始化欄位 / 區塊
function resetForTemplate() {
  for (const k of Object.keys(meta)) delete meta[k];
  for (const f of tpl.value.fields) meta[f.key] = f.default ?? "";
  for (const k of Object.keys(blocks)) delete blocks[k];
  for (const b of tpl.value.blocks) blocks[b.key] = "";
  files.value = [];
  manualText.value = "";
  deidentify.value = props.template === "case";
}
watch(() => props.template, resetForTemplate, { immediate: true });

const leaveDays = computed(() =>
  props.template === "leave" ? dayCount(meta.date_from, meta.date_to) : null
);

// ── 排班人員名單（姓名→員編自動帶入）─────────────────────────────────────
// 人員清單存於 app_settings 的 'staff' JSON（見 useStaff.ts saveStaffLocal），非 scheduler_users 表
interface Staff { name: string; employee_id: string }
const staffList = ref<Staff[]>([]);
onMounted(async () => {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = 'scheduler_staff'"
    );
    if (rows.length && rows[0].value) {
      const arr = JSON.parse(rows[0].value) as { name?: string; employee_id?: string }[];
      staffList.value = arr
        .filter(s => s.name?.trim())
        .map(s => ({ name: s.name!.trim(), employee_id: (s.employee_id ?? "").trim() }));
    }
  } catch { /* 無人員資料時略過 */ }
});

function onStaffChange(field: MetaField) {
  if (!field.autofillKey) return;
  const hit = staffList.value.find(s => s.name === meta[field.key]);
  if (hit && hit.employee_id) meta[field.autofillKey] = hit.employee_id;
}

// 迄日預設帶起日（起日設定且迄日尚空時鏡像）
watch(() => meta.date_from, (nv) => {
  if (nv && !meta.date_to) meta.date_to = nv;
});

const hasSource = computed(() => files.value.length > 0 || manualText.value.trim().length > 0);

// ── 檔案處理 ────────────────────────────────────────────────────────────
async function onFilesSelected(e: Event) {
  const list = (e.target as HTMLInputElement).files;
  if (!list) return;
  for (const file of Array.from(list)) {
    try {
      const src = readSourceFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!src) { emit("toast", `不支援的格式：${file.name}`); continue; }
      if (src.kind === "pptx" && !src.text?.trim()) { emit("toast", `「${file.name}」未抽取到文字`); continue; }
      files.value.push(src);
    } catch (err) {
      emit("toast", `讀取失敗：${(err as Error).message}`);
    }
  }
  if (fileInput.value) fileInput.value.value = "";
}

function removeFile(i: number) { files.value.splice(i, 1); }

// ── AI 整理 ─────────────────────────────────────────────────────────────
async function generate() {
  if (!props.apiKey) { emit("toast", "請先至設定頁填入 Gemini API Key"); return; }
  if (!hasSource.value) { emit("toast", "請先上傳檔案或輸入文字"); return; }
  isGenerating.value = true;
  try {
    const parts = buildGeminiParts(props.template, files.value, manualText.value, deidentify.value);
    Object.assign(blocks, await generateBlocks(props.template, props.apiKey, props.model, parts));
    emit("toast", "AI 整理完成，可於下方微調後匯出");
  } catch (e) {
    emit("toast", `整理失敗：${(e as Error).message}`);
  } finally {
    isGenerating.value = false;
  }
}

// ── 匯出 .docx（docxtemplater 填充原始模板，格式 100% 保留）─────────────
async function exportDocx() {
  isExporting.value = true;
  try {
    const t = tpl.value;
    const buf = renderDocx(props.template, { ...meta }, { ...blocks });
    const path = await saveDialog({
      defaultPath: t.fileName(meta),
      filters: [{ name: "Word 文件", extensions: ["docx"] }],
    });
    if (!path) return;
    await writeFile(path, buf);
    emit("toast", "已匯出 .docx");
  } catch (e) {
    emit("toast", `匯出失敗：${(e as Error).message}`);
  } finally {
    isExporting.value = false;
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-5">

    <!-- ── Metadata 表單 ──────────────────────────────────────── -->
    <section>
      <h3 class="text-2xs font-black text-muted mb-2.5">
        表單資料 — {{ tpl.heading }}
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
        <div v-for="f in tpl.fields" :key="f.key" class="flex flex-col gap-1">
          <label class="text-2xs font-bold text-muted">{{ f.label }}</label>

          <!-- toggle -->
          <div v-if="f.type === 'toggle' && f.toggleOptions" class="flex gap-1.5">
            <button v-for="opt in f.toggleOptions" :key="opt"
              @click="meta[f.key] = opt"
              class="flex-1 text-xs font-bold px-3 py-1.5 rounded-xl border transition-all cursor-pointer"
              :class="meta[f.key] === opt
                ? 'bg-accent/10 border-accent/40 text-accent'
                : 'bg-surface border-hairline text-fg-secondary hover:text-fg'">
              {{ opt }}
            </button>
          </div>

          <!-- staff：姓名下拉（讀排班人員），選定自動帶員編 -->
          <div v-else-if="f.type === 'staff' && staffList.length" class="relative">
            <select
              v-model="meta[f.key]"
              @change="onStaffChange(f)"
              class="w-full appearance-none text-xs pl-3 pr-8 py-1.5 bg-sunken border border-hairline rounded-xl
                     text-fg focus:outline-none focus:border-accent/50 cursor-pointer font-bold">
              <option value="">— 選擇姓名 —</option>
              <option v-for="s in staffList" :key="s.employee_id || s.name" :value="s.name">
                {{ s.name }}
              </option>
            </select>
            <span class="absolute right-3 top-2 text-2xs text-muted pointer-events-none">▼</span>
          </div>

          <!-- staff 後備：排班名單為空時改用文字輸入 -->
          <input v-else-if="f.type === 'staff'"
            v-model="meta[f.key]"
            placeholder="姓名（排班名單為空）"
            class="text-xs px-3 py-1.5 bg-sunken border border-hairline rounded-xl text-fg
                   placeholder:text-muted focus:outline-none focus:border-accent/50 font-bold" />

          <!-- date / time / text -->
          <input v-else
            v-model="meta[f.key]"
            :type="f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'"
            :placeholder="f.placeholder ?? ''"
            class="text-xs px-3 py-1.5 bg-sunken border border-hairline rounded-xl text-fg
                   placeholder:text-muted focus:outline-none focus:border-accent/50 font-bold
                   [color-scheme:dark]" />
        </div>
      </div>
      <p v-if="leaveDays !== null" class="mt-2 text-2xs font-bold text-success">
        起迄共 {{ leaveDays }} 日
      </p>
    </section>

    <!-- ── 來源輸入 ──────────────────────────────────────────── -->
    <section>
      <div class="flex items-center gap-3 mb-2.5">
        <h3 class="text-2xs font-black text-muted">來源資料</h3>
        <button @click="fileInput?.click()"
          class="text-2xs font-bold px-3 py-1.5 rounded-xl border border-hairline bg-surface text-fg-secondary
                 hover:text-accent hover:border-accent/30 transition-all cursor-pointer">
          ＋ 上傳 PDF / PPTX
        </button>
        <input ref="fileInput" type="file" accept=".pdf,.pptx" multiple class="hidden" @change="onFilesSelected" />

        <button @click="deidentify = !deidentify"
          class="text-2xs font-bold px-3 py-1.5 rounded-xl border transition-all cursor-pointer ml-auto"
          :class="deidentify
            ? 'bg-warning/15 border-warning/30 text-warning'
            : 'bg-surface border-hairline text-muted hover:text-fg-secondary'">
          🛡 去識別化
        </button>
      </div>

      <!-- 已上傳檔案 -->
      <div v-if="files.length" class="flex flex-wrap gap-2 mb-2.5">
        <span v-for="(f, i) in files" :key="i"
          class="flex items-center gap-1.5 text-2xs font-bold px-2.5 py-1 rounded-lg border border-hairline bg-surface text-fg-secondary">
          <span :class="f.kind === 'pdf' ? 'text-danger' : 'text-warning'">
            {{ f.kind === 'pdf' ? '📄' : '📊' }}
          </span>
          {{ f.name }}
          <button @click="removeFile(i)" class="text-muted hover:text-danger cursor-pointer">✕</button>
        </span>
      </div>

      <textarea
        v-model="manualText"
        placeholder="（選填）在此貼上補充文字、口頭補充說明或重點…"
        rows="3"
        class="w-full resize-y text-xs bg-sunken border border-hairline focus:border-accent/30 rounded-2xl p-3.5 placeholder:text-muted focus:outline-none leading-relaxed text-fg custom-scrollbar transition-all" />

      <div class="mt-3">
        <button @click="generate"
          :disabled="isGenerating || !hasSource || !apiKey"
          :title="!apiKey ? '請先至設定頁填入 Gemini API Key' : ''"
          class="flex items-center gap-2 px-6 py-2.5 text-xs font-black rounded-xl bg-accent border border-accent/30
                 hover:bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed
                 hover:shadow-[0_0_15px_rgba(99,102,241,0.25)] transition-all cursor-pointer">
          <span v-if="isGenerating" class="inline-block w-3.5 h-3.5 border-2 border-hairline border-t-white rounded-full animate-spin" />
          <span v-else>✦</span>
          {{ isGenerating ? "AI 整理中…" : "AI 整理 → 填入區塊" }}
        </button>
        <span v-if="!apiKey" class="ml-3 text-xs text-warning font-bold">⚠️ 請先至設定頁填入 Gemini API Key</span>
      </div>
    </section>

    <!-- ── 結構化區塊（可編輯）──────────────────────────────── -->
    <section>
      <h3 class="text-2xs font-black text-muted mb-2.5">結構化內容（可微調）</h3>
      <div class="space-y-3">
        <div v-for="b in tpl.blocks" :key="b.key" class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold text-accent">{{ b.label }}</label>
          <textarea
            v-model="blocks[b.key]"
            rows="4"
            :placeholder="b.instruction"
            class="resize-y text-xs bg-sunken border border-hairline rounded-xl text-fg
                   px-3.5 py-2.5 focus:outline-none focus:border-accent/50 leading-relaxed
                   custom-scrollbar placeholder:text-muted transition-colors" />
        </div>
      </div>

      <div class="mt-4">
        <button @click="exportDocx" :disabled="isExporting"
          class="flex items-center gap-2 px-6 py-2.5 text-xs font-black rounded-xl bg-success/90 border border-success/30
                 hover:bg-success text-white disabled:opacity-40 disabled:cursor-not-allowed
                 hover:shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all cursor-pointer">
          <span v-if="isExporting" class="inline-block w-3.5 h-3.5 border-2 border-hairline border-t-white rounded-full animate-spin" />
          <span v-else>⬇</span>
          {{ isExporting ? "匯出中…" : "匯出 .docx" }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 2px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
</style>
