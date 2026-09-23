<script setup lang="ts">
import { ref, computed } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import {
  correctedCalcium, calciumStatus, interpretAbg, estimateTdd, insulinCorrection, nutrition, fio2Estimate,
  STRESS_OPTIONS, PROTEIN_OPTIONS, VENTURI_FLOW, VENTURI_OPTIONS, DEVICE_LABELS, type Tone, type GluBasis, type O2Device,
} from '@shared/clinicalCalc'

/** 臨床工具（公式與桌機共用 shared/clinicalCalc） */
type ToolId = 'calcium' | 'abg' | 'glucose' | 'nutrition' | 'fio2'
const TOOLS: { id: ToolId; icon: string; label: string }[] = [
  { id: 'calcium', icon: '🧪', label: '校正鈣' },
  { id: 'abg', icon: '🫁', label: 'ABG' },
  { id: 'glucose', icon: '🩸', label: '血糖' },
  { id: 'nutrition', icon: '🥗', label: '營養' },
  { id: 'fio2', icon: '💨', label: 'FiO₂' },
]
const tool = ref<ToolId>((localStorage.getItem('mb_tool') as ToolId) || 'calcium')
function pickTool(id: ToolId) { tool.value = id; localStorage.setItem('mb_tool', id) }

const TONE: Record<Tone, string> = {
  'danger-strong': 'text-danger font-bold', danger: 'text-danger', warning: 'text-warning', caution: 'text-warning',
  'accent-strong': 'text-accent font-bold', accent: 'text-accent', success: 'text-success', secondary: 'text-fg-secondary', muted: 'text-muted',
}

// 校正鈣
const ca = ref(''), alb = ref('')
const caV = computed(() => correctedCalcium(ca.value, alb.value))
const caS = computed(() => calciumStatus(caV.value))
const CA_TONE = { low: 'text-accent', high: 'text-danger', normal: 'text-success' }

// ABG
const ph = ref(''), co2 = ref(''), hco3 = ref(''), pao2 = ref(''), fio2 = ref('21')
const abg = computed(() => interpretAbg({ ph: ph.value, co2: co2.value, hco3: hco3.value, pao2: pao2.value, fio2: fio2.value }))

// 血糖
const bg = ref(''), target = ref('140'), tdd = ref(''), isf = ref(''), weight = ref(''), ukg = ref(0.5)
const basis = ref<GluBasis>('tdd')
const estTdd = computed(() => estimateTdd(weight.value, ukg.value))
const ins = computed(() => insulinCorrection({ bg: bg.value, target: target.value, basis: basis.value, tdd: tdd.value, weight: weight.value, ukg: ukg.value, isf: isf.value }))

// 營養
const nw = ref(''), nh = ref(''), na = ref(''), gender = ref<'M' | 'F'>('M'), stress = ref(1.2), protein = ref(1.2)
const nut = computed(() => nutrition({ weight: nw.value, height: nh.value, age: na.value, gender: gender.value, stress: stress.value, proteinPerKg: protein.value }))

// FiO2
const device = ref<O2Device>('nc'), flow = ref(''), venturi = ref(28), hfnc = ref('40'), o2pao2 = ref('')
const o2 = computed(() => fio2Estimate({ device: device.value, flow: flow.value, venturi: venturi.value, hfncFio2: hfnc.value, pao2: o2pao2.value }))

const inputCls = 'w-full h-12 px-3 rounded-xl bg-sunken border border-hairline text-lg text-fg tabular-nums outline-none focus:border-accent/60'
</script>

