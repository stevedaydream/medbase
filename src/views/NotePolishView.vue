<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";

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
  { id: "gemini-2.5-flash",               label: "2.5 Flash" },
  { id: "gemini-2.5-pro",                 label: "2.5 Pro" },
  { id: "gemini-2.5-flash-preview-04-17", label: "2.5 Flash (preview)" },
  { id: "gemini-2.0-flash",               label: "2.0 Flash" },
] as const;

const cloud = useCloudSettings();

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

// De-identification
const deidentify = ref(false);

function deidentifyText(text: string): string {
  let r = text;
  const name = patientName.value.trim();
  const pid  = patientId.value.trim();
  const bed  = bedNo.value.trim();
  if (name.length >= 2) r = r.replaceAll(name, "[姓名]");
  if (pid.length  >= 2) r = r.replaceAll(pid,  "[病歷號]");
  if (bed.length  >= 1) r = r.replaceAll(bed,  "[床號]");
  r = r.replace(/[A-Za-z][12]\d{8}/g, "[身分證]");
  r = r.replace(/\b09\d{8}\b/g, "[電話]");
  r = r.replace(/\b0\d[-\s]?\d{4}[-\s]?\d{4}\b/g, "[電話]");
  r = r.replace(/\d{2,3}[\/年]\d{1,2}[\/月]\d{1,2}日?/g, "[日期]");
  r = r.replace(/\d{4}[-\/]\d{2}[-\/]\d{2}/g, "[日期]");
  return r;
}

// ── Profile ─────────────────────────────────────────────────────────────
const profiles       = ref<string[]>(["default"]);
const activeProfile  = ref("default");
const addingProfile  = ref(false);
const newProfileName = ref("");

function displayProfile(p: string) {
  return p === "default" ? "預設" : p;
}

async function loadTemplatesForProfile(profile: string) {
  const db = await getDb();
  templates.value = await db.select<NoteTemplate[]>(
    "SELECT format_key, format_label, system_prompt, example FROM note_templates WHERE profile = ? ORDER BY rowid",
    [profile]
  );
}

async function switchProfile(profile: string) {
  activeProfile.value = profile;
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('active_profile', ?)",
    [profile]
  );
  await loadTemplatesForProfile(profile);
}

async function startAddProfile() {
  newProfileName.value = "";
  addingProfile.value  = true;
}

async function confirmAddProfile() {
  const name = newProfileName.value.trim();
  if (!name) { showToast("請輸入設定檔名稱"); return; }
  if (profiles.value.includes(name)) { showToast("設定檔名稱已存在"); return; }
  const db = await getDb();
  const source = await db.select<NoteTemplate[]>(
    "SELECT format_key, format_label, system_prompt, example FROM note_templates WHERE profile = 'default'"
  );
  for (const t of source) {
    await db.execute(
      "INSERT OR IGNORE INTO note_templates (format_key, profile, format_label, system_prompt, example) VALUES (?,?,?,?,?)",
      [t.format_key, name, t.format_label, t.system_prompt, t.example]
    );
  }
  profiles.value  = [...profiles.value, name];
  addingProfile.value = false;
  await switchProfile(name);
  showToast(`已建立設定檔「${name}」`);
}

async function deleteProfile(name: string) {
  if (name === "default") return;
  if (!confirm(`確定刪除設定檔「${name}」？此操作無法復原。`)) return;
  const db = await getDb();
  await db.execute("DELETE FROM note_templates WHERE profile = ?", [name]);
  profiles.value = profiles.value.filter(p => p !== name);
  if (activeProfile.value === name) await switchProfile("default");
  showToast(`已刪除設定檔「${name}」`);
}

// ── Template inline editor ──────────────────────────────────────────────
const templateEditorOpen = ref(false);
const editingPrompt      = ref("");
const editingExample     = ref("");
const savedPrompt        = ref("");
const savedExample       = ref("");
const templateSyncing    = ref(false);

const isDirty = computed(() =>
  editingPrompt.value !== savedPrompt.value ||
  editingExample.value !== savedExample.value
);

