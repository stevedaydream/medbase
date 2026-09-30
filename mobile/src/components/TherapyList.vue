<script setup lang="ts">
import type { HbTherapy } from '@shared/handbook/types'

/** 用藥建議（依情境）：依症狀頁、手冊頁共用 */
defineProps<{ therapy: HbTherapy[]; refs: { title: string; url: string }[] }>()
</script>

<template>
  <section v-if="therapy.length" class="space-y-3">
    <h3 class="text-sm font-black text-fg">💊 用藥建議</h3>
    <div v-for="t in therapy" :key="t.id" class="p-4 rounded-2xl bg-surface border border-hairline space-y-2">
      <p class="text-[15px] font-black text-accent">{{ t.scenario }}</p>
      <div v-for="m in t.meds" :key="m.name" class="p-3 rounded-xl border" :class="m.alert ? 'bg-danger/10 border-danger/50' : 'bg-sunken border-hairline'">
        <p class="font-bold" :class="m.alert ? 'text-danger' : 'text-fg'">{{ m.alert ? '⚠ 高警訊 · ' : '' }}{{ m.name }}</p>
        <p class="text-sm text-fg-secondary">{{ m.dose }}</p>
      </div>
      <p v-if="t.notes" class="text-xs text-muted">📝 {{ t.notes }}</p>
      <p v-if="t.refs?.length" class="text-[11px] text-muted">📚
        <a v-for="i in t.refs" :key="i" :href="refs[i].url" target="_blank" rel="noopener" class="underline mr-2">[{{ i + 1 }}] {{ refs[i].title }}</a>
      </p>
    </div>
    <p class="text-[11px] text-muted">劑量為指引常用範圍，實際依醫囑；抗生素依院內抗藥性、腎功能與過敏史調整</p>
  </section>
</template>
