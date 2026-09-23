<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { copy } from '../lib/ui'

/** 密碼：預設遮蔽，點一下露出約 10 秒；露出時再點一下複製（ADR-013） */
const props = defineProps<{ value: string; label?: string }>()
const shown = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function onTap() {
  if (!props.value) return
  if (shown.value) { copy(props.value, props.label ?? '密碼', true); return }
  shown.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { shown.value = false }, 10_000)
}
onUnmounted(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <button @click.stop="onTap" class="font-mono tabular-nums text-left"
    :class="shown ? 'text-fg' : 'text-muted tracking-widest'"
    :title="shown ? '點一下複製' : '點一下顯示'">
    {{ value ? (shown ? value : '••••••') : '—' }}
    <span v-if="value" class="ml-1 text-2xs font-sans tracking-normal text-muted">{{ shown ? '點擊複製' : '點擊顯示' }}</span>
  </button>
</template>
