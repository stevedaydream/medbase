<script setup lang="ts">
import { computed } from "vue";
import type { OutlineItem } from "./outline";

/** 大綱面板：點標題跳到該處；游標所在段落的標題反白 */
const props = defineProps<{ items: OutlineItem[]; cursor: number }>();
const emit = defineEmits<{ (e: "jump", pos: number): void }>();

const minLevel = computed(() => Math.min(...props.items.map(i => i.level), 6));
const activeIdx = computed(() => {
  let idx = -1;
  props.items.forEach((it, i) => { if (it.pos <= props.cursor) idx = i; });
  return idx;
});
</script>

<template>
  <nav class="text-xs space-y-0.5">
    <p v-if="!items.length" class="text-muted py-4 text-center">沒有標題</p>
    <button v-for="(it, i) in items" :key="it.pos" @click="emit('jump', it.pos)"
      class="block w-full text-left truncate rounded-md py-1 pr-2 hover:bg-overlay/5 cursor-pointer"
      :class="i === activeIdx ? 'text-accent font-bold bg-accent/5' : 'text-fg-secondary'"
      :style="{ paddingLeft: `${(it.level - minLevel) * 0.85 + 0.5}rem` }" :title="it.text">
      {{ it.text }}
    </button>
  </nav>
</template>
