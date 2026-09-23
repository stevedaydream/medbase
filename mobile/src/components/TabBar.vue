<script setup lang="ts">
import { useRoute } from 'vue-router'
import { keyboardOpen } from '../lib/ui'

// 底部五個分頁（ADR-013）；「更多」用 ⋯，避免和篩選的 ☰ 撞圖示
const TABS = [
  { to: '/',         icon: '🏠', label: '首頁',   match: (p: string) => p === '/' },
  { to: '/sets',     icon: '🗂️', label: '套組',   match: (p: string) => p.startsWith('/sets') },
  { to: '/contacts', icon: '👤', label: '通訊錄', match: (p: string) => p.startsWith('/contacts') },
  { to: '/schedule', icon: '📅', label: '班表',   match: (p: string) => p.startsWith('/schedule') },
  { to: '/more',     icon: '⋯',  label: '更多',   match: (p: string) => !['/', '/sets', '/contacts', '/schedule'].some(x => x === '/' ? p === '/' : p.startsWith(x)) },
]
const route = useRoute()
</script>

<template>
  <nav v-show="!keyboardOpen"
    class="fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-hairline flex"
    :style="{ height: 'calc(var(--tabbar-h) + var(--safe-b))', paddingBottom: 'var(--safe-b)' }">
    <RouterLink v-for="t in TABS" :key="t.to" :to="t.to"
      class="flex-1 flex flex-col items-center justify-center gap-0.5 text-2xs font-bold"
      :class="t.match(route.path) ? 'text-accent' : 'text-muted'">
      <span class="text-xl leading-none">{{ t.icon }}</span>
      {{ t.label }}
    </RouterLink>
  </nav>
</template>
