<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PUMP_UNIT_LABELS, type Formula } from "@/shared/handbook/formulas";
import type { HbDilution } from "@/shared/handbook/types";

/** 公式計算（處置及臨床工具 › 計算工具） */
const props = defineProps<{ formula: Formula; presets?: HbDilution[] }>();
const isPump = computed(() => props.formula.id.startsWith("pump"));
function usePreset(d: HbDilution) {
  inputs.value = { ...inputs.value, amt: String(d.amt), vol: String(d.vol), unit: String(d.unit) };
}
const inputs = ref<Record<string, string>>({});
watch(() => props.formula.id, () => { inputs.value = {}; });
const out = computed(() => props.formula.compute(Object.fromEntries(
  Object.entries(inputs.value).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]))));
</script>

<template>
  <div class="bg-surface rounded-xl border border-hairline p-5 space-y-4 overflow-y-auto">
    <h2 class="text-lg font-black text-fg">{{ formula.name }}</h2>
    <p class="text-xs text-muted font-mono">{{ formula.formula }}</p>
    <div v-if="isPump" class="space-y-1">
      <p class="text-xs font-bold text-fg-secondary">院內泡法（點選帶入）</p>
      <div v-if="presets?.length" class="flex flex-wrap gap-2">
        <button v-for="(d, i) in presets" :key="i" @click="usePreset(d)" class="px-3 py-1.5 rounded-lg border border-accent/30 bg-accent/5 text-accent text-xs font-bold" :title="d.note">
          {{ d.drug }} {{ d.amt }}{{ d.unit === 3 ? " U" : " mg" }}/{{ d.vol }} mL（{{ PUMP_UNIT_LABELS[d.unit] }}）
        </button>
      </div>
      <p v-else class="text-xs text-muted">尚未設定院內泡法：到「資料管理 › 工作手冊」的藥物條目填寫「院內泡法」</p>
    </div>
    <div class="grid grid-cols-2 gap-3 max-w-xl">
      <label v-for="i in formula.inputs" :key="i.key" class="space-y-1 text-xs" :class="formula.id === 'child-pugh' && i.options ? 'col-span-2' : ''">
        <span class="text-fg-secondary">{{ i.label }} <span class="text-muted">{{ i.unit }}</span></span>
        <span v-if="i.options" class="flex flex-wrap gap-1">
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
      <dl v-if="out.breakdown" class="mt-3 space-y-1 text-sm text-fg-secondary">
        <div v-for="item in out.breakdown" :key="item.label" class="flex justify-between gap-3">
          <dt>{{ item.label }}</dt><dd>{{ item.points }} 分</dd>
        </div>
      </dl>
    </div>
    <p v-else class="text-sm text-muted">輸入數值後顯示結果</p>
    <p v-if="formula.normal" class="text-xs text-muted">參考：{{ formula.normal }}</p>
    <button class="text-xs underline text-muted hover:text-accent" @click="openUrl(formula.ref.url)">📚 {{ formula.ref.title }}</button>
  </div>
</template>
