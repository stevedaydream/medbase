<script setup lang="ts">
import { computed, onMounted } from "vue";
import { TIPS, type TipId } from "./catalog";
import { loadTips, tipVisible, markTipSeen, setTipsEnabled, useTips } from "./useTips";

/** ids：目前情境適用的提示（依優先順序）；只顯示第一則還沒看過的 */
const props = defineProps<{ ids: TipId[] }>();
useTips();
onMounted(() => { void loadTips(); });

const current = computed(() => props.ids.find(id => tipVisible(id)) ?? null);
const tip = computed(() => (current.value ? TIPS[current.value] : null));
const left = computed(() => props.ids.filter(id => tipVisible(id)).length);
</script>

<template>
  <div v-if="current && tip" class="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-accent/30 bg-accent/5 text-xs" role="note">
    <span class="text-base leading-none mt-0.5">💡</span>
    <div class="flex-1 min-w-0">
      <div class="font-semibold text-fg">{{ tip.title }}<span v-if="left > 1" class="ml-1.5 font-normal text-muted">還有 {{ left - 1 }} 則</span></div>
      <div class="text-fg-secondary leading-relaxed mt-0.5">{{ tip.text }}</div>
    </div>
    <div class="flex flex-col items-end gap-1 shrink-0">
      <button class="px-2.5 py-1 rounded bg-accent hover:bg-accent-hover text-white font-semibold" @click="markTipSeen(current)">知道了</button>
      <button class="text-2xs text-muted hover:text-fg" title="可在設定頁重新開啟" @click="setTipsEnabled(false)">關閉所有提示</button>
    </div>
  </div>
</template>
