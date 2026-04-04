<script setup lang="ts">
/**
 * 食藥署 / 政府開放資料藥品查詢
 *
 * 使用 data.gov.tw 開放資料 API
 * 資料集：「西藥、醫療器材及化粧品許可證查詢」
 * 資源ID：e3a4a075-d445-4fcd-9764-fdae1e8b614a（食藥署藥品許可證清單）
 *
 * API 文件：https://data.gov.tw/dataset/detail?id=licensedDrugs
 * 格式：GET /api/v2/rest/datastore/{resource_id}?q={keyword}&limit=20
 */

import { ref } from "vue";

interface DrugResult {
  許可證字號?: string;
  中文品名?: string;
  英文品名?: string;
  申請商名稱?: string;
  製造廠名稱?: string;
  劑型?: string;
  有效成分?: string;
  用法用量?: string;
  適應症?: string;
  許可證效期?: string;
  [key: string]: string | undefined;
}

// 政府開放資料平台 — 食藥署西藥許可證 (請至 data.gov.tw 確認最新 resource_id)
const RESOURCE_ID = "e3a4a075-d445-4fcd-9764-fdae1e8b614a";
const API_BASE = "https://data.gov.tw/api/v2/rest/datastore";

const emit = defineEmits<{
  select: [drug: DrugResult];
  close: [];
}>();

const query = ref("");
const results = ref<DrugResult[]>([]);
const loading = ref(false);
const error = ref("");
const searched = ref(false);

async function search() {
  if (!query.value.trim()) return;
  loading.value = true;
  error.value = "";
  results.value = [];
  searched.value = true;

  try {
    const url = `${API_BASE}/${RESOURCE_ID}?q=${encodeURIComponent(query.value)}&limit=30`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    results.value = json?.result?.records ?? [];
  } catch (e) {
    error.value = `查詢失敗：${(e as Error).message}。請確認網路連線，或至 data.gov.tw 確認 API 是否變更。`;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('close')">
    <div class="w-full max-w-2xl bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl flex flex-col max-h-[80vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
        <div>
          <h2 class="text-white font-semibold">食藥署藥品線上查詢</h2>
          <p class="text-gray-500 text-xs mt-0.5">資料來源：政府開放資料平台 data.gov.tw — 西藥許可證</p>
        </div>
        <button @click="emit('close')" class="text-gray-500 hover:text-gray-300 cursor-pointer text-xl leading-none">×</button>
      </div>

      <!-- Search bar -->
      <div class="px-5 py-3 border-b border-gray-800 shrink-0">
        <form @submit.prevent="search" class="flex gap-2">
          <input
            v-model="query"
            placeholder="輸入藥品中文名、學名、成分…"
            class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button type="submit" :disabled="loading" class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 disabled:opacity-50 cursor-pointer">
            {{ loading ? "查詢中…" : "搜尋" }}
          </button>
        </form>
      </div>

      <!-- Results -->
      <div class="flex-1 overflow-y-auto p-3">
        <!-- Error -->
        <div v-if="error" class="p-4 rounded-lg bg-red-950/50 border border-red-900 text-red-300 text-sm">
          {{ error }}
        </div>

        <!-- Loading -->
        <div v-else-if="loading" class="text-center text-gray-500 py-10">查詢中…</div>

        <!-- Empty -->
        <div v-else-if="searched && results.length === 0" class="text-center text-gray-500 py-10 text-sm">
          無符合結果，請嘗試其他關鍵字
        </div>

        <!-- No search yet -->
        <div v-else-if="!searched" class="text-center text-gray-600 py-10 text-sm">
          輸入藥品名稱開始查詢
        </div>

        <!-- Result list -->
        <div v-else class="space-y-2">
          <div
            v-for="(drug, i) in results"
            :key="i"
            class="p-3 rounded-xl border border-gray-800 hover:border-blue-700 hover:bg-gray-800/50 transition-colors cursor-pointer"
            @click="emit('select', drug)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <p class="text-white font-medium text-sm truncate">{{ drug['中文品名'] || '—' }}</p>
                <p class="text-gray-400 text-xs mt-0.5 truncate">{{ drug['英文品名'] || drug['有效成分'] }}</p>
              </div>
              <div class="flex flex-col items-end shrink-0 gap-1">
                <span class="px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 text-xs">{{ drug['劑型'] || '—' }}</span>
                <span class="text-gray-600 text-xs font-mono">{{ drug['許可證字號'] }}</span>
              </div>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              <span v-if="drug['有效成分']" class="text-gray-500 text-xs">成分：{{ drug['有效成分'] }}</span>
              <span v-if="drug['申請商名稱']" class="text-gray-500 text-xs">申請商：{{ drug['申請商名稱'] }}</span>
            </div>
            <p v-if="drug['適應症']" class="text-gray-600 text-xs mt-1 line-clamp-2">{{ drug['適應症'] }}</p>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-gray-800 shrink-0 flex items-center justify-between">
        <p class="text-gray-600 text-xs">點擊藥品可帶入新增表單</p>
        <button @click="emit('close')" class="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs hover:bg-gray-700 cursor-pointer">關閉</button>
      </div>
    </div>
  </div>
</template>
