<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { data, loadCache, pullRefresh } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { matchTiers, searchCards, visibleCards, rangeText, tierRefs, measureFormula, measureValue } from '@shared/emergency/logic'
import { parseSpec, EM_CATEGORIES, STATUS_LABELS, DISCLAIMER, type EmCard, type EmRecheck } from '@shared/emergency/types'

/** 危急處置（ADR-017）：離線可用；選卡 → 輸入數值、回答是非題 → 顯示符合級距的處置 */
const route = useRoute()
const router = useRouter()
void loadCache()

const cards = computed<EmCard[]>(() => visibleCards(data.tables.emergency
  .map(r => ({ uid: r.uid, name: r.name, spec: parseSpec(r.spec) }))
  .filter((c): c is EmCard => !!c.spec)))
const q = ref('')
const list = computed(() => searchCards(cards.value, q.value))
const groups = computed(() => [...new Set([...EM_CATEGORIES, ...list.value.map(c => c.spec.category)])]
  .map(cat => ({ cat, items: list.value.filter(c => c.spec.category === cat) })).filter(g => g.items.length))

const selected = computed(() => cards.value.find(c => c.uid === route.query.c) ?? null)
const spec = computed(() => selected.value?.spec ?? null)
const open = (c: EmCard) => router.push({ query: { c: c.uid } })

const inputs = ref<Record<string, string>>({})
const answers = ref<Record<string, boolean | undefined>>({})
const checked = ref(new Set<string>())
watch(() => route.query.c, () => { inputs.value = {}; answers.value = {}; checked.value = new Set(); timers.value = [] })

const formula = computed(() => spec.value ? measureFormula(spec.value) : null)
const value = computed(() => spec.value ? measureValue(spec.value, inputs.value) : null)
const result = computed(() => spec.value ? matchTiers(spec.value, value.value, answers.value) : null)
const unit = computed(() => spec.value?.measure?.unit ?? '')
const condQ = (id: string) => spec.value?.conditions.find(c => c.id === id)?.question ?? id
function answer(id: string, v: boolean) { answers.value = { ...answers.value, [id]: answers.value[id] === v ? undefined : v } }
function toggle(k: string) { const s = new Set(checked.value); if (s.has(k)) s.delete(k); else s.add(k); checked.value = s }

// ── 追蹤計時（時間到震動）─────────────────────────────────────
interface Timer { key: string; label: string; left: number; done: boolean }
const timers = ref<Timer[]>([])
let tick: ReturnType<typeof setInterval> | undefined
function startTimer(r: EmRecheck, owner: string) {
  const key = `${owner}|${r.label}`
  timers.value = [...timers.value.filter(t => t.key !== key), { key, label: r.label, left: r.minutes * 60, done: false }]
  tick ??= setInterval(() => {
    for (const t of timers.value) {
      if (!t.done && --t.left <= 0) { t.left = 0; t.done = true; navigator.vibrate?.([300, 150, 300, 150, 300]) }
    }
  }, 1000)
}
onUnmounted(() => clearInterval(tick))
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

usePullRefresh(() => pullRefresh(['emergency']))
</script>

