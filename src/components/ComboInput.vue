<script setup lang="ts">
import { computed, ref, nextTick } from "vue";

/**
 * 可輸入的下拉選單：從既有選項挑選，或直接輸入新值（顯示「＋ 新增」）。
 * 新值存檔後會出現在呼叫端提供的 options 裡，下次即可直接選。
 */
const props = withDefaults(defineProps<{
  modelValue: string | null | undefined;
  options: string[];
  placeholder?: string;
  inputClass?: string;
  /** 新增選項的提示文字，例如「新增類別」 */
  addLabel?: string;
}>(), { placeholder: "", inputClass: "", addLabel: "新增" });
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const open = ref(false);
const active = ref(-1);
const input = ref<HTMLInputElement>();
const text = computed(() => props.modelValue ?? "");

const uniq = computed(() => [...new Set(props.options.map(o => o.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-TW")));
const filtered = computed(() => {
  const q = text.value.trim().toLowerCase();
  return q ? uniq.value.filter(o => o.toLowerCase().includes(q)) : uniq.value;
});
const isNew = computed(() => !!text.value.trim() && !uniq.value.some(o => o === text.value.trim()));

function choose(v: string) {
  emit("update:modelValue", v);
  open.value = false;
  active.value = -1;
}

function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    open.value = true;
    const n = filtered.value.length;
    if (!n) return;
    active.value = e.key === "ArrowDown" ? (active.value + 1) % n : (active.value - 1 + n) % n;
  } else if (e.key === "Enter" && open.value && active.value >= 0) {
    e.preventDefault();
    choose(filtered.value[active.value]);
  } else if (e.key === "Escape") {
    open.value = false;
  }
}

async function toggle() {
  open.value = !open.value;
  await nextTick();
  input.value?.focus();
}
// 點選選項時 blur 比 click 先發生，延後關閉
const close = () => setTimeout(() => { open.value = false; }, 150);
</script>

<template>
  <div class="relative">
    <input ref="input" :value="text" :placeholder="placeholder" :class="inputClass" class="pr-7"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value); open = true; active = -1"
      @focus="open = true" @blur="close" @keydown="onKey" />
    <button type="button" tabindex="-1" @mousedown.prevent="toggle"
      class="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 text-2xs text-muted hover:text-fg cursor-pointer">▾</button>
    <div v-if="open && (filtered.length || isNew)"
      class="absolute z-50 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-xl border border-hairline bg-surface shadow-2xl py-1 text-xs">
      <button v-if="isNew" type="button" @mousedown.prevent="choose(text.trim())"
        class="w-full text-left px-3 py-1.5 text-accent font-bold hover:bg-overlay/5 cursor-pointer">
        ＋ {{ addLabel }}「{{ text.trim() }}」
      </button>
      <button v-for="(o, i) in filtered" :key="o" type="button" @mousedown.prevent="choose(o)"
        class="w-full text-left px-3 py-1.5 hover:bg-overlay/5 cursor-pointer"
        :class="[i === active ? 'bg-overlay/5' : '', o === text ? 'text-accent font-bold' : 'text-fg']">
        {{ o }}
      </button>
    </div>
  </div>
</template>
