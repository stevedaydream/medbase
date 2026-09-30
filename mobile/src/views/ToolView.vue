<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { FORMULAS, PUMP_UNIT_LABELS } from '@shared/handbook/formulas'
import { allDilutions, parseHbSpec, visibleEntries, type HbDilution } from '@shared/handbook/types'
import { data, loadCache } from '../lib/data'
import { toolById } from '@shared/tools'

/** 計算工具（處置及臨床工具）：公式直接在這頁算；互動式工具（ABG、FiO₂…）轉到臨床工具頁 */
const route = useRoute()
const router = useRouter()
const tool = computed(() => toolById(String(route.params.id)))
watch(tool, t => { if (t?.kind === 'calc') router.replace(`/tools?tool=${t.calcId}`) }, { immediate: true })

const formula = computed(() => FORMULAS.find(f => f.id === route.params.id) ?? null)
const inputs = ref<Record<string, string>>({})
watch(() => route.params.id, () => { inputs.value = {} })
void loadCache()
const presets = computed(() => allDilutions(visibleEntries(data.tables.handbook
  .map(r => ({ uid: r.uid, name: r.name, spec: parseHbSpec(r.spec)! })).filter(e => !!e.spec))))
const isPump = computed(() => String(route.params.id).startsWith('pump'))
function usePreset(d: HbDilution) { inputs.value = { ...inputs.value, amt: String(d.amt), vol: String(d.vol), unit: String(d.unit) } }
const out = computed(() => formula.value?.compute(Object.fromEntries(Object.entries(inputs.value).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))) ?? null)
</script>

<template>
  <div class="pad-tabbar">
    <PageHeader :title="formula?.name ?? '計算工具'" back />
    <p v-if="!formula" class="py-12 text-center text-sm text-muted">找不到這個工具</p>
    <div v-else class="p-4 space-y-3">
      <p class="text-xs text-muted font-mono">{{ formula.formula }}</p>
      <div v-if="isPump" class="space-y-1.5">
        <p class="text-sm font-bold text-fg">院內泡法（點選帶入）</p>
        <div v-if="presets.length" class="flex flex-wrap gap-2">
          <button v-for="(d, i) in presets" :key="i" @click="usePreset(d)" class="px-3 py-2 rounded-xl border border-accent/30 bg-accent/10 text-accent text-sm font-bold">
            {{ d.drug }} {{ d.amt }}{{ d.unit === 3 ? ' U' : ' mg' }}/{{ d.vol }} mL
            <span class="block text-[10px] font-normal">{{ PUMP_UNIT_LABELS[d.unit] }}{{ d.note ? ' · ' + d.note : '' }}</span>
          </button>
        </div>
        <p v-else class="text-xs text-muted">尚未設定院內泡法（由桌機「資料管理 › 工作手冊」填寫）</p>
      </div>
      <label v-for="i in formula.inputs" :key="i.key" class="block">
        <span class="text-sm font-bold text-fg">{{ i.label }} <span class="text-muted font-normal">{{ i.unit }}</span></span>
        <div v-if="i.options" class="mt-1 grid grid-cols-2 gap-2">
          <button v-for="o in i.options" :key="o.value" @click="inputs[i.key] = String(o.value)" class="h-11 rounded-xl border font-bold"
            :class="inputs[i.key] === String(o.value) ? 'bg-accent text-white border-accent' : 'bg-sunken border-hairline'">{{ o.label }}</button>
        </div>
        <input v-else v-model="inputs[i.key]" inputmode="decimal" class="mt-1 w-full h-12 px-4 rounded-xl bg-sunken border border-hairline text-xl font-mono" />
      </label>
      <div v-if="out" class="p-4 rounded-2xl bg-accent/10 border border-accent/30">
        <p class="text-3xl font-black text-accent font-mono">{{ out.value }} <span class="text-base">{{ out.unit }}</span></p>
        <p v-if="out.note" class="text-sm text-fg-secondary mt-1">{{ out.note }}</p>
      </div>
      <p v-if="formula.normal" class="text-xs text-muted">參考：{{ formula.normal }}</p>
      <a :href="formula.ref.url" target="_blank" rel="noopener" class="block text-xs underline text-muted">📚 {{ formula.ref.title }}</a>
    </div>
  </div>
</template>