<template>
  <div class="pad-tabbar accent-rose">
    <PageHeader :title="selected ? selected.name : '危急處置'" :back="!!selected" />

    <!-- 清單 -->
    <div v-if="!selected" class="p-4 space-y-4">
      <input v-model="q" placeholder="搜尋：喘、K、低血壓、血糖…" class="w-full h-12 px-4 rounded-2xl bg-surface border border-hairline text-base" />
      <p v-if="!cards.length" class="py-12 text-center text-sm text-muted">{{ data.refreshing ? '下載中…' : '還沒有危急處置卡，下拉更新' }}</p>
      <section v-for="g in groups" :key="g.cat">
        <p class="text-xs font-bold text-muted mb-2">{{ g.cat }}</p>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="c in g.items" :key="c.uid" @click="open(c)"
            class="h-16 px-3 rounded-2xl bg-danger/10 border border-danger/30 text-danger font-black text-base text-left">
            {{ c.name }}
            <span v-if="c.spec.status === 'literature'" class="block text-[10px] font-bold text-warning">文獻版</span>
          </button>
        </div>
      </section>
    </div>

    <!-- 卡片 -->
    <div v-else-if="spec" class="p-4 space-y-3">
      <div v-if="spec.status === 'literature'" class="p-3 rounded-xl bg-warning/15 border border-warning/40 text-xs font-bold text-warning">
        ⚠ {{ STATUS_LABELS.literature }}：依國際文獻整理，處置與劑量以醫囑及院內規範為準
      </div>
      <div v-if="spec.refs.length" class="flex flex-wrap gap-1.5">
        <a v-for="(r, i) in spec.refs" :key="r.url" :href="r.url" target="_blank" rel="noopener"
          class="px-2 py-1 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[11px] font-bold">📚 [{{ i + 1 }}] {{ r.title.length > 22 ? r.title.slice(0, 22) + '…' : r.title }}</a>
      </div>

      <div v-if="spec.kind === 'graded' && spec.measure" class="p-4 rounded-2xl bg-surface border border-hairline space-y-3">
        <template v-if="formula">
          <div class="grid grid-cols-2 gap-2">
            <label v-for="i in formula.inputs" :key="i.key" class="block">
              <span class="text-sm font-bold text-fg">{{ i.label }} <span class="text-muted font-normal">{{ i.unit }}</span></span>
              <input v-model="inputs[i.key]" inputmode="decimal"
                class="mt-1 w-full h-14 px-3 rounded-xl bg-sunken border border-hairline text-2xl font-mono font-black text-fg" />
            </label>
          </div>
          <p class="text-sm text-fg-secondary">{{ spec.measure.label }} ＝ <b class="text-2xl font-mono text-danger">{{ value ?? '—' }}</b> {{ spec.measure.unit }}</p>
        </template>
        <label v-else class="block">
          <span class="text-sm font-bold text-fg">{{ spec.measure.label }}（{{ spec.measure.unit }}）</span>
          <input v-model="inputs.value" inputmode="decimal" placeholder="輸入數值"
            class="mt-1 w-full h-16 px-4 rounded-xl bg-sunken border border-hairline text-3xl font-mono font-black text-fg" />
        </label>
        <div v-for="c in spec.conditions" :key="c.id" class="space-y-1.5">
          <p class="text-sm" :class="result?.needAnswers.includes(c.id) ? 'text-warning font-bold' : 'text-fg-secondary'">{{ c.question }}</p>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="v in [true, false]" :key="String(v)" @click="answer(c.id, v)"
              class="h-11 rounded-xl border font-bold"
              :class="answers[c.id] === v ? (v ? 'bg-danger text-white border-danger' : 'bg-fg-secondary text-surface border-fg-secondary') : 'bg-sunken border-hairline text-fg'">
              {{ v ? '是' : '否' }}
            </button>
          </div>
        </div>
      </div>

      <template v-if="spec.kind === 'graded' && result && value !== null">
        <p v-if="!Number.isFinite(value)" class="text-sm font-bold text-danger">數值格式錯誤</p>
        <p v-if="result.needAnswers.length" class="p-3 rounded-xl bg-warning/15 text-sm font-bold text-warning">請回答：{{ result.needAnswers.map(condQ).join('；') }}</p>
        <p v-if="result.uncovered" class="p-4 rounded-xl bg-surface border border-hairline text-sm text-fg-secondary">
          {{ value }} {{ unit }} 不在這張卡的處置範圍內；有疑慮請聯絡醫師。
        </p>
      </template>

      <div v-for="t in result?.matched ?? []" :key="t.id" class="p-4 rounded-2xl bg-surface border-2 border-danger/40 space-y-2">
        <p class="text-lg font-black text-danger">{{ t.title }} <span class="text-xs font-mono text-muted">{{ rangeText(t, unit) }}</span></p>
        <button v-for="(a, i) in t.actions" :key="i" @click="toggle(`${t.id}|${i}`)"
          class="w-full flex items-start gap-3 p-3 rounded-xl bg-sunken text-left" :class="checked.has(`${t.id}|${i}`) ? 'opacity-40 line-through' : ''">
          <span class="text-lg leading-none">{{ checked.has(`${t.id}|${i}`) ? '☑' : '☐' }}</span>
          <span class="text-base text-fg">{{ a }}</span>
        </button>
        <div v-for="m in t.meds" :key="m.name" class="p-3 rounded-xl border" :class="m.alert ? 'bg-danger/10 border-danger/50' : 'bg-accent/5 border-accent/30'">
          <p class="font-bold" :class="m.alert ? 'text-danger' : 'text-accent'">{{ m.alert ? '⚠ 高警訊 · ' : '' }}{{ m.name }}</p>
          <p class="text-sm text-fg-secondary">{{ m.dose }}</p>
        </div>
        <div v-if="t.rechecks.length" class="flex flex-wrap gap-2">
          <button v-for="r in t.rechecks" :key="r.label" @click="startTimer(r, t.id)"
            class="h-10 px-3 rounded-xl bg-success/15 border border-success/40 text-success text-sm font-bold">⏱ {{ r.label }} {{ r.minutes }} 分</button>
        </div>
        <p v-if="t.notes" class="text-xs text-muted">{{ t.notes }}</p>
        <p class="text-[11px] text-muted">📚 依據：
          <a v-for="r in tierRefs(spec, t)" :key="r.url" :href="r.url" target="_blank" rel="noopener" class="underline mr-2">[{{ spec.refs.indexOf(r) + 1 }}] {{ r.title }}</a>
        </p>
      </div>

      <div v-if="result && (result.neighbors.below || result.neighbors.above)" class="text-xs text-muted space-y-0.5">
        <p v-if="result.neighbors.below">數值較低的一級：{{ result.neighbors.below.title }}（{{ rangeText(result.neighbors.below, unit) }}）</p>
        <p v-if="result.neighbors.above">數值較高的一級：{{ result.neighbors.above.title }}（{{ rangeText(result.neighbors.above, unit) }}）</p>
      </div>

      <div v-if="spec.kind === 'general'" class="p-4 rounded-2xl bg-surface border border-hairline space-y-2">
        <button v-for="(a, i) in spec.general.actions" :key="i" @click="toggle(`g|${i}`)"
          class="w-full flex items-start gap-3 p-3 rounded-xl bg-sunken text-left" :class="checked.has(`g|${i}`) ? 'opacity-40 line-through' : ''">
          <span class="text-lg leading-none">{{ checked.has(`g|${i}`) ? '☑' : '☐' }}</span><span class="text-base text-fg">{{ a }}</span>
        </button>
        <div v-for="m in spec.general.meds" :key="m.name" class="p-3 rounded-xl border" :class="m.alert ? 'bg-danger/10 border-danger/50' : 'bg-accent/5 border-accent/30'">
          <p class="font-bold" :class="m.alert ? 'text-danger' : 'text-accent'">{{ m.alert ? '⚠ 高警訊 · ' : '' }}{{ m.name }}</p>
          <p class="text-sm text-fg-secondary">{{ m.dose }}</p>
        </div>
        <button v-for="r in spec.general.rechecks" :key="r.label" @click="startTimer(r, 'g')"
          class="h-10 px-3 mr-2 rounded-xl bg-success/15 border border-success/40 text-success text-sm font-bold">⏱ {{ r.label }} {{ r.minutes }} 分</button>
      </div>

      <p v-if="spec.notes" class="text-sm text-fg-secondary">📝 {{ spec.notes }}</p>
      <div v-if="spec.contacts.length" class="flex flex-wrap gap-2">
        <span v-for="c in spec.contacts" :key="c.label + c.ext" class="px-3 py-2 rounded-xl bg-surface border border-hairline text-sm">📞 {{ c.label }} <b class="font-mono text-danger">{{ c.ext }}</b></span>
      </div>

      <div class="pt-3 border-t border-hairline text-[11px] text-muted space-y-1">
        <p>依據：{{ spec.source || '—' }}<template v-if="spec.reviewer">　審核：{{ spec.reviewer }}</template><template v-if="spec.effective">　生效：{{ spec.effective }}</template></p>
        <p v-for="(r, i) in spec.refs" :key="r.url"><a :href="r.url" target="_blank" rel="noopener" class="underline">[{{ i + 1 }}] {{ r.title }}</a></p>
        <p class="font-bold">{{ DISCLAIMER }}</p>
      </div>
    </div>

    <!-- 計時（固定在底部） -->
    <div v-if="timers.length" class="fixed left-0 right-0 z-40 px-3 flex flex-wrap gap-2" :style="{ bottom: 'calc(var(--safe-b) + 4.5rem)' }">
      <div v-for="t in timers" :key="t.key" class="flex items-center gap-2 px-3 py-2 rounded-xl shadow-lg border"
        :class="t.done ? 'bg-danger text-white border-danger animate-pulse' : 'bg-surface border-hairline text-fg'">
        <span class="text-xs font-bold">{{ t.label }}</span>
        <span class="font-mono font-black text-lg">{{ t.done ? '時間到' : mmss(t.left) }}</span>
        <button @click="timers = timers.filter(x => x.key !== t.key)" class="text-xs opacity-70">✕</button>
      </div>
    </div>
  </div>
</template>
