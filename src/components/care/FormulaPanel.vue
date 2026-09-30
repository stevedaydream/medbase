<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Formula } from "@/shared/handbook/formulas";

/** 公式計算（處置及臨床工具 › 計算工具） */
const props = defineProps<{ formula: Formula }>();
const inputs = ref<Record<string, string>>({});
watch(() => props.formula.id, () => { inputs.value = {}; });
const out = computed(() => props.formula.compute(Object.fromEntries(
  Object.entries(inputs.value).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]))));
</script>

<template>
  <div class="bg-surface rounded-xl border border-hairline p-5 space-y-4 overflow-y-auto">
    <h2 class="text-lg font-black text-fg">{{ formula.name }}</h2>
    <p class="text-xs text-muted font-mono">{{ formula.formula }}</p>
    <div class="grid grid-cols-2 gap-3 max-w-xl">
      <label v-for="i in formula.inputs" :key="i.key" class="space-y-1 text-xs">
        <span class="text-fg-secondary">{{ i.label }} <span class="text-muted">{{ i.unit }}</span></span>
        <span v-if="i.options" class="flex gap-1">
          <button v-for="o in i.options" :key="o.value" type="button" @click="inputs[i.key] = String(o.value)"
            class="px-3 py-2 rounded-lg border text-sm font-bold"
            :class="inputs[i.key] === String(o.value) ? 'bg-accent text-white border-accent' : 'bg-sunken border-hairline text-fg'">{{ o.label }}</button>
        </span>
        <input v-else v-model="inputs[i.key]" inputmode="decimal" class="w-full px-3 py-2 rounded-lg bg-sunken border border-hairline text-lg font-mono" />
      </label>
    </div>
    <div v-if="out" class="p-4 rounded-xl bg-accent/10 border border-accent/30 max-w-xl">
      <p class="text-3xl font-black text-accent font-mono">{{ out.value }} <span class="text-base">{{ out.unit }}</span></p>
      <p v-if="out.note" class="text-xs text-fg-secondary mt-1">{{ out.note }}</p>
    </div>
    <p v-else class="text-sm text-muted">輸入數值後顯示結果</p>
    <p v-if="formula.normal" class="text-xs text-muted">參考：{{ formula.normal }}</p>
    <button class="text-xs underline text-muted hover:text-accent" @click="openUrl(formula.ref.url)">📚 {{ formula.ref.title }}</button>
  </div>
</template>