// ── History modal ────────────────────────────────────────────────────────
const historyOpen   = ref(false);
const records       = ref<NoteRecord[]>([]);
const historySearch = ref("");

// ── Toast ────────────────────────────────────────────────────────────────
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// ── Computed ─────────────────────────────────────────────────────────────
const activeTemplate = computed(
  () => templates.value.find(t => t.format_key === activeKey.value) ?? null
);

const filteredRecords = computed(() => {
  const q = historySearch.value.trim().toLowerCase();
  if (!q) return records.value;
  return records.value.filter(r =>
    r.patient_id.toLowerCase().includes(q)   ||
    r.patient_name.toLowerCase().includes(q) ||
    r.bed_no.toLowerCase().includes(q)       ||
    r.format_label.toLowerCase().includes(q)
  );
});

// ── Lifecycle ─────────────────────────────────────────────────────────────
onMounted(async () => {
  await cloud.load();
  const db = await getDb();

  const pRows = await db.select<{ profile: string }[]>(
    "SELECT DISTINCT profile FROM note_templates ORDER BY rowid"
  );
  if (pRows.length > 0) {
    profiles.value = pRows.map(r => r.profile);
    if (!profiles.value.includes("default")) profiles.value.unshift("default");
  }

  const settingRows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_model', 'active_profile')"
  );
  for (const r of settingRows) {
    if (r.key === "gemini_api_key") apiKey.value        = r.value;
    if (r.key === "gemini_model")   selectedModel.value = r.value;
    if (r.key === "active_profile" && profiles.value.includes(r.value)) {
      activeProfile.value = r.value;
    }
  }

  await loadTemplatesForProfile(activeProfile.value);
});

watch(activeTemplate, (tpl) => {
  if (tpl) {
    editingPrompt.value  = tpl.system_prompt;
    editingExample.value = tpl.example;
    savedPrompt.value    = tpl.system_prompt;
    savedExample.value   = tpl.example;
  }
}, { immediate: true });

// ── Helpers ───────────────────────────────────────────────────────────────
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

// ── Generate ───────────────────────────────────────────────────────────────
async function generate() {
  const tpl = activeTemplate.value;
  if (!tpl || !inputText.value.trim() || !apiKey.value) return;
  isGenerating.value = true;
  outputText.value   = "";

  try {
    const parts: string[] = [];
    if (deidentify.value) {
      parts.push("重要：輸出中不得包含任何可識別個人身份的資訊（姓名、病歷號、身分證字號、電話、地址等）。所有個人識別符請以 [姓名]、[病歷號]、[身分證]、[電話]、[日期] 等標記代替。");
      parts.push("");
    }
    if (editingPrompt.value.trim()) parts.push(editingPrompt.value.trim());
    if (editingExample.value.trim()) {
      parts.push("");
      parts.push("以下是範例輸出格式供參考：");
      parts.push("---");
      parts.push(editingExample.value.trim());
      parts.push("---");
    }
    parts.push("");
    parts.push("請將以下病歷草稿按上述格式整理：");
    parts.push("");
    const rawInput = inputText.value.trim();
    parts.push(deidentify.value ? deidentifyText(rawInput) : rawInput);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel.value}:generateContent?key=${apiKey.value}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: parts.join("\n") }] }],
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
    outputText.value = deidentify.value ? deidentifyText(text) : text;
  } catch (e) {
    showToast(`生成失敗：${(e as Error).message}`);
  } finally {
    isGenerating.value = false;
  }
}

// ── Model persistence ──────────────────────────────────────────────────────
async function onModelChange() {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gemini_model', ?)",
    [selectedModel.value]
  );
}

// ── Copy / Save record ─────────────────────────────────────────────────────
async function copyOutput() {
  await navigator.clipboard.writeText(outputText.value);
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 2000);
}

