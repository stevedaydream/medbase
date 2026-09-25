<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { swapApi, ApiError } from '../lib/api'
import { toast } from '../lib/ui'
import { daysIn } from '@shared/sched/calendar'
import { KIND_LABELS, type EmpSwapKind, type SwapReqDay } from '@shared/sched/empSwap'

/** 員工換班申請（ADR-016）：選方式、日子（可多天）、對象，伺服器預覽檢核後送出 */
const props = defineProps<{
  ym: string
  mode: 'published' | 'open'
  me: string
  day: number
  people: { id: string; name: string }[]
  code: (personId: string, day: number) => string
  codeStyle: (c: string) => Record<string, string | undefined>
  today: string
}>()
const emit = defineEmits<{ close: []; done: [] }>()

const DOW = ['日', '一', '二', '三', '四', '五', '六']
const y = computed(() => Number(props.ym.slice(0, 4)))
const m = computed(() => Number(props.ym.slice(4)))
const nd = computed(() => daysIn(props.ym))
const lead = computed(() => new Date(y.value, m.value - 1, 1).getDay())
const nameOf = (id: string) => props.people.find(p => p.id === id)?.name ?? '?'

const kind = ref<EmpSwapKind>('same')
const give = ref<number[]>([props.day])
const take = ref<number[]>([])
const b = ref('')
const note = ref('')

const future = (d: number) => props.mode === 'open' || `${props.ym}${String(d).padStart(2, '0')}` >= props.today
const canPick = (id: string, d: number) => future(d) && (props.mode === 'published' || !!props.code(id, d))
function toggle(which: 'give' | 'take', d: number) {
  const list = which === 'give' ? give : take
  list.value = list.value.includes(d) ? list.value.filter(x => x !== d) : [...list.value, d].sort((p, q) => p - q)
}
watch(kind, k => { if (k !== 'cross') take.value = [] })
watch(b, () => { take.value = [] })

// ── 伺服器預覽 ────────────────────────────────────────────────
const preview = ref<{ hard: string[]; soft: string[]; days: SwapReqDay[]; give: number[]; take: number[] } | null>(null)
const pvError = ref('')
const loading = ref(false)
const ready = computed(() => !!b.value && give.value.length > 0 && (kind.value !== 'cross' || take.value.length > 0))
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
watch([kind, give, take, b], () => {
  preview.value = null; pvError.value = ''
  clearTimeout(timer)
  if (!ready.value) return
  timer = setTimeout(runPreview, 400)
})
const args = () => ({ ym: props.ym, kind: kind.value, b: b.value, give: give.value, take: take.value, note: note.value.trim() })
async function runPreview() {
  const n = ++seq
  loading.value = true
  try {
    const r = await swapApi<{ hard: string[]; soft: string[]; days: SwapReqDay[]; give: number[]; take: number[] }>('preview', args())
    if (n === seq) preview.value = r
  } catch (e) {
    if (n === seq) pvError.value = e instanceof ApiError && e.code === 'OFFLINE' ? '目前離線，無法換班' : (e as Error).message
  } finally {
    if (n === seq) loading.value = false
  }
}

