<script setup lang="ts">
import { ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { session, logout } from '../lib/session'
import { data, refresh, pullRefresh, lastFetched, TABLES, TABLE_LABELS } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { themeMode, applyTheme, fmtTime, toast, type ThemeMode } from '../lib/ui'
import { geminiKey, saveGeminiKey } from '../lib/gemini'

const version = __APP_VERSION__

const keyDraft = ref(geminiKey.value)
const showKey = ref(false)
function saveKey() {
  saveGeminiKey(keyDraft.value.trim())
  toast(keyDraft.value.trim() ? '已儲存 Gemini 金鑰' : '已清除 Gemini 金鑰')
}

async function doRefresh() {
  await refresh({ force: true })
  toast(data.error ? `更新失敗：${data.error}` : data.offline ? '目前離線，無法更新' : '資料已更新')
}

// 設定頁下拉＝全部重新下載
usePullRefresh(() => pullRefresh())

const confirmLogout = ref(false)
const THEMES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: '跟隨系統' }, { key: 'light', label: '淺色' }, { key: 'dark', label: '深色' },
]
</script>

<template>
  <div class="accent-indigo pad-tabbar">
    <PageHeader title="設定" back />
    <div class="p-4 space-y-4">

      <!-- 登入者 -->
      <section class="p-4 rounded-2xl bg-surface border border-hairline">
        <p class="text-xs font-bold text-muted mb-1">目前登入</p>
        <p class="text-lg font-bold text-fg">{{ session.user?.name }}</p>
        <p class="text-sm text-muted font-mono">HIS {{ session.user?.his }}</p>
        <p class="text-xs text-muted mt-1">{{ session.user?.staffCode ? `排班代號 ${session.user.staffCode}` : '不在排班名單中' }}</p>
        <button v-if="!confirmLogout" @click="confirmLogout = true" class="mt-3 w-full h-11 rounded-xl border border-danger/40 text-danger font-bold">登出</button>
        <div v-else class="mt-3 space-y-2">
          <p class="text-sm text-fg-secondary">登出會清除這支手機上的所有快取資料（Gemini 金鑰保留）。</p>
          <div class="flex gap-2">
            <button @click="confirmLogout = false" class="flex-1 h-11 rounded-xl bg-sunken border border-hairline font-bold">取消</button>
            <button @click="logout()" class="flex-1 h-11 rounded-xl bg-danger text-white font-bold">確定登出</button>
          </div>
        </div>
      </section>

      <!-- 資料更新 -->
      <section class="p-4 rounded-2xl bg-surface border border-hairline">
        <div class="flex items-center justify-between mb-2">
          <p class="font-bold text-fg">資料</p>
          <button @click="doRefresh" :disabled="data.refreshing" class="h-9 px-4 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40">
            {{ data.refreshing ? '更新中…' : '立即更新' }}
          </button>
        </div>
        <p v-if="data.offline" class="text-xs text-warning mb-2">目前離線，顯示的是手機上的資料</p>
        <ul class="text-sm divide-y divide-hairline">
          <li v-for="t in [...TABLES, 'npDuty' as const]" :key="t" class="flex justify-between py-1.5">
            <span class="text-fg-secondary">{{ TABLE_LABELS[t] }}</span>
            <span class="text-muted tabular-nums">{{ fmtTime(lastFetched(t)) }}</span>
          </li>
        </ul>
      </section>

      <!-- Gemini 金鑰 -->
      <section class="p-4 rounded-2xl bg-surface border border-hairline space-y-3">
        <p class="font-bold text-fg">Gemini API 金鑰</p>
        <p class="text-sm text-fg-secondary">病例討論、公假心得用 Google Gemini 整理內容。金鑰只存在這支手機，由手機直接呼叫 Gemini，不經過 MedBase 伺服器。</p>
        <div class="flex gap-2">
          <input v-model="keyDraft" :type="showKey ? 'text' : 'password'" placeholder="AIza…" autocomplete="off"
            class="flex-1 min-w-0 h-11 px-3 rounded-xl bg-sunken border border-hairline font-mono text-sm outline-none focus:border-accent/60" />
          <button @click="showKey = !showKey" class="h-11 px-3 rounded-xl bg-sunken border border-hairline text-sm">{{ showKey ? '隱藏' : '顯示' }}</button>
        </div>
        <button @click="saveKey" class="w-full h-11 rounded-xl bg-accent text-white font-bold">儲存金鑰</button>
        <details class="rounded-xl bg-sunken border border-hairline">
          <summary class="px-3 py-2.5 text-sm font-bold text-accent">如何申請 Gemini 金鑰（免費）</summary>
          <ol class="px-4 pb-3 space-y-2 text-sm text-fg-secondary list-decimal list-inside leading-relaxed">
            <li>用 Google 帳號開啟
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" class="text-accent underline">Google AI Studio 金鑰頁</a>。</li>
            <li>第一次使用會出現服務條款，勾選同意後按「繼續」。</li>
            <li>按「建立 API 金鑰」（Create API key）。</li>
            <li>若詢問專案，選「在新專案中建立」（Create API key in new project）。</li>
            <li>畫面出現一串以 <span class="font-mono">AIza</span> 開頭的金鑰，按「複製」。</li>
            <li>回到這裡貼到上方欄位，按「儲存金鑰」。</li>
          </ol>
          <p class="px-4 pb-3 text-xs text-muted leading-relaxed">免費方案有每日用量上限，一般個人使用足夠。金鑰等同密碼，請勿分享；若外流，可回到同一頁面刪除並重新建立。</p>
        </details>
      </section>

      <!-- 外觀 -->
      <section class="p-4 rounded-2xl bg-surface border border-hairline">
        <p class="font-bold text-fg mb-2">外觀</p>
        <div class="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="t in THEMES" :key="t.key" @click="applyTheme(t.key)" class="h-9 rounded-lg"
            :class="themeMode === t.key ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ t.label }}</button>
        </div>
      </section>

      <p class="text-center text-xs text-muted">MedBase Mobile v{{ version }}</p>
    </div>
  </div>
</template>