async function saveRecord() {
  if (!outputText.value.trim()) { showToast("尚無輸出結果可儲存"); return; }
  const tpl = activeTemplate.value;
  const db  = await getDb();
  await db.execute(
    `INSERT INTO note_records (patient_id, patient_name, bed_no, format_key, format_label, model, input_text, output_text)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      patientId.value.trim(), patientName.value.trim(), bedNo.value.trim(),
      tpl?.format_key ?? activeKey.value, tpl?.format_label ?? activeKey.value,
      selectedModel.value, inputText.value, outputText.value,
    ]
  );
  showToast("已儲存至歷史記錄");
}

// ── History ────────────────────────────────────────────────────────────────
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

// ── Template inline editor ─────────────────────────────────────────────────
async function saveTemplateEdits() {
  const tpl = activeTemplate.value;
  if (!tpl || !isDirty.value) return;
  const db = await getDb();
  await db.execute(
    "UPDATE note_templates SET system_prompt=?, example=? WHERE format_key=? AND profile=?",
    [editingPrompt.value, editingExample.value, tpl.format_key, activeProfile.value]
  );
  const idx = templates.value.findIndex(t => t.format_key === tpl.format_key);
  if (idx >= 0) {
    templates.value[idx] = {
      ...templates.value[idx],
      system_prompt: editingPrompt.value,
      example:       editingExample.value,
    };
  }
  savedPrompt.value  = editingPrompt.value;
  savedExample.value = editingExample.value;
  showToast("格式設定已儲存");
}

async function pushTemplatesToCloud() {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS URL"); return; }
  templateSyncing.value = true;
  try {
    const snapshot = templates.value.map(t => ({
      format_key:    t.format_key,
      format_label:  t.format_label,
      system_prompt: t.format_key === activeKey.value ? editingPrompt.value  : t.system_prompt,
      example:       t.format_key === activeKey.value ? editingExample.value : t.example,
    }));
    const payload = { profile: activeProfile.value, templates: snapshot };
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveConfig", key: "note_templates_json", value: JSON.stringify(payload) }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "備份失敗");
    showToast(`已備份設定檔「${displayProfile(activeProfile.value)}」至雲端`);
  } catch (e) {
    showToast(`備份失敗：${(e as Error).message}`);
  } finally {
    templateSyncing.value = false;
  }
}

// ── Chat ──────────────────────────────────────────────────────────────
const chatMode      = ref(false);
interface ChatMsg   { role: "user" | "model"; text: string }
const chatMessages  = ref<ChatMsg[]>([]);
const chatInput     = ref("");
const chatStreaming  = ref(false);
const streamingText = ref("");
const chatScrollRef = ref<HTMLElement | null>(null);

watch([chatMessages, streamingText], async () => {
  await nextTick();
  if (chatScrollRef.value) chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight;
}, { deep: true });

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || chatStreaming.value || !apiKey.value) return;
  chatMessages.value.push({ role: "user", text });
  chatInput.value = "";
  chatStreaming.value = true;
  streamingText.value = "";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel.value}:streamGenerateContent?key=${apiKey.value}&alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: chatMessages.value.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        }),
      }
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
      if (res.status === 429) throw new Error("請求頻率超限（429），請稍候後再試");
      throw new Error(errBody?.error?.message ?? `HTTP ${res.status}`);
    }
    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "", fullText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (chunkText) { fullText += chunkText; streamingText.value = fullText; }
        } catch { /* 略過非 JSON 行 */ }
      }
    }
    if (fullText) chatMessages.value.push({ role: "model", text: fullText });
  } catch (e) {
    showToast(`傳送失敗：${(e as Error).message}`);
  } finally {
    chatStreaming.value = false;
    streamingText.value = "";
  }
}

async function pullTemplatesFromCloud() {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS URL"); return; }
  templateSyncing.value = true;
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getConfig", key: "note_templates_json" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "拉取失敗");
    if (!json.value) { showToast("雲端尚無備份"); return; }

    const parsed = JSON.parse(json.value);
    // 新格式：{ profile, templates }；舊格式：直接是陣列
    const cloudProfile: string = Array.isArray(parsed) ? activeProfile.value : (parsed.profile ?? activeProfile.value);
    const cloudTpls: NoteTemplate[] = Array.isArray(parsed) ? parsed : parsed.templates;

    const db = await getDb();
    for (const ct of cloudTpls) {
      await db.execute(
        `INSERT OR REPLACE INTO note_templates (format_key, profile, format_label, system_prompt, example)
         VALUES (?, ?, ?, ?, ?)`,
        [ct.format_key, cloudProfile, ct.format_label, ct.system_prompt, ct.example]
      );
    }

    // 若 profile 不在本地清單，加入下拉選單
    if (!profiles.value.includes(cloudProfile)) {
      profiles.value = [...profiles.value, cloudProfile];
    }

    await switchProfile(cloudProfile);

    const cur = activeTemplate.value;
    if (cur) {
      editingPrompt.value  = cur.system_prompt;
      editingExample.value = cur.example;
      savedPrompt.value    = cur.system_prompt;
      savedExample.value   = cur.example;
    }
    showToast(`已從雲端載入 ${cloudTpls.length} 個格式 → 設定檔「${displayProfile(cloudProfile)}」`);
  } catch (e) {
    showToast(`載入失敗：${(e as Error).message}`);
  } finally {
    templateSyncing.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">

    <!-- ── 頂部格式 tab 列 ──────────────────────────────────────────── -->
    <div class="flex items-center gap-1.5 px-6 py-3 border-b border-white/5 bg-slate-950 shrink-0 overflow-x-auto no-scrollbar">
      <button
        v-for="t in templates" :key="t.format_key"
        @click="chatMode = false; activeKey = t.format_key"
        class="shrink-0 px-3.5 py-2 text-xs font-bold rounded-xl border transition-all whitespace-nowrap cursor-pointer"
        :class="activeKey === t.format_key && !chatMode
          ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200 shadow-[0_0_12px_rgba(99,102,241,0.08)]'
          : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'"
      >{{ t.format_label }}</button>

      <button
        @click="chatMode = true"
        class="shrink-0 px-3.5 py-2 text-xs font-bold rounded-xl border transition-all whitespace-nowrap cursor-pointer"
        :class="chatMode
          ? 'bg-violet-600/20 border-violet-500/40 text-violet-200 shadow-[0_0_12px_rgba(139,92,246,0.08)]'
          : 'bg-slate-900/40 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'"
      >💬 聊天</button>

      <div class="ml-auto shrink-0">
        <button
          @click="openHistory"
          class="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-xl border border-white/10
                 bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-all cursor-pointer font-bold"
        >📂 歷史記錄</button>
      </div>
    </div>

    <!-- ── 格式設定（內嵌編輯器）───────────────────────────────────── -->
    <div v-if="!chatMode" class="border-b border-white/5 shrink-0">

      <!-- Header -->
      <div class="flex items-center gap-2 px-6 py-2 bg-slate-950/30 flex-wrap">

        <!-- 折疊 toggle -->
        <button
          @click="templateEditorOpen = !templateEditorOpen"
          class="flex items-center gap-1.5 cursor-pointer group shrink-0"
        >
          <span class="text-slate-500 text-2xs inline-block transition-transform duration-200"
            :class="templateEditorOpen ? 'rotate-90' : ''">▶</span>
          <span class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono group-hover:text-slate-300 transition-colors">
            格式設定
          </span>
        </button>

        <span class="text-white/10 shrink-0 select-none">|</span>

        <!-- Profile 選擇器 -->
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-2xs text-slate-600 font-mono">設定檔:</span>

          <select
            :value="activeProfile"
            @change="switchProfile(($event.target as HTMLSelectElement).value)"
            class="text-2xs font-bold bg-slate-900 border border-white/10 rounded-lg px-2 py-1
                   text-slate-200 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
          >
            <option v-for="p in profiles" :key="p" :value="p">{{ displayProfile(p) }}</option>
          </select>

          <template v-if="addingProfile">
            <input
              v-model="newProfileName"
              placeholder="名稱（如：Steve）"
              @keydown.enter="confirmAddProfile"
              @keydown.esc="addingProfile = false"
              class="text-2xs w-36 px-2 py-1 bg-slate-900 border border-indigo-500/40 rounded-lg text-slate-200
                     placeholder:text-slate-600 focus:outline-none font-bold"
            />
            <button @click="confirmAddProfile"
              class="text-2xs font-bold px-2 py-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/40 transition-all cursor-pointer">
              確認
            </button>
            <button @click="addingProfile = false"
              class="text-2xs font-bold px-2 py-1 rounded-lg bg-slate-900/60 border border-white/10 text-slate-400 hover:text-slate-200 transition-all cursor-pointer">
              取消
            </button>
          </template>
          <template v-else>
            <button
              @click="startAddProfile"
              class="text-2xs font-bold px-2 py-1 rounded-lg border border-white/10 bg-slate-900/40 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/30 transition-all cursor-pointer"
              title="新增個人設定檔">＋</button>
            <button
              v-if="activeProfile !== 'default'"
              @click="deleteProfile(activeProfile)"
              class="text-2xs font-bold px-2 py-1 rounded-lg border border-white/10 bg-slate-900/40 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-all cursor-pointer"
              title="刪除此設定檔">🗑</button>
          </template>
        </div>

        <!-- 未儲存 badge -->
        <span v-if="isDirty"
          class="text-2xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full shrink-0">
          ● 未儲存
        </span>

        <!-- 右側操作 -->
        <div class="ml-auto flex items-center gap-1.5 shrink-0">
          <button
            @click="saveTemplateEdits" :disabled="!isDirty"
            class="text-2xs font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            :class="isDirty
              ? 'bg-indigo-600/20 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/40'
              : 'bg-slate-900 border-white/5 text-slate-500'"
          >💾 儲存設定</button>
          <button
            @click="pullTemplatesFromCloud" :disabled="templateSyncing"
            class="text-2xs font-bold px-2.5 py-1 rounded-lg border border-white/10 bg-slate-900/40 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/30 disabled:opacity-40 transition-all cursor-pointer"
            title="從雲端還原設定至目前設定檔"
          >{{ templateSyncing ? '…' : '↓' }} 載入雲端</button>
          <button
            @click="pushTemplatesToCloud" :disabled="templateSyncing"
            class="text-2xs font-bold px-2.5 py-1 rounded-lg border border-white/10 bg-slate-900/40 text-slate-400 hover:text-blue-300 hover:border-blue-500/30 disabled:opacity-40 transition-all cursor-pointer"
            title="將目前設定檔備份至雲端"
          >{{ templateSyncing ? '…' : '↑' }} 備份雲端</button>
        </div>
      </div>

      <!-- Expandable editor -->
      <Transition name="editor-slide">
        <div v-if="templateEditorOpen" class="px-6 pb-4 pt-2 grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-2xs font-black text-slate-500 uppercase tracking-wider font-mono">
              System Prompt <span class="normal-case font-normal text-slate-600">— AI 角色說明與整理準則</span>
            </label>
            <textarea
              v-model="editingPrompt" rows="5"
              placeholder="例如：你是資深住院醫師，請將以下草稿整理為標準出院摘要..."
              class="resize-y text-xs bg-slate-950/80 border border-white/10 rounded-xl text-slate-200
                     px-3.5 py-2.5 focus:outline-none focus:border-indigo-500/50 font-mono leading-relaxed
                     custom-scrollbar placeholder:text-slate-700 transition-colors"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-2xs font-black text-slate-500 uppercase tracking-wider font-mono">
              範例輸出樣板 <span class="normal-case font-normal text-slate-600">— 格式越具體效果越好</span>
            </label>
            <textarea
              v-model="editingExample" rows="5"
              placeholder="例如：&#10;Discharge Diagnosis:&#10;- ...&#10;&#10;Brief History:&#10;- ..."
              class="resize-y text-xs bg-slate-950/80 border border-white/10 rounded-xl text-slate-200
                     px-3.5 py-2.5 focus:outline-none focus:border-indigo-500/50 font-mono leading-relaxed
                     custom-scrollbar placeholder:text-slate-700 transition-colors"
            />
          </div>
        </div>
      </Transition>
    </div>

    <!-- ── 病人資訊列 ───────────────────────────────────────────────── -->
    <div v-if="!chatMode" class="flex items-center gap-4 px-6 py-2.5 border-b border-white/5 bg-slate-900/20 shrink-0">
      <span class="text-2xs text-slate-500 font-black uppercase tracking-widest font-mono shrink-0">病人資料:</span>
      <div class="flex items-center gap-2">
        <input v-model="patientId" placeholder="病歷號"
          class="w-32 text-xs px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-slate-200
                 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono font-bold" />
        <input v-model="patientName" placeholder="姓名"
          class="w-28 text-xs px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-slate-200
                 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-bold" />
        <input v-model="bedNo" placeholder="床號"
          class="w-24 text-xs px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-slate-200
                 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono font-bold" />
      </div>
    </div>

    <!-- ── 輸入區 ───────────────────────────────────────────────────── -->
    <div v-if="!chatMode" class="flex flex-col border-b border-white/5 overflow-hidden p-4 pb-2" style="flex: 1 1 0">
      <div class="flex items-center px-2 pb-2 shrink-0">
        <span class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono">病歷草稿</span>
        <button v-if="inputText" @click="inputText = ''"
          class="ml-auto text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
          清除內容
        </button>
      </div>
      <textarea
        v-model="inputText"
        placeholder="在此貼上病歷草稿（progress notes）…"
        class="flex-1 resize-none bg-slate-950/50 border border-white/5 focus:border-indigo-500/30 rounded-2xl p-4
               placeholder:text-slate-700 focus:outline-none font-mono text-xs leading-relaxed text-slate-200
               focus:shadow-[0_0_12px_rgba(99,102,241,0.08)] transition-all custom-scrollbar"
      />
    </div>

    <!-- ── 操作列 ───────────────────────────────────────────────────── -->
    <div v-if="!chatMode" class="flex items-center gap-3 px-6 py-3 bg-slate-950 border-b border-white/5 shrink-0 flex-wrap">
      <button
        @click="generate"
        :disabled="isGenerating || !inputText.trim() || !activeTemplate || !apiKey"
        :title="!apiKey ? '請先至設定頁填入 Gemini API Key' : ''"
        class="flex items-center gap-2 px-6 py-2.5 text-xs font-black rounded-xl bg-indigo-600 border border-indigo-500/30
               hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed
               hover:shadow-[0_0_15px_rgba(99,102,241,0.25)] transition-all cursor-pointer"
      >
        <span v-if="isGenerating" class="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        <span v-else>✦</span>
        {{ isGenerating ? "生成中…" : "開始 AI 整理" }}
      </button>

      <div class="relative">
        <select v-model="selectedModel" @change="onModelChange"
          class="text-xs pl-3 pr-8 py-2 bg-slate-900 border border-white/10 rounded-xl text-slate-300
                 focus:outline-none focus:border-indigo-500/50 cursor-pointer font-bold appearance-none">
          <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
        <span class="absolute right-3 top-2.5 text-2xs text-slate-500 pointer-events-none">▼</span>
      </div>

      <button
        @click="deidentify = !deidentify"
        class="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold rounded-xl border transition-all cursor-pointer"
        :class="deidentify
          ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.08)]'
          : 'bg-slate-900/40 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'"
      >🛡 去識別化</button>

      <span v-if="!apiKey" class="text-xs text-amber-400 font-bold flex items-center gap-1">
        <span>⚠️</span> 請先至設定頁填入 Gemini API Key
      </span>

      <div class="ml-auto flex items-center gap-2">
        <button @click="saveRecord" :disabled="!outputText.trim()"
          class="text-xs px-4 py-2.5 rounded-xl border font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer
                 bg-emerald-600/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15">
          💾 儲存歷史
        </button>
        <button v-if="outputText" @click="copyOutput"
          class="text-xs px-4 py-2.5 rounded-xl border font-bold transition-all cursor-pointer"
          :class="copied
            ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
            : 'bg-slate-900/40 border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'">
          {{ copied ? "✓ 已複製結果" : "📋 複製結果" }}
        </button>
      </div>
    </div>

    <!-- ── 輸出區 ───────────────────────────────────────────────────── -->
    <div v-if="!chatMode" class="flex flex-col p-4 pt-2 overflow-hidden" style="flex: 1 1 0">
      <div class="flex items-center px-2 pb-2 shrink-0">
        <span class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono">整理結果</span>
      </div>
      <div class="flex-1 overflow-y-auto bg-slate-950/50 border border-white/5 rounded-2xl px-5 py-4 custom-scrollbar">
        <pre v-if="outputText" class="text-xs text-slate-200 whitespace-pre-wrap font-mono leading-relaxed select-all">{{ outputText }}</pre>
        <div v-else class="flex items-center justify-center h-full text-slate-600 text-xs font-bold italic py-12">
          點擊「開始 AI 整理」後，結果將顯示於此
        </div>
      </div>
    </div>

    <!-- ── 聊天區 ────────────────────────────────────────────────────── -->
    <div v-if="chatMode" class="flex flex-col flex-1 min-h-0">

      <!-- 訊息列表 -->
      <div ref="chatScrollRef" class="flex-1 overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar">
        <div v-if="!chatMessages.length && !chatStreaming"
          class="flex items-center justify-center h-full text-slate-600 text-xs font-bold italic">
          開始對話，模型：{{ MODELS.find(m => m.id === selectedModel)?.label ?? selectedModel }}
        </div>

        <div v-for="(msg, i) in chatMessages" :key="i"
          class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
          <div class="max-w-[78%] rounded-2xl px-4 py-3 text-xs leading-relaxed"
            :class="msg.role === 'user'
              ? 'bg-indigo-600/20 border border-indigo-500/30 text-slate-200'
              : 'bg-slate-900/60 border border-white/[0.06] text-slate-200'">
            <pre class="whitespace-pre-wrap font-sans leading-relaxed">{{ msg.text }}</pre>
          </div>
        </div>

        <!-- Streaming bubble -->
        <div v-if="chatStreaming" class="flex justify-start">
          <div class="max-w-[78%] rounded-2xl px-4 py-3 text-xs bg-slate-900/60 border border-white/[0.06] text-slate-200">
            <pre v-if="streamingText" class="whitespace-pre-wrap font-sans leading-relaxed">{{ streamingText }}<span class="animate-pulse text-violet-400">▍</span></pre>
            <span v-else class="flex items-center gap-1.5 text-slate-500">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style="animation-delay:0ms"/>
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style="animation-delay:150ms"/>
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style="animation-delay:300ms"/>
            </span>
          </div>
        </div>
      </div>

      <!-- 輸入列 -->
      <div class="shrink-0 px-5 py-4 border-t border-white/5 bg-slate-950/40">
        <div v-if="!apiKey" class="mb-2 text-2xs text-amber-400 font-bold flex items-center gap-1">
          <span>⚠️</span> 請先至設定頁填入 Gemini API Key
        </div>
        <div class="flex gap-3 items-end">
          <textarea
            v-model="chatInput"
            @keydown.enter.exact.prevent="sendChat"
            placeholder="輸入訊息… (Enter 傳送，Shift+Enter 換行)"
            rows="3"
            :disabled="chatStreaming"
            class="flex-1 resize-none text-xs bg-slate-950/60 border border-white/10 rounded-2xl px-4 py-3
                   text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40
                   font-mono leading-relaxed custom-scrollbar disabled:opacity-50 transition-colors"
          />
          <div class="flex flex-col gap-2 shrink-0">
            <button @click="sendChat"
              :disabled="!chatInput.trim() || chatStreaming || !apiKey"
              class="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white
                     text-xs font-bold rounded-xl transition-all cursor-pointer whitespace-nowrap">
              {{ chatStreaming ? '…' : '傳送' }}
            </button>
            <button @click="chatMessages = []; streamingText = ''"
              :disabled="!chatMessages.length || chatStreaming"
              class="px-4 py-2 border border-white/10 text-slate-500 hover:text-slate-200
                     text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-30 whitespace-nowrap">
              清除
            </button>
          </div>
        </div>
        <!-- Model selector -->
        <div class="flex items-center gap-2 mt-2">
          <span class="text-2xs text-slate-600 font-mono">模型:</span>
          <div class="relative">
            <select v-model="selectedModel" @change="onModelChange"
              class="text-2xs pl-2.5 pr-7 py-1 bg-slate-900 border border-white/10 rounded-lg text-slate-400
                     focus:outline-none cursor-pointer appearance-none font-bold">
              <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <span class="absolute right-2 top-1.5 text-3xs text-slate-500 pointer-events-none">▼</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 歷史記錄 Modal ────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="historyOpen"
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
        @click.self="historyOpen = false">
        <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
          style="width: 760px; max-width: 92vw; max-height: 80vh">
          <div class="flex items-center gap-3 px-5 py-4 border-b border-white/5 bg-slate-950/30 shrink-0">
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-slate-200">歷史記錄</h3>
            <input v-model="historySearch" placeholder="搜尋病歷號、姓名、床號…"
              class="ml-4 flex-1 text-xs px-3.5 py-1.5 bg-slate-950/80 border border-white/10 rounded-xl
                     text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-bold" />
            <button @click="historyOpen = false"
              class="ml-2 text-slate-500 hover:text-white text-xl leading-none transition-colors cursor-pointer">×</button>
          </div>

          <div class="flex-1 overflow-y-auto custom-scrollbar">
            <div v-if="!filteredRecords.length" class="py-16 text-center text-slate-500 text-xs italic font-bold">
              {{ records.length ? '無符合搜尋條件的記錄' : '尚無儲存記錄' }}
            </div>
            <table v-else class="w-full text-xs border-collapse">
              <thead class="sticky top-0 bg-slate-900 z-10 border-b border-white/5">
                <tr class="text-slate-400 text-2xs font-black uppercase tracking-widest font-mono">
                  <th class="text-left px-5 py-3.5 font-bold">時間</th>
                  <th class="text-left px-4 py-3.5 font-bold">病歷號</th>
                  <th class="text-left px-4 py-3.5 font-bold">姓名</th>
                  <th class="text-left px-4 py-3.5 font-bold">床號</th>
                  <th class="text-left px-4 py-3.5 font-bold">格式</th>
                  <th class="w-12 px-4 py-3.5"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filteredRecords" :key="r.id"
                  class="border-b border-white/[0.02] hover:bg-white/[0.02] cursor-pointer transition-colors group"
                  @click="loadRecord(r)">
                  <td class="px-5 py-3 text-slate-500 whitespace-nowrap font-mono">{{ r.created_at.slice(0, 16) }}</td>
                  <td class="px-4 py-3 text-slate-300 font-mono font-bold">{{ r.patient_id || '—' }}</td>
                  <td class="px-4 py-3 text-slate-300 font-bold">{{ r.patient_name || '—' }}</td>
                  <td class="px-4 py-3 text-slate-400 font-mono font-bold">{{ r.bed_no || '—' }}</td>
                  <td class="px-4 py-3">
                    <span class="text-2xs font-bold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">
                      {{ r.format_label }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button @click.stop="deleteRecord(r.id)"
                      class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition-opacity px-1 text-sm cursor-pointer"
                      title="刪除">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-5 py-3 border-t border-white/5 bg-slate-950/20 shrink-0 text-2xs font-bold font-mono text-slate-500">
            共 {{ records.length }} 筆記錄，點擊列表可載入
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-slate-900 border border-white/15 text-slate-200 text-xs font-bold
               rounded-xl shadow-2xl z-[9999] pointer-events-none">
        {{ toast }}
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

.editor-slide-enter-active,
.editor-slide-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.editor-slide-enter-from,
.editor-slide-leave-to { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }
.editor-slide-enter-to,
.editor-slide-leave-from { max-height: 600px; opacity: 1; }

.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

.custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 2px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
</style>
