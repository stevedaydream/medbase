<script setup lang="ts">
/**
 * 食藥署藥品查詢
 *
 * ⚠️ data.gov.tw CKAN Datastore API 已於 2025 年停用。
 * 現僅提供外部連結導引，請至食藥署官網查詢或下載資料後以 Excel 匯入。
 */

import { openUrl } from "@tauri-apps/plugin-opener";

const emit = defineEmits<{ close: [] }>();

const LINKS = [
  {
    label: "食藥署 藥品許可證查詢",
    desc:  "官方網站線上查詢，支援中文名、成分、廠商搜尋",
    url:   "https://www.fda.gov.tw/mlms/H0001.aspx",
    icon:  "🔍",
  },
  {
    label: "政府開放資料 — 全藥品許可證（CSV/JSON）",
    desc:  "下載完整資料集後，至「健保匯入」功能用 Excel 匯入",
    url:   "https://data.gov.tw/en/datasets/9122",
    icon:  "📥",
  },
  {
    label: "健保用藥品項查詢（NHI）",
    desc:  "健保給付藥品查詢，可另行下載 Excel 再匯入",
    url:   "https://info.nhi.gov.tw/INAE3000/INAE3000S01",
    icon:  "💊",
  },
];

function openLink(url: string) {
  openUrl(url);
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('close')">
    <div class="w-full max-w-lg bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <div>
          <h2 class="text-white font-semibold">食藥署藥品查詢</h2>
          <p class="text-gray-500 text-xs mt-0.5">線上 API 已停用，請透過以下方式查詢</p>
        </div>
        <button @click="emit('close')" class="text-gray-500 hover:text-gray-300 text-xl leading-none cursor-pointer">×</button>
      </div>

      <!-- Notice -->
      <div class="mx-5 mt-4 px-4 py-3 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-300 text-xs leading-relaxed">
        ⚠️ 政府開放資料平台（data.gov.tw）食藥署西藥許可證的即時查詢 API 已停用，目前只提供整包 ZIP 下載。<br/>
        建議至官方網站查詢單筆資料，或下載 Excel 後使用「📥 健保匯入」功能批次新增。
      </div>

      <!-- Link list -->
      <div class="px-5 py-4 space-y-2">
        <button
          v-for="link in LINKS" :key="link.url"
          @click="openLink(link.url)"
          class="w-full flex items-start gap-3 px-4 py-3 rounded-xl border border-gray-800 hover:border-blue-700 hover:bg-gray-800/50 transition-colors text-left cursor-pointer group"
        >
          <span class="text-xl leading-none shrink-0 mt-0.5">{{ link.icon }}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm text-white group-hover:text-blue-300 transition-colors font-medium">{{ link.label }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ link.desc }}</p>
          </div>
          <span class="text-gray-600 group-hover:text-blue-400 transition-colors text-xs shrink-0 mt-0.5">↗</span>
        </button>
      </div>

      <!-- Footer -->
      <div class="px-5 pb-4 flex justify-end">
        <button @click="emit('close')" class="px-4 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 cursor-pointer">關閉</button>
      </div>
    </div>
  </div>
</template>
