<script setup lang="ts">
import { ref, onUnmounted } from "vue";

/** SDM 範本的一個文字欄位：標題（對照 HIS 欄位名稱）＋內容＋複製按鈕 */
const props = defineProps<{ label: string; value: string }>();
const emit = defineEmits<{ copied: [label: string] }>();

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    emit("copied", props.label);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { copied.value = false; }, 1500);
  } catch { /* 剪貼簿無法使用時不動作 */ }
}
onUnmounted(() => { if (timer) clearTimeout(timer); });
</script>

<template>
  <div class="flex items-start gap-3 bg-sunken border border-hairline rounded-xl px-4 py-3">
    <div class="flex-1 min-w-0">
      <p class="text-xs font-black text-muted mb-1">{{ label }}</p>
      <p class="text-xs text-fg leading-relaxed whitespace-pre-wrap select-text break-words">{{ value }}</p>
    </div>
    <button @click="copy"
      class="shrink-0 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all active:scale-95 cursor-pointer"
      :class="copied ? 'border-success/50 bg-success/10 text-success' : 'border-hairline bg-surface hover:bg-elevated text-fg-secondary'">
      {{ copied ? "✓ 已複製" : "📋 複製" }}
    </button>
  </div>
</template>
