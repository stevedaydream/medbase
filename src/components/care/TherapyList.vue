<script setup lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";
import type { HbTherapy } from "@/shared/handbook/types";

/** 用藥建議（依情境）：依症狀頁、手冊頁共用 */
defineProps<{ therapy: HbTherapy[]; refs: { title: string; url: string }[] }>();
</script>

<template>
  <div v-if="therapy.length" class="space-y-3">
    <h3 class="text-sm font-black text-fg">💊 用藥建議</h3>
    <div v-for="t in therapy" :key="t.id" class="rounded-xl border border-hairline bg-sunken p-4 space-y-2">
      <p class="text-sm font-bold text-accent">{{ t.scenario }}</p>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <div v-for="m in t.meds" :key="m.name" class="p-3 rounded-lg border"
          :class="m.alert ? 'bg-danger/10 border-danger/40' : 'bg-surface border-hairline'">
          <p class="text-sm font-bold" :class="m.alert ? 'text-danger' : 'text-fg'">{{ m.alert ? "⚠ 高警訊 · " : "" }}{{ m.name }}</p>
          <p class="text-xs text-fg-secondary mt-1">{{ m.dose }}</p>
        </div>
      </div>
      <p v-if="t.notes" class="text-xs text-muted">📝 {{ t.notes }}</p>
      <p v-if="t.refs?.length" class="text-2xs text-muted flex flex-wrap gap-x-3">
        <span>📚</span>
        <button v-for="i in t.refs" :key="i" class="underline hover:text-accent text-left" @click="openUrl(refs[i].url)">[{{ i + 1 }}] {{ refs[i].title }}</button>
      </p>
    </div>
    <p class="text-xs text-muted">劑量為指引常用範圍，實際依醫囑；抗生素依院內抗藥性、腎功能與過敏史調整</p>
  </div>
</template>
