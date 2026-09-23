<script setup lang="ts">
import { useRouter } from 'vue-router'
import { data } from '../lib/data'

/** 頁首：標題、返回（選填）、離線／更新中狀態 */
defineProps<{ title: string; back?: boolean }>()
const router = useRouter()
</script>

<template>
  <header class="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-hairline safe-top">
    <div class="flex items-center gap-2 px-4 h-12">
      <button v-if="back" @click="router.back()" class="-ml-2 w-9 h-9 text-xl text-fg-secondary" aria-label="返回">‹</button>
      <h1 class="flex-1 min-w-0 truncate text-base font-bold text-fg">{{ title }}</h1>
      <span v-if="data.refreshing" class="text-xs text-muted">更新中…</span>
      <span v-else-if="data.offline" class="text-xs text-warning font-bold">離線</span>
      <slot name="right" />
    </div>
    <slot />
  </header>
</template>
