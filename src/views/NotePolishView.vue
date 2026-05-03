<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";

interface NoteTemplate {
  format_key: string;
  format_label: string;
  system_prompt: string;
  example: string;
}

interface NoteRecord {
  id: number;
  patient_id: string;
  patient_name: string;
  bed_no: string;
  format_key: string;
  format_label: string;
  model: string;
  input_text: string;
  output_text: string;
  created_at: string;
}

const MODELS = [
  { id: "gemini-2.5-flash", label: "2.5 Flash" },
  { id: "gemini-2.5-pro",   label: "2.5 Pro" },
  { id: "gemini-2.5-flash-preview-04-17", label: "2.5 Flash (preview)" },
  { id: "gemini-2.0-flash", label: "2.0 Flash" },
] as const;

// ── State ──────────────────────────────────────────────────────────────
const templates     = ref<NoteTemplate[]>([]);
const activeKey     = ref("discharge");
const inputText     = ref("");
const outputText    = ref("");
const isGenerating  = ref(false);
const apiKey        = ref("");
const selectedModel = ref("gemini-2.5-flash");
const copied        = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

// Patient info
const patientId   = ref("");
const patientName = ref("");
const bedNo       = ref("");

// Edit example modal
const editOpen         = ref(false);
const editSystemPrompt = ref("");
const editExample      = ref("");

// History modal
const historyOpen    = ref(false);
const records        = ref<NoteRecord[]>([]);
const historySearch  = ref("");

// Toast
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// ── Computed ────────────────────────────────────────────────────────────
const activeTemplate = computed(
  () => templates.value.find(t => t.format_key === activeKey.value) ?? null
);

const filteredRecords = computed(() => {
  const q = historySearch.value.trim().toLowerCase();
  if (!q) return records.value;
  return records.value.filter(r =>
    r.patient_id.toLowerCase().includes(q) ||
    r.patient_name.toLowerCase().includes(q) ||
    r.bed_no.toLowerCase().includes(q) ||
    r.format_label.toLowerCase().includes(q)
  );
});

// ── Lifecycle ───────────────────────────────────────────────────────────
onMounted(async () => {
  const db = await getDb();
  templates.value = await db.select<NoteTemplate[]>(
    "SELECT format_key, format_label, system_prompt, example FROM note_templates ORDER BY rowid"
  );
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_model')"
  );
  for (const r of rows) {
    if (r.key === "gemini_api_key") apiKey.value       = r.value;
    if (r.key === "gemini_model")   selectedModel.value = r.value;
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

// ── Generate ────────────────────────────────────────────────────────────
async function generate() {
  const tpl = activeTemplate.value;
  if (!tpl || !inputText.value.trim() || !apiKey.value) return;
  isGenerating.value = true;
  outputText.value   = "";

  try {
    const parts: string[] = [];
    if (tpl.system_prompt.trim()) parts.push(tpl.system_prompt.trim());
    if (tpl.example.trim()) {
      parts.push("");
      parts.push("以下是範例輸出格式供參考：");
      parts.push("---");
      parts.push(tpl.example.trim());
      parts.push("---");
    }
    parts.push("");
    parts.push("請將以下病歷草稿按上述格式整理：");
    parts.push("");
    parts.push(inputText.value.trim());

    const prompt = parts.join("\n");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel.value}:generateContent?key=${apiKey.value}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
      if (res.status === 429) throw new Error("請求頻率超限（429），請稍候約 1 分鐘後再試。");
      if (res.status === 400) throw new Error(`請求錯誤（400）：${errBody?.error?.message ?? "請確認 API Key 與模型名稱"}`);
      throw new Error(errBody?.error?.message ?? `API 錯誤 HTTP ${res.status}`);
    }

    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) throw new Error("API 回傳空白結果");
    outputText.value = text;
  } catch (e) {
    showToast(`生成失敗：${(e as Error).message}`);
  } finally {
    isGenerating.value = false;
  }
}