<template>
  <div class="accent-cyan pad-tabbar">
    <PageHeader title="臨床工具" back>
      <div class="flex gap-1.5 px-4 pb-2 overflow-x-auto no-scrollbar">
        <button v-for="t in TOOLS" :key="t.id" @click="pickTool(t.id)" class="shrink-0 h-9 px-3 rounded-full text-sm font-bold border"
          :class="tool === t.id ? 'bg-accent text-white border-accent' : 'bg-sunken text-fg-secondary border-hairline'">{{ t.icon }} {{ t.label }}</button>
      </div>
    </PageHeader>

    <div class="p-4 space-y-4">
      <!-- 校正鈣 -->
      <template v-if="tool === 'calcium'">
        <section class="rounded-2xl bg-surface border border-hairline p-4 grid grid-cols-2 gap-3">
          <label class="text-xs font-bold text-muted">總鈣 (mg/dL)<input v-model="ca" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          <label class="text-xs font-bold text-muted">白蛋白 (g/dL)<input v-model="alb" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
        </section>
        <section v-if="caV !== null && caS" class="rounded-2xl bg-surface border border-hairline p-4 text-center">
          <p class="text-xs text-muted">校正鈣</p>
          <p class="text-4xl font-black tabular-nums" :class="CA_TONE[caS.level]">{{ caV.toFixed(2) }}</p>
          <p class="font-bold" :class="CA_TONE[caS.level]">{{ caS.label }}</p>
          <p class="mt-2 text-xs text-muted">公式：Ca + 0.8 × (4.0 − Alb)</p>
        </section>
      </template>

      <!-- ABG -->
      <template v-else-if="tool === 'abg'">
        <section class="rounded-2xl bg-surface border border-hairline p-4 grid grid-cols-3 gap-3">
          <label class="text-xs font-bold text-muted">pH<input v-model="ph" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          <label class="text-xs font-bold text-muted">PaCO₂<input v-model="co2" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          <label class="text-xs font-bold text-muted">HCO₃⁻<input v-model="hco3" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          <label class="text-xs font-bold text-muted">PaO₂（選填）<input v-model="pao2" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          <label class="text-xs font-bold text-muted">FiO₂ %<input v-model="fio2" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
        </section>
        <section v-if="abg" class="rounded-2xl bg-surface border border-hairline p-4 space-y-1.5 text-sm">
          <p v-for="(l, i) in abg" :key="i" :class="TONE[l.tone]" class="whitespace-pre-wrap">{{ l.text }}</p>
        </section>
      </template>

      <!-- 血糖 -->
      <template v-else-if="tool === 'glucose'">
        <section class="rounded-2xl bg-surface border border-hairline p-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <label class="text-xs font-bold text-muted">目前血糖 (mg/dL)<input v-model="bg" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
            <label class="text-xs font-bold text-muted">目標血糖<input v-model="target" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          </div>
          <div class="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
            <button v-for="b in ([['tdd', '已知 TDD'], ['weight', '用體重估'], ['isf', '直接填 ISF']] as const)" :key="b[0]" @click="basis = b[0]"
              class="h-9 rounded-lg" :class="basis === b[0] ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ b[1] }}</button>
          </div>
          <label v-if="basis === 'tdd'" class="block text-xs font-bold text-muted">每日胰島素總量 TDD (U)<input v-model="tdd" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          <div v-else-if="basis === 'weight'" class="grid grid-cols-2 gap-3">
            <label class="text-xs font-bold text-muted">體重 (kg)<input v-model="weight" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
            <label class="text-xs font-bold text-muted">U/kg/day
              <select v-model.number="ukg" :class="inputCls" class="mt-1">
                <option :value="0.3">0.3（年長、腎功能差）</option>
                <option :value="0.4">0.4</option>
                <option :value="0.5">0.5（一般）</option>
              </select>
            </label>
            <p v-if="estTdd" class="col-span-2 text-xs text-muted">估算 TDD ≈ {{ estTdd }} U</p>
          </div>
          <label v-else class="block text-xs font-bold text-muted">ISF（每 1U 降多少 mg/dL）<input v-model="isf" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
        </section>
        <section v-if="ins" class="rounded-2xl bg-surface border border-hairline p-4 text-center">
          <p class="text-xs text-muted">建議校正劑量（短效）</p>
          <p class="text-4xl font-black tabular-nums" :class="ins.needCorr ? 'text-accent' : 'text-success'">{{ ins.dose }} U</p>
          <p class="font-bold" :class="ins.bg < 70 || ins.bg >= 250 ? 'text-danger' : 'text-fg-secondary'">{{ ins.status }}</p>
          <p class="mt-2 text-xs text-muted">ISF {{ ins.isf }} mg/dL/U<template v-if="ins.tddNote">（1700 ÷ TDD {{ ins.tddNote }}）</template></p>
          <p v-if="ins.estimated" class="mt-1 text-xs text-warning">以體重估算 TDD 僅供起始參考，請依實際反應調整</p>
        </section>
      </template>

      <!-- 營養 -->
      <template v-else-if="tool === 'nutrition'">
        <section class="rounded-2xl bg-surface border border-hairline p-4 space-y-3">
          <div class="grid grid-cols-3 gap-3">
            <label class="text-xs font-bold text-muted">體重 kg<input v-model="nw" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
            <label class="text-xs font-bold text-muted">身高 cm<input v-model="nh" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
            <label class="text-xs font-bold text-muted">年齡<input v-model="na" inputmode="numeric" :class="inputCls" class="mt-1" /></label>
          </div>
          <div class="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
            <button v-for="g in (['M', 'F'] as const)" :key="g" @click="gender = g" class="h-9 rounded-lg"
              :class="gender === g ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ g === 'M' ? '男' : '女' }}</button>
          </div>
          <label class="block text-xs font-bold text-muted">壓力係數
            <select v-model.number="stress" :class="inputCls" class="mt-1 text-base"><option v-for="o in STRESS_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}（×{{ o.value }}）</option></select>
          </label>
          <label class="block text-xs font-bold text-muted">蛋白質需求
            <select v-model.number="protein" :class="inputCls" class="mt-1 text-base"><option v-for="o in PROTEIN_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          </label>
        </section>
        <section v-if="nut" class="rounded-2xl bg-surface border border-hairline p-4 grid grid-cols-2 gap-3 text-center">
          <div class="col-span-2"><p class="text-xs text-muted">每日熱量（TDEE）</p><p class="text-4xl font-black text-accent tabular-nums">{{ nut.tdee }} kcal</p></div>
          <div><p class="text-xs text-muted">BMR</p><p class="font-bold tabular-nums">{{ nut.bmr }} kcal</p></div>
          <div><p class="text-xs text-muted">蛋白質</p><p class="font-bold tabular-nums">{{ nut.protein }} g</p></div>
          <div><p class="text-xs text-muted">脂肪（30%）</p><p class="font-bold tabular-nums">{{ nut.fat }} g</p></div>
          <div><p class="text-xs text-muted">醣類</p><p class="font-bold tabular-nums">{{ nut.carb }} g</p></div>
          <div><p class="text-xs text-muted">BMI</p><p class="font-bold tabular-nums">{{ nut.bmi }}</p></div>
          <div><p class="text-xs text-muted">理想體重</p><p class="font-bold tabular-nums">{{ nut.ibw }} kg</p></div>
          <p class="col-span-2 text-xs text-muted">Harris-Benedict 公式</p>
        </section>
      </template>

      <!-- FiO2 -->
      <template v-else>
        <section class="rounded-2xl bg-surface border border-hairline p-4 space-y-3">
          <label class="block text-xs font-bold text-muted">給氧裝置
            <select v-model="device" :class="inputCls" class="mt-1 text-base"><option v-for="(l, k) in DEVICE_LABELS" :key="k" :value="k">{{ l }}</option></select>
          </label>
          <label v-if="device === 'venturi'" class="block text-xs font-bold text-muted">設定 FiO₂ %
            <select v-model.number="venturi" :class="inputCls" class="mt-1 text-base"><option v-for="v in VENTURI_OPTIONS" :key="v" :value="v">{{ v }}%（≥ {{ VENTURI_FLOW[v] }} L/min）</option></select>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label v-if="device !== 'venturi'" class="text-xs font-bold text-muted">流速 L/min<input v-model="flow" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
            <label v-if="device === 'hfnc'" class="text-xs font-bold text-muted">設定 FiO₂ %<input v-model="hfnc" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
            <label class="text-xs font-bold text-muted">PaO₂（選填）<input v-model="o2pao2" inputmode="decimal" :class="inputCls" class="mt-1" /></label>
          </div>
        </section>
        <section v-if="o2" class="rounded-2xl bg-surface border border-hairline p-4 text-center">
          <p class="text-xs text-muted">估計 FiO₂</p>
          <p class="text-4xl font-black text-accent tabular-nums">{{ o2.fio2 }}%</p>
          <p class="text-sm text-fg-secondary">{{ o2.note }}</p>
          <p v-if="o2.pf !== null" class="mt-2 font-bold">P/F ratio {{ o2.pf }}　<span class="text-fg-secondary">{{ o2.pfLabel }}</span></p>
        </section>
      </template>
    </div>
  </div>
</template>
