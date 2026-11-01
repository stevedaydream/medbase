<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, toRefs } from "vue";
import { getDb, dbWrite } from "@/db";
import { AUTO_MODEL, MODEL_CACHE_MS, fetchModels, modelOptions, validModel, type GeminiModel, type ModelCache } from "@/shared/geminiModels";
import DocxComposer from "@/components/DocxComposer.vue";
import { notePolishMode as mode, chatDraft } from "@/composables/useDocxDraft";

const apiKey = ref("");
const selectedModel = ref(AUTO_MODEL);
const modelList = ref<GeminiModel[]>([]);
const modelLoading = ref(false);
const MODELS = computed(() => modelOptions(modelList.value, selectedModel.value));
const tabs = [
  { key: "chat", label: "聊天", icon: "💬" },
  { key: "case", label: "病例討論", icon: "📋" },
  { key: "leave", label: "公假心得", icon: "📝" },
] as const;
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 3500);
}
onUnmounted(() => clearTimeout(toastTimer));
onMounted(async () => {
  try {
    const db = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_model')"
    );
    for (const row of rows) {
      if (row.key === "gemini_api_key") apiKey.value = row.value;
      if (row.key === "gemini_model") selectedModel.value = row.value;
    }
    await loadModels();
  } catch (e) { showToast(`載入 AI 設定失敗：${(e as Error).message}`); }
});
async function onModelChange() {
  try {
    await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gemini_model', ?)", [selectedModel.value]);
  } catch (e) { showToast(`儲存模型設定失敗：${(e as Error).message}`); }
}
const { chatMessages, chatInput, chatStreaming, streamingText } = toRefs(chatDraft);
const chatScrollRef = ref<HTMLElement | null>(null);
async function loadModels(force = false) {
  if (modelLoading.value) return;
  modelLoading.value = true;
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key = 'gemini_models_cache'");
    let cache: ModelCache | null = null;
    try { cache = rows[0] ? JSON.parse(rows[0].value) : null; } catch { cache = null; }
    if (cache) modelList.value = cache.list;
    if (!force && cache && Date.now() - cache.at < MODEL_CACHE_MS) return checkModel();
    if (!apiKey.value) return;
    modelList.value = await fetchModels(apiKey.value);
    await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gemini_models_cache', ?)",
      [JSON.stringify({ at: Date.now(), list: modelList.value })]);
    if (force) showToast(`已更新模型清單（${modelList.value.length} 個）`);
    await checkModel();
  } catch (e) {
    if (force) showToast(`取得模型清單失敗：${(e as Error).message}`);
  } finally {
    modelLoading.value = false;
  }
}

/** 原本選的模型已下架：改回自動 */
async function checkModel() {
  const v = validModel(modelList.value, selectedModel.value);
  if (v === selectedModel.value) return;
  showToast(`模型 ${selectedModel.value} 已無法使用，改用自動（最新 Flash）`);
  selectedModel.value = v;
  await onModelChange();
}
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

</script>

