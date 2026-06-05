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
  <div class="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">

    <!-- ── 頂部格式 tab 列 ──────────────────────────────────────────── -->
    <div class="flex items-center gap-1.5 px-6 py-3 border-b border-white/5 bg-slate-950 shrink-0 overflow-x-auto custom-scrollbar">
      <button
        v-for="t in templates" :key="t.format_key"
        @click="activeKey = t.format_key"
        class="shrink-0 px-3.5 py-2 text-xs font-bold rounded-xl border transition-all whitespace-nowrap cursor-pointer"
        :class="activeKey === t.format_key
          ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200 shadow-[0_0_12px_rgba(99,102,241,0.08)]'
          : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'"
      >
        {{ t.format_label }}
      </button>

      <div class="ml-auto flex items-center gap-2 shrink-0">
        <button
          @click="openHistory"
          class="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-xl border border-white/10
                 bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-all cursor-pointer font-bold"
        >
          📂 歷史記錄
        </button>
        <button
          @click="openEdit"
          :disabled="!activeTemplate"
          class="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-xl border border-white/10
                 bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer font-bold"
        >
          ⚙ 編輯範例
        </button>
      </div>
    </div>

    <!-- ── 病人資訊列 ───────────────────────────────────────────────── -->
    <div class="flex items-center gap-4 px-6 py-2.5 border-b border-white/5 bg-slate-900/20 shrink-0">
      <span class="text-[10px] text-slate-500 font-black uppercase tracking-widest font-mono shrink-0">病人資料:</span>
      <div class="flex items-center gap-2">
        <input
          v-model="patientId"
          placeholder="病歷號"
          class="w-32 text-xs px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-slate-200
                 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono font-bold"
        />
        <input
          v-model="patientName"
          placeholder="姓名"
          class="w-28 text-xs px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-slate-200
                 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-bold"
        />
        <input
          v-model="bedNo"
          placeholder="床號"
          class="w-24 text-xs px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-slate-200
                 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono font-bold"
        />
      </div>
    </div>

    <!-- ── 輸入區 ───────────────────────────────────────────────────── -->
    <div class="flex flex-col border-b border-white/5 overflow-hidden p-4 pb-2" style="flex: 1 1 0">
      <div class="flex items-center px-2 pb-2 shrink-0">
        <span class="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">病歷草稿</span>
        <button
          v-if="inputText"
          @click="inputText = ''"
          class="ml-auto text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >清除內容</button>
      </div>
      <textarea
        v-model="inputText"
        placeholder="在此貼上病歷草稿（progress notes）…"
        class="flex-1 resize-none bg-slate-950/50 border border-white/5 focus:border-indigo-500/30 rounded-2xl p-4
               placeholder:text-slate-700 focus:outline-none font-mono text-xs leading-relaxed text-slate-200 focus:shadow-[0_0_12px_rgba(99,102,241,0.08)] transition-all custom-scrollbar"
      />
    </div>

    <!-- ── 操作列 ───────────────────────────────────────────────────── -->
    <div class="flex items-center gap-3 px-6 py-3 bg-slate-950 border-b border-white/5 shrink-0 flex-wrap">
      <button
        @click="generate"
        :disabled="isGenerating || !inputText.trim() || !activeTemplate || !apiKey"
        :title="!apiKey ? '請先至設定頁填入 Gemini API Key' : ''"
        class="flex items-center gap-2 px-6 py-2.5 text-xs font-black rounded-xl
               bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_15px_rgba(99,102,241,0.25)] transition-all cursor-pointer"
      >
        <span v-if="isGenerating"
          class="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
        />
        <span v-else>✦</span>
        {{ isGenerating ? "生成中…" : "開始 AI 整理" }}
      </button>

      <div class="relative">
        <select
          v-model="selectedModel"
          @change="onModelChange"
          class="text-xs pl-3 pr-8 py-2 bg-slate-900 border border-white/10 rounded-xl text-slate-300
                 focus:outline-none focus:border-indigo-500/50 cursor-pointer font-bold appearance-none"
        >
          <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
        <span class="absolute right-3 top-2.5 text-[10px] text-slate-500 pointer-events-none">▼</span>
      </div>

      <span v-if="!apiKey" class="text-xs text-amber-400 font-bold flex items-center gap-1">
        <span>⚠️</span> 請先至設定頁填入 Gemini API Key
      </span>

      <div class="ml-auto flex items-center gap-2">
        <button
          @click="saveRecord"
          :disabled="!outputText.trim()"
          class="text-xs px-4 py-2.5 rounded-xl border font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer
                 bg-emerald-600/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15"
        >
          💾 儲存歷史
        </button>
        <button
          v-if="outputText"
          @click="copyOutput"
          class="text-xs px-4 py-2.5 rounded-xl border font-bold transition-all cursor-pointer"
          :class="copied
            ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
            : 'bg-slate-900/40 border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'"
        >
          {{ copied ? "✓ 已複製結果" : "📋 複製結果" }}
        </button>
      </div>
    </div>

    <!-- ── 輸出區 ───────────────────────────────────────────────────── -->
    <div class="flex flex-col p-4 pt-2 overflow-hidden" style="flex: 1 1 0">
      <div class="flex items-center px-2 pb-2 shrink-0">
        <span class="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">整理結果</span>
      </div>
      <div class="flex-1 overflow-y-auto bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-4 custom-scrollbar">
        <pre v-if="outputText"
          class="text-xs text-slate-200 whitespace-pre-wrap font-mono leading-relaxed select-all"
        >{{ outputText }}</pre>
        <div v-else class="flex items-center justify-center h-full text-slate-600 text-xs font-bold italic py-12">
          點擊「開始 AI 整理」後，結果將顯示於此
        </div>
      </div>
    </div>

    <!-- ── 歷史記錄 Modal ────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="historyOpen"
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
        @click.self="historyOpen = false"
      >
        <div
          class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
          style="width: 760px; max-width: 92vw; max-height: 80vh"
        >
          <!-- Modal Header -->
          <div class="flex items-center gap-3 px-5 py-4 border-b border-white/5 bg-slate-950/30 shrink-0">
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-slate-200">歷史記錄</h3>
            <input
              v-model="historySearch"
              placeholder="搜尋病歷號、姓名、床號…"
              class="ml-4 flex-1 text-xs px-3.5 py-1.5 bg-slate-950/80 border border-white/10 rounded-xl
                     text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-bold"
            />
            <button
              @click="historyOpen = false"
              class="ml-2 text-slate-500 hover:text-white text-xl leading-none transition-colors cursor-pointer"
            >×</button>
          </div>

          <!-- Modal Body -->
          <div class="flex-1 overflow-y-auto custom-scrollbar">
            <div v-if="!filteredRecords.length"
              class="py-16 text-center text-slate-500 text-xs italic font-bold">
              {{ records.length ? '無符合搜尋條件的記錄' : '尚無儲存記錄' }}
            </div>

            <table v-else class="w-full text-xs border-collapse">
              <thead class="sticky top-0 bg-slate-900 z-10 border-b border-white/5">
                <tr class="text-slate-400 text-[10px] font-black uppercase tracking-widest font-mono">
                  <th class="text-left px-5 py-3.5 font-bold">時間</th>
                  <th class="text-left px-4 py-3.5 font-bold">病歷號</th>
                  <th class="text-left px-4 py-3.5 font-bold">姓名</th>
                  <th class="text-left px-4 py-3.5 font-bold">床號</th>
                  <th class="text-left px-4 py-3.5 font-bold">格式</th>
                  <th class="w-12 px-4 py-3.5"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in filteredRecords" :key="r.id"
                  class="border-b border-white/[0.02] hover:bg-white/[0.02] cursor-pointer transition-colors group"
                  @click="loadRecord(r)"
                >
                  <td class="px-5 py-3 text-slate-500 whitespace-nowrap font-mono">
                    {{ r.created_at.slice(0, 16) }}
                  </td>
                  <td class="px-4 py-3 text-slate-300 font-mono font-bold">{{ r.patient_id || '—' }}</td>
                  <td class="px-4 py-3 text-slate-300 font-bold">{{ r.patient_name || '—' }}</td>
                  <td class="px-4 py-3 text-slate-400 font-mono font-bold">{{ r.bed_no || '—' }}</td>
                  <td class="px-4 py-3">
                    <span class="text-[10px] font-bold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">
                      {{ r.format_label }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      @click.stop="deleteRecord(r.id)"
                      class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition-opacity px-1 text-sm cursor-pointer"
                      title="刪除"
                    >✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal Footer -->
          <div class="px-5 py-3 border-t border-white/5 bg-slate-950/20 shrink-0 text-[10px] font-bold font-mono text-slate-500">
            共 {{ records.length }} 筆記錄，點擊列表可載入
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 編輯範例 Modal ────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="editOpen"
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
        @click.self="editOpen = false"
      >
        <div
          class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-[680px] max-w-[90vw] flex flex-col overflow-hidden text-slate-100"
          style="max-height: 85vh"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-slate-950/30 shrink-0">
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-slate-200">
              編輯範例 — {{ activeTemplate?.format_label }}
            </h3>
            <button
              @click="editOpen = false"
              class="text-slate-500 hover:text-white text-xl leading-none transition-colors cursor-pointer"
            >×</button>
          </div>

          <!-- Body -->
          <div class="flex flex-col flex-1 min-h-0 px-5 py-4 gap-4 overflow-hidden bg-slate-950/10">
            <div class="flex flex-col gap-1.5 shrink-0">
              <label class="text-[10px] font-black text-slate-500 uppercase tracking-wider font-mono">
                System Prompt（AI 角色說明與整理準則）
              </label>
              <textarea
                v-model="editSystemPrompt"
                rows="4"
                placeholder="例如：你是資深住院醫師，請將以下草稿整理為標準出院摘要..."
                class="resize-none text-xs bg-slate-950/80 border border-white/10 rounded-xl
                       text-slate-200 px-3.5 py-2.5 focus:outline-none focus:border-indigo-500/50 font-mono leading-relaxed focus:shadow-[0_0_10px_rgba(99,102,241,0.06)]"
              />
            </div>
            <div class="flex flex-col gap-1.5 flex-1 min-h-0">
              <label class="text-[10px] font-black text-slate-500 uppercase tracking-wider font-mono">
                範例輸出樣板（提供給 AI 的 Output Template，格式越具體效果越好）
              </label>
              <textarea
                v-model="editExample"
                placeholder="例如：&#10;Discharge Diagnosis:&#10;- ...&#10;&#10;Brief History:&#10;- ..."
                class="flex-1 resize-none text-xs bg-slate-950/80 border border-white/10 rounded-xl
                       text-slate-200 px-3.5 py-2.5 focus:outline-none focus:border-indigo-500/50 font-mono leading-relaxed focus:shadow-[0_0_10px_rgba(99,102,241,0.06)] custom-scrollbar"
              />
            </div>
          </div>

          <!-- Footer -->
          <div class="flex justify-end gap-2.5 px-5 py-4 border-t border-white/5 bg-slate-950/20 shrink-0">
            <button
              @click="editOpen = false"
              class="px-4 py-2 text-xs font-bold bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
            >取消</button>
            <button
              @click="saveEdit"
              class="px-5 py-2 text-xs font-black bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 text-white rounded-xl transition-all cursor-pointer"
            >儲存修改</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Transition name="toast">
      <div
        v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-slate-900 border border-white/15 text-slate-200 text-xs font-bold
               rounded-xl shadow-2xl z-[9999] pointer-events-none"
      >
        {{ toast }}
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
