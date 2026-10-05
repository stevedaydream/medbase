<script setup lang="ts">
import { computed } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { routeAllowed } from '../lib/access'

const ALL = [
  { to: '/items',    icon: '📦', label: '自費品項',   desc: '院內碼、價格、醫師套組' },
  { to: '/memos',    icon: '📝', label: '規則備忘錄', desc: '上班規則與注意事項' },
  { to: '/care',     icon: '🩺', label: '處置及臨床工具', desc: '依症狀、數值判讀、藥物、計算工具、手冊' },
  { to: '/docs',     icon: '✍️', label: '病例討論／公假心得', desc: '以 AI 產生 Word 文件並分享寄出' },
  { to: '/research', icon: '🎓', label: '論文專案',   desc: '需輸入論文 PIN' },
  { to: '/settings', icon: '⚙️', label: '設定',       desc: '登出、Gemini 金鑰、資料更新' },
]
// 依身分只顯示有權限的功能（ADR-026）
const LINKS = computed(() => ALL.filter(l => routeAllowed(l.to)))
</script>

<template>
  <div class="pad-tabbar">
    <PageHeader title="更多" />
    <nav class="p-4 space-y-2">
      <RouterLink v-for="l in LINKS" :key="l.to" :to="l.to"
        class="flex items-center gap-3 p-4 rounded-2xl bg-surface border border-hairline active:bg-raised">
        <span class="text-2xl w-9 text-center">{{ l.icon }}</span>
        <span class="flex-1 min-w-0">
          <span class="block font-bold text-fg">{{ l.label }}</span>
          <span class="block text-xs text-muted truncate">{{ l.desc }}</span>
        </span>
        <span class="text-muted text-lg">›</span>
      </RouterLink>
    </nav>
  </div>
</template>
