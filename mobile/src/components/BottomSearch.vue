<script setup lang="ts">
import { ref } from 'vue'
import { keyboardOpen } from '../lib/ui'

/**
 * 固定在底部分頁列正上方的搜尋列（ADR-013：拇指可及）；鍵盤彈出時貼在鍵盤上方。
 * 有篩選的頁面傳 filterCount（>=0）顯示左側 ☰ 按鈕。
 */
const model = defineModel<string>({ default: '' })
defineProps<{ placeholder?: string; filterCount?: number }>()
const emit = defineEmits<{ (e: 'filter'): void }>()
const input = ref<HTMLInputElement | null>(null)
defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div class="fixed inset-x-0 z-30 px-3 py-2 bg-surface/95 backdrop-blur border-t border-hairline flex items-center gap-2"
    :style="{ bottom: keyboardOpen ? 'var(--kb)' : 'calc(var(--tabbar-h) + var(--safe-b))' }">
    <button v-if="filterCount !== undefined" @click="emit('filter')"
      class="relative shrink-0 w-11 h-11 rounded-xl bg-sunken border border-hairline text-lg text-fg-secondary"
      aria-label="篩選">
      ☰
      <span v-if="filterCount" class="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-accent text-white text-2xs font-bold flex items-center justify-center">{{ filterCount }}</span>
    </button>
    <div class="relative flex-1">
      <input ref="input" v-model="model" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" :placeholder="placeholder ?? '搜尋…'"
        @keydown.enter="input?.blur()"
        class="w-full h-11 pl-10 pr-9 rounded-xl bg-sunken border border-hairline text-base text-fg placeholder-muted outline-none focus:border-accent/60" />
      <span class="absolute left-3.5 top-3 text-muted">🔍</span>
      <button v-if="model" @click="model = ''; input?.focus()"
        class="absolute right-2 top-2 w-7 h-7 rounded-full text-muted text-lg leading-none" aria-label="清除">×</button>
    </div>
  </div>
</template>