// ── Model persistence ───────────────────────────────────────────────────
async function onModelChange() {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gemini_model', ?)",
    [selectedModel.value]
  );
}

// ── Copy output ─────────────────────────────────────────────────────────
async function copyOutput() {
  await navigator.clipboard.writeText(outputText.value);
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 2000);
}

// ── Save record ─────────────────────────────────────────────────────────
async function saveRecord() {
  if (!outputText.value.trim()) { showToast("尚無輸出結果可儲存"); return; }
  const tpl = activeTemplate.value;
  const db  = await getDb();
  await db.execute(
    `INSERT INTO note_records (patient_id, patient_name, bed_no, format_key, format_label, model, input_text, output_text)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      patientId.value.trim(),
      patientName.value.trim(),
      bedNo.value.trim(),
      tpl?.format_key   ?? activeKey.value,
      tpl?.format_label ?? activeKey.value,
      selectedModel.value,
      inputText.value,
      outputText.value,
    ]
  );
  showToast("已儲存至歷史記錄");
}

// ── History ─────────────────────────────────────────────────────────────
async function openHistory() {
  const db = await getDb();
  records.value = await db.select<NoteRecord[]>(
    "SELECT * FROM note_records ORDER BY id DESC LIMIT 200"
  );
  historySearch.value = "";
  historyOpen.value   = true;
}

function loadRecord(r: NoteRecord) {
  patientId.value   = r.patient_id;
  patientName.value = r.patient_name;
  bedNo.value       = r.bed_no;
  activeKey.value   = r.format_key;
  inputText.value   = r.input_text;
  outputText.value  = r.output_text;
  historyOpen.value = false;
  showToast("已載入記錄");
}

async function deleteRecord(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM note_records WHERE id = ?", [id]);
  records.value = records.value.filter(r => r.id !== id);
}

// ── Edit example ────────────────────────────────────────────────────────
function openEdit() {
  if (!activeTemplate.value) return;
  editSystemPrompt.value = activeTemplate.value.system_prompt;
  editExample.value      = activeTemplate.value.example;
  editOpen.value         = true;
}

async function saveEdit() {
  const tpl = activeTemplate.value;
  if (!tpl) return;
  const db = await getDb();
  await db.execute(
    "UPDATE note_templates SET system_prompt=?, example=? WHERE format_key=?",
    [editSystemPrompt.value, editExample.value, tpl.format_key]
  );
  const idx = templates.value.findIndex(t => t.format_key === tpl.format_key);
  if (idx >= 0) {
    templates.value[idx] = {
      ...templates.value[idx],
      system_prompt: editSystemPrompt.value,
      example:       editExample.value,
    };
  }
  editOpen.value = false;
  showToast("範例已儲存");
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-zinc-950">

    <!-- ── 頂部格式 tab 列 ──────────────────────────────────────────── -->
    <div class="flex items-center gap-1 px-3 py-2 border-b border-zinc-800 bg-zinc-900 shrink-0 overflow-x-auto">
      <button
        v-for="t in templates" :key="t.format_key"
        @click="activeKey = t.format_key"
        class="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap"
        :class="activeKey === t.format_key
          ? 'bg-blue-800/60 border-blue-600/60 text-white'
          : 'bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'"
      >
        {{ t.format_label }}
      </button>

      <div class="ml-auto flex items-center gap-2 shrink-0">
        <button
          @click="openHistory"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700
                 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
        >
          📂 歷史記錄
        </button>
        <button
          @click="openEdit"
          :disabled="!activeTemplate"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700
                 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-30 transition-colors"
        >
          ⚙ 編輯範例
        </button>
      </div>
    </div>

    <!-- ── 病人資訊列 ───────────────────────────────────────────────── -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
      <span class="text-[10px] text-zinc-600 shrink-0">病人</span>
      <input
        v-model="patientId"
        placeholder="病歷號"
        class="w-28 text-xs px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-300
               placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
      />
      <input
        v-model="patientName"
        placeholder="姓名"
        class="w-24 text-xs px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-300
               placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
      />
      <input
        v-model="bedNo"
        placeholder="床號"
        class="w-20 text-xs px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-300
               placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
      />
    </div>

    <!-- ── 輸入區 ───────────────────────────────────────────────────── -->
    <div class="flex flex-col border-b border-zinc-800 overflow-hidden" style="flex: 1 1 0">
      <div class="flex items-center px-4 py-2 border-b border-zinc-800 shrink-0">
        <span class="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">輸入草稿</span>
        <button
          v-if="inputText"
          @click="inputText = ''"
          class="ml-auto text-xs text-zinc-700 hover:text-zinc-400 transition-colors"
        >清除</button>
      </div>
      <textarea
        v-model="inputText"
        placeholder="在此貼上病歷草稿（progress notes）…"
        class="flex-1 resize-none bg-transparent text-sm text-zinc-300 px-4 py-3
               placeholder:text-zinc-700 focus:outline-none font-mono leading-relaxed"
      />
    </div>

    <!-- ── 操作列 ───────────────────────────────────────────────────── -->
    <div class="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
      <button
        @click="generate"
        :disabled="isGenerating || !inputText.trim() || !activeTemplate || !apiKey"
        :title="!apiKey ? '請先至設定頁填入 Gemini API Key' : ''"
        class="flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg
               bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 transition-colors"
      >
        <span v-if="isGenerating"
          class="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
        />
        <span v-else>✦</span>
        {{ isGenerating ? "生成中…" : "生成" }}
      </button>

      <select
        v-model="selectedModel"
        @change="onModelChange"
        class="text-xs px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300
               focus:outline-none focus:border-zinc-500 cursor-pointer"
      >
        <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select>

      <span v-if="!apiKey" class="text-xs text-amber-500/80">⚠ 請先至設定頁填入 Gemini API Key</span>

      <div class="ml-auto flex items-center gap-2">
        <button
          @click="saveRecord"
          :disabled="!outputText.trim()"
          class="text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-30
                 border-emerald-700 text-emerald-500 hover:bg-emerald-900/30 hover:border-emerald-500"
        >
          💾 儲存
        </button>
        <button
          v-if="outputText"
          @click="copyOutput"
          class="text-xs px-3 py-1.5 rounded-lg border transition-colors"
          :class="copied
            ? 'bg-emerald-700/40 border-emerald-600/50 text-emerald-300'
            : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'"
        >
          {{ copied ? "✓ 已複製" : "複製" }}
        </button>
      </div>
    </div>

    <!-- ── 輸出區 ───────────────────────────────────────────────────── -->
    <div class="flex flex-col overflow-hidden" style="flex: 1 1 0">
      <div class="flex items-center px-4 py-2 border-b border-zinc-800 shrink-0">
        <span class="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">輸出結果</span>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-3">
        <pre v-if="outputText"
          class="text-sm text-zinc-200 whitespace-pre-wrap font-mono leading-relaxed"
        >{{ outputText }}</pre>
        <div v-else class="flex items-center justify-center h-full text-zinc-700 text-sm">
          點擊「生成」後，結果將顯示於此
        </div>
      </div>
    </div>

    <!-- ── 歷史記錄 Modal ────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="historyOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="historyOpen = false"
      >
        <div
          class="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col"
          style="width: 700px; max-width: 92vw; max-height: 80vh"
        >
          <div class="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
            <h2 class="text-sm font-semibold text-white">歷史記錄</h2>
            <input
              v-model="historySearch"
              placeholder="搜尋病歷號、姓名、床號…"
              class="ml-4 flex-1 text-xs px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg
                     text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <button
              @click="historyOpen = false"
              class="ml-2 text-zinc-500 hover:text-zinc-300 text-xl leading-none"
            >×</button>
          </div>

          <div class="flex-1 overflow-y-auto">
            <div v-if="!filteredRecords.length"
              class="py-12 text-center text-zinc-600 text-sm">
              {{ records.length ? '無符合搜尋條件的記錄' : '尚無儲存記錄' }}
            </div>

            <table v-else class="w-full text-xs">
              <thead class="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                <tr>
                  <th class="text-left px-4 py-2 text-zinc-500 font-medium">時間</th>
                  <th class="text-left px-3 py-2 text-zinc-500 font-medium">病歷號</th>
                  <th class="text-left px-3 py-2 text-zinc-500 font-medium">姓名</th>
                  <th class="text-left px-3 py-2 text-zinc-500 font-medium">床號</th>
                  <th class="text-left px-3 py-2 text-zinc-500 font-medium">格式</th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in filteredRecords" :key="r.id"
                  class="border-b border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer transition-colors group"
                  @click="loadRecord(r)"
                >
                  <td class="px-4 py-2.5 text-zinc-500 whitespace-nowrap">
                    {{ r.created_at.slice(0, 16) }}
                  </td>
                  <td class="px-3 py-2.5 text-zinc-300 font-mono">{{ r.patient_id || '—' }}</td>
                  <td class="px-3 py-2.5 text-zinc-300">{{ r.patient_name || '—' }}</td>
                  <td class="px-3 py-2.5 text-zinc-400 font-mono">{{ r.bed_no || '—' }}</td>
                  <td class="px-3 py-2.5">
                    <span class="px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-800/50 text-blue-300">
                      {{ r.format_label }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    <button
                      @click.stop="deleteRecord(r.id)"
                      class="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all px-1"
                      title="刪除"
                    >✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-5 py-3 border-t border-zinc-800 shrink-0 text-[11px] text-zinc-600">
            共 {{ records.length }} 筆記錄，點擊列表可載入
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 編輯範例 Modal ────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="editOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="editOpen = false"
      >
        <div
          class="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[640px] max-w-[90vw] flex flex-col"
          style="max-height: 80vh"
        >
          <div class="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
            <h2 class="text-sm font-semibold text-white">
              編輯範例 — {{ activeTemplate?.format_label }}
            </h2>
            <button
              @click="editOpen = false"
              class="ml-auto text-zinc-500 hover:text-zinc-300 text-xl leading-none"
            >×</button>
          </div>

          <div class="flex flex-col flex-1 min-h-0 px-5 py-4 gap-3 overflow-hidden">
            <div class="flex flex-col gap-1 shrink-0">
              <label class="text-xs text-zinc-500">
                System Prompt（角色說明，如：你是資深住院醫師，請整理為標準中文出院摘要…）
              </label>
              <textarea
                v-model="editSystemPrompt"
                rows="4"
                class="resize-none text-sm bg-zinc-800 border border-zinc-700 rounded-lg
                       text-zinc-200 px-3 py-2 focus:outline-none focus:border-blue-500 font-mono leading-relaxed"
              />
            </div>
            <div class="flex flex-col gap-1 flex-1 min-h-0">
              <label class="text-xs text-zinc-500">
                範例輸出（給 AI 參考的格式樣板，越具體效果越好）
              </label>
              <textarea
                v-model="editExample"
                class="flex-1 resize-none text-sm bg-zinc-800 border border-zinc-700 rounded-lg
                       text-zinc-200 px-3 py-2 focus:outline-none focus:border-blue-500 font-mono leading-relaxed"
              />
            </div>
          </div>

          <div class="flex justify-end gap-3 px-5 py-4 border-t border-zinc-800 shrink-0">
            <button
              @click="editOpen = false"
              class="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
            >取消</button>
            <button
              @click="saveEdit"
              class="px-5 py-2 text-sm font-semibold bg-blue-700 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >儲存</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Transition name="toast">
      <div
        v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-700 text-white text-sm
               rounded-lg shadow-xl z-50 pointer-events-none"
      >
        {{ toast }}
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