<template>
  <div class="accent-cyan flex flex-col h-full overflow-hidden bg-sunken text-fg">
    <div class="flex flex-wrap items-center gap-4 px-6 py-4 border-b border-hairline shrink-0">
      <div class="mr-auto">
        <h2 class="text-base font-bold">AI 行政助手</h2>
        <p class="mt-1 text-xs text-muted">聊天、整理病例與撰寫進修心得</p>
      </div>
      <div class="flex gap-1 rounded-xl bg-surface p-1" role="tablist" aria-label="AI 行政助手功能">
        <button v-for="tab in tabs" :key="tab.key" @click="mode = tab.key"
          role="tab" :aria-selected="mode === tab.key"
          class="px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer"
          :class="mode === tab.key ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg'">
          {{ tab.icon }} {{ tab.label }}
        </button>
      </div>
    </div>
    <DocxComposer
      v-if="mode === 'case' || mode === 'leave'"
      :key="mode"
      :template="mode"
      :api-key="apiKey"
      :model="selectedModel"
      :models="MODELS"
      :model-loading="modelLoading"
      @update:model="selectedModel = $event; onModelChange()"
      @refresh-models="loadModels(true)"
      @toast="showToast"
    />

    <!-- ── 聊天區 ────────────────────────────────────────────────────── -->
    <div v-if="mode === 'chat'" class="flex flex-col flex-1 min-h-0">

      <!-- 訊息列表 -->
      <div ref="chatScrollRef" class="flex-1 overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar">
        <div v-if="!chatMessages.length && !chatStreaming"
          class="flex items-center justify-center h-full text-muted text-xs font-bold italic">
          開始對話，模型：{{ MODELS.find(m => m.id === selectedModel)?.label ?? selectedModel }}
        </div>

        <div v-for="(msg, i) in chatMessages" :key="i"
          class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
          <div class="max-w-[78%] rounded-2xl px-4 py-3 text-xs leading-relaxed"
            :class="msg.role === 'user'
              ? 'bg-accent/20 border border-accent/30 text-fg'
              : 'bg-surface border border-hairline text-fg'">
            <pre class="whitespace-pre-wrap font-sans leading-relaxed">{{ msg.text }}</pre>
          </div>
        </div>

        <!-- Streaming bubble -->
        <div v-if="chatStreaming" class="flex justify-start">
          <div class="max-w-[78%] rounded-2xl px-4 py-3 text-xs bg-surface border border-hairline text-fg">
            <pre v-if="streamingText" class="whitespace-pre-wrap font-sans leading-relaxed">{{ streamingText }}<span class="animate-pulse text-accent">▍</span></pre>
            <span v-else class="flex items-center gap-1.5 text-muted">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style="animation-delay:0ms"/>
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style="animation-delay:150ms"/>
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style="animation-delay:300ms"/>
            </span>
          </div>
        </div>
      </div>

      <!-- 輸入列 -->
      <div class="shrink-0 px-5 py-4 border-t border-hairline bg-sunken">
        <div v-if="!apiKey" class="mb-2 text-xs text-warning font-bold flex items-center gap-1">
          <span>⚠️</span> 請先至設定頁填入 Gemini API Key
        </div>
        <div class="flex gap-3 items-end">
          <textarea
            v-model="chatInput"
            @keydown.enter.exact.prevent="sendChat"
            placeholder="輸入訊息… (Enter 傳送，Shift+Enter 換行)"
            rows="3"
            :disabled="chatStreaming"
            class="flex-1 resize-none text-xs bg-sunken border border-hairline rounded-2xl px-4 py-3
                   text-fg placeholder:text-muted focus:outline-none focus:border-accent/40
                   font-mono leading-relaxed custom-scrollbar disabled:opacity-50 transition-colors"
          />
          <div class="flex flex-col gap-2 shrink-0">
            <button @click="sendChat"
              :disabled="!chatInput.trim() || chatStreaming || !apiKey"
              class="px-4 py-2 bg-accent hover:bg-accent disabled:opacity-40 text-white
                     text-xs font-bold rounded-xl transition-all cursor-pointer whitespace-nowrap">
              {{ chatStreaming ? '…' : '傳送' }}
            </button>
            <button @click="chatMessages = []; streamingText = ''"
              :disabled="!chatMessages.length || chatStreaming"
              class="px-4 py-2 border border-hairline text-muted hover:text-fg
                     text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-30 whitespace-nowrap">
              清除
            </button>
          </div>
        </div>
        <!-- Model selector -->
        <div class="flex items-center gap-2 mt-2">
          <span class="text-xs text-muted">模型:</span>
          <div class="relative">
            <select v-model="selectedModel" @change="onModelChange"
              class="text-xs pl-2.5 pr-7 py-1 bg-surface border border-hairline rounded-lg text-fg-secondary
                     focus:outline-none cursor-pointer appearance-none font-bold">
              <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
            <span class="absolute right-2 top-1.5 text-2xs text-muted pointer-events-none">▼</span>
          </div>
          <button class="text-xs text-muted hover:text-fg disabled:opacity-40 cursor-pointer" :disabled="modelLoading"
            title="向 Gemini 重新查詢可用模型" @click="loadModels(true)">{{ modelLoading ? "…" : "↻" }}</button>
        </div>
      </div>
    </div>

    <div v-if="toast" role="status" class="fixed bottom-4 right-4 z-50 max-w-md px-4 py-2 bg-surface text-fg text-sm rounded-lg shadow-lg border border-hairline">{{ toast }}</div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }
</style>