const sending = ref(false)
async function send() {
  sending.value = true
  try {
    await swapApi('create', args())
    toast(`已送出，等 ${nameOf(b.value)} 同意`)
    emit('done')
  } catch (e) {
    const d = e instanceof ApiError ? (e.data.hard as string[] | undefined) : undefined
    if (d?.length && preview.value) preview.value.hard = d
    else toast((e as Error).message)
  } finally {
    sending.value = false
  }
}
const md = (d: number) => `${m.value}/${d}`
/** 換後：已發布＝整天對調；預班＝只移動系統預填 */
function after(x: SwapReqDay): [string, string] {
  if (props.mode === 'published') return [x.bCode, x.aCode]
  const g = preview.value?.give.includes(x.day), t = preview.value?.take.includes(x.day)
  return [t ? x.bCode : g ? '' : x.aCode, g ? x.aCode : t ? '' : x.bCode]
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end">
    <div class="absolute inset-0 bg-black/50" @click="emit('close')" />
    <div class="relative bg-surface rounded-t-3xl px-5 pt-5 space-y-4 max-h-[90vh] overflow-y-auto text-sm" :style="{ paddingBottom: 'calc(var(--safe-b) + 1.25rem)' }">
      <p class="font-bold text-base">找人換班 · {{ y }}/{{ m }}{{ mode === 'open' ? '（系統預填）' : '' }}</p>

      <div class="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 font-bold">
        <button v-for="k in (['same', 'cross', 'cover'] as const)" :key="k" @click="kind = k"
          class="h-9 rounded-lg" :class="kind === k ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ KIND_LABELS[k] }}</button>
      </div>
      <p class="text-xs text-muted">
        {{ kind === 'same' ? '選的每一天，你和對方的班對調。' : kind === 'cross' ? '你選的日子給對方上，對方選的日子給你上。' : '對方替你上選的日子，不換回來；月底沒平會記成你欠對方。' }}
        可以一次選很多天，全部成功或全部不換。
      </p>

      <div>
        <p class="text-xs font-bold text-muted mb-1">{{ kind === 'cross' ? '我換出的日子' : '日子' }}（{{ give.length }}）</p>
        <div class="grid grid-cols-7 gap-1">
          <div v-for="w in DOW" :key="w" class="text-center text-[10px] text-muted">{{ w }}</div>
          <div v-for="n in lead" :key="`g${n}`" />
          <button v-for="d in nd" :key="d" :disabled="!canPick(me, d)" @click="toggle('give', d)"
            class="h-11 rounded-lg border flex flex-col items-center justify-center disabled:opacity-25"
            :class="give.includes(d) ? 'border-accent border-2 bg-accent/10' : 'border-hairline'">
            <span class="text-[10px] text-muted">{{ d }}</span>
            <span class="text-[10px] font-bold px-1 rounded" :style="codeStyle(code(me, d))">{{ code(me, d) || '·' }}</span>
          </button>
        </div>
      </div>

      <div>
        <p class="text-xs font-bold text-muted mb-1">對象</p>
        <select v-model="b" class="w-full h-11 px-3 rounded-xl bg-sunken border border-hairline">
          <option value="">選擇同事…</option>
          <option v-for="p in people" :key="p.id" :value="p.id">
            {{ p.name }}{{ give.length ? `（${give.map(d => code(p.id, d) || '空白').join('／')}）` : '' }}
          </option>
        </select>
      </div>

      <div v-if="kind === 'cross' && b">
        <p class="text-xs font-bold text-muted mb-1">{{ nameOf(b) }} 換給我的日子（{{ take.length }}）</p>
        <div class="grid grid-cols-7 gap-1">
          <div v-for="w in DOW" :key="w" class="text-center text-[10px] text-muted">{{ w }}</div>
          <div v-for="n in lead" :key="`t${n}`" />
          <button v-for="d in nd" :key="d" :disabled="!canPick(b, d) || give.includes(d)" @click="toggle('take', d)"
            class="h-11 rounded-lg border flex flex-col items-center justify-center disabled:opacity-25"
            :class="take.includes(d) ? 'border-accent border-2 bg-accent/10' : 'border-hairline'">
            <span class="text-[10px] text-muted">{{ d }}</span>
            <span class="text-[10px] font-bold px-1 rounded" :style="codeStyle(code(b, d))">{{ code(b, d) || '·' }}</span>
          </button>
        </div>
      </div>

      <input v-model="note" maxlength="100" placeholder="原因（選填）" class="w-full h-11 px-3 rounded-xl bg-sunken border border-hairline" />

      <div v-if="ready" class="rounded-xl border border-hairline p-3 space-y-2">
        <p v-if="loading" class="text-muted">檢查中…</p>
        <p v-else-if="pvError" class="text-danger font-bold">{{ pvError }}</p>
        <template v-else-if="preview">
          <table class="w-full text-xs">
            <thead><tr class="text-muted"><th class="text-left">日期</th><th>我</th><th>{{ nameOf(b) }}</th></tr></thead>
            <tbody>
              <tr v-for="x in preview.days" :key="x.day">
                <td>{{ md(x.day) }}</td>
                <td class="text-center">{{ x.aCode || '空白' }} → <b>{{ after(x)[0] || '空白' }}</b></td>
                <td class="text-center">{{ x.bCode || '空白' }} → <b>{{ after(x)[1] || '空白' }}</b></td>
              </tr>
            </tbody>
          </table>
          <p v-for="h in preview.hard" :key="h" class="text-danger font-bold">⛔ {{ h }}</p>
          <p v-for="w in preview.soft" :key="w" class="text-warning">⚠ {{ w }}</p>
          <p v-if="!preview.hard.length && !preview.soft.length" class="text-success">✓ 檢核通過</p>
        </template>
      </div>

      <div class="flex gap-2">
        <button @click="emit('close')" class="flex-1 h-12 rounded-xl bg-sunken font-bold">取消</button>
        <button :disabled="!preview || !!preview.hard.length || sending" @click="send"
          class="flex-1 h-12 rounded-xl bg-accent text-white font-bold disabled:opacity-40">送出申請</button>
      </div>
    </div>
  </div>
</template>
