<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { gas, ApiError } from '../lib/api'
import { kvGet, kvSet } from '../lib/kv'
import { session } from '../lib/session'
import { toast } from '../lib/ui'

/** 班表（唯讀，快取可離線）＋預約（第一版唯一可寫入的功能，身分由伺服器從憑證帶入） */
const tab = ref<'schedule' | 'booking'>('schedule')
const DOW = ['日', '一', '二', '三', '四', '五', '六']
const me = computed(() => session.user)

// ── 共用：月份 ───────────────────────────────────────────────────
function ym(y: number, m: number) { return `${y}${String(m).padStart(2, '0')}` }
function shiftMonth(y: number, m: number, d: number) {
  const t = new Date(y, m - 1 + d, 1)
  return { y: t.getFullYear(), m: t.getMonth() + 1 }
}
const today = new Date()

// ── 設定與班別 ───────────────────────────────────────────────────
const config = ref<Record<string, string>>({})
const shifts = ref<string[]>(['D', 'N', 'AM', 'Off'])
async function loadConfig() {
  try {
    const [c, s] = await Promise.all([gas<{ data: Record<string, string> }>('getConfig'), gas<{ data: string[] }>('getShifts')])
    config.value = c.data ?? {}
    if (s.data?.length) shifts.value = s.data
    await kvSet('schedule:config', { config: config.value, shifts: shifts.value })
  } catch {
    const cached = await kvGet<{ config: Record<string, string>; shifts: string[] }>('schedule:config')
    if (cached) { config.value = cached.config; shifts.value = cached.shifts }
  }
}
onMounted(loadConfig)

// ── 班表 ─────────────────────────────────────────────────────────
const sy = ref(today.getFullYear()), sm = ref(today.getMonth() + 1)
const sYM = computed(() => ym(sy.value, sm.value))
interface Row { name: string; days: (string | null)[] }
const rows = ref<Row[]>([])
const sLoading = ref(false)
const sError = ref('')
const sCachedOnly = ref(false)
function moveS(d: number) { const t = shiftMonth(sy.value, sm.value, d); sy.value = t.y; sm.value = t.m }
const sDays = computed(() => new Date(sy.value, sm.value, 0).getDate())

function parse(values: (string | number)[][]): Row[] {
  return values.slice(1).filter(r => String(r[0] ?? '').trim()).map(r => ({
    name: String(r[0]),
    days: Array.from({ length: 31 }, (_, i) => { const v = r[i + 1]; return v != null && v !== '' ? String(v) : null }),
  }))
}

async function loadSchedule() {
  sError.value = ''
  const key = `schedule:${sYM.value}`
  const cached = await kvGet<Row[]>(key)
  rows.value = cached ?? []
  sCachedOnly.value = false
  sLoading.value = !cached
  try {
    const r = await gas<{ data: (string | number)[][] }>('getSchedule', { sheetName: `Schedule_${sYM.value}` })
    rows.value = parse(r.data ?? [])
    await kvSet(key, rows.value)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'OFFLINE') sCachedOnly.value = !!cached
    else if (!cached) sError.value = (e as Error).message.includes('不存在') ? '' : (e as Error).message
    if (!cached) rows.value = []
  } finally {
    sLoading.value = false
  }
}
watch(sYM, loadSchedule, { immediate: true })

// 開啟本月班表時，橫向捲到今天附近（姓名欄固定在左，約 5 欄寬）
const tableBox = ref<HTMLElement | null>(null)
watch([rows, tableBox], async () => {
  if (!tableBox.value || !rows.value.length || sy.value !== today.getFullYear() || sm.value !== today.getMonth() + 1) return
  await nextTick()
  tableBox.value.scrollLeft = Math.max(0, (today.getDate() - 3) * 36)
})

const isMine = (name: string) => !!me.value && [me.value.staffName, me.value.name].includes(name.trim())
const sortedRows = computed(() => [...rows.value].sort((a, b) => Number(isMine(b.name)) - Number(isMine(a.name))))
const isToday = (d: number) => sy.value === today.getFullYear() && sm.value === today.getMonth() + 1 && d === today.getDate()
function dowClass(y: number, m: number, d: number) {
  const w = new Date(y, m - 1, d).getDay()
  return w === 0 ? 'text-danger' : w === 6 ? 'text-accent' : 'text-muted'
}

// ── 預約 ─────────────────────────────────────────────────────────
interface Vote { v1: string | null; v2: string | null; v3: string | null }
interface RequestRow { code: string; name: string; days: Vote[] }
const bookingOpen = computed(() => String(config.value.booking_open) === 'true')
const bInit = computed(() => {
  const s = config.value.booking_month
  return s && /^\d{6}$/.test(s) ? { y: +s.slice(0, 4), m: +s.slice(4) } : shiftMonth(today.getFullYear(), today.getMonth() + 1, 1)
})
const by = ref(0), bm = ref(0)
watch(bInit, v => { by.value = v.y; bm.value = v.m }, { immediate: true })
const bYM = computed(() => ym(by.value, bm.value))
function moveB(d: number) { const t = shiftMonth(by.value, bm.value, d); by.value = t.y; bm.value = t.m }
const bDays = computed(() => new Date(by.value, bm.value, 0).getDate())

const votes = ref<Record<number, Vote>>({})
const draftKey = computed(() => `mb_draft_${bYM.value}`)
watch(draftKey, k => { try { votes.value = JSON.parse(localStorage.getItem(k) ?? '{}') } catch { votes.value = {} } }, { immediate: true })
function persist() { localStorage.setItem(draftKey.value, JSON.stringify(votes.value)) }

const others = ref<RequestRow[]>([])
const bLoading = ref(false)
async function loadRequests() {
  if (tab.value !== 'booking') return
  bLoading.value = true
  try {
    const r = await gas<{ data: RequestRow[] }>('getRequests', { yyyyMM: bYM.value })
    const mine = (r.data ?? []).find(x => x.code === me.value?.staffCode)
    others.value = (r.data ?? []).filter(x => x.code !== me.value?.staffCode)
    // 沒有草稿時，帶入已送出的內容
    if (mine && !localStorage.getItem(draftKey.value)) {
      votes.value = Object.fromEntries(mine.days.map((v, i) => [i + 1, v]).filter(([, v]) => (v as Vote).v1))
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'OFFLINE')) toast((e as Error).message)
  } finally {
    bLoading.value = false
  }
}
watch([tab, bYM], loadRequests)

const pickerDay = ref(0)
function openPicker(d: number) {
  if (!bookingOpen.value) return
  if (!votes.value[d]) votes.value[d] = { v1: null, v2: null, v3: null }
  pickerDay.value = d
}
function closePicker() { pickerDay.value = 0; persist() }
function setVote(k: 'v1' | 'v2' | 'v3', code: string | null) {
  const v = votes.value[pickerDay.value]
  v[k] = code
  if (k === 'v1' && !code) { v.v2 = null; v.v3 = null }
}
const filled = computed(() => Object.values(votes.value).filter(v => v.v1).length)

const submitting = ref(false)
async function submit() {
  submitting.value = true
  try {
    const days = Array.from({ length: 31 }, (_, i) => votes.value[i + 1] ?? { v1: null, v2: null, v3: null })
    await gas('saveRequest', { yyyyMM: bYM.value, days })
    localStorage.removeItem(draftKey.value)
    toast('✓ 預約已送出')
    loadRequests()
  } catch (e) {
    toast(`送出失敗：${(e as Error).message}`)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="accent-blue pad-tabbar">
    <PageHeader title="班表">
      <div class="px-4 pb-2">
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="t in (['schedule', 'booking'] as const)" :key="t" @click="tab = t"
            class="h-9 rounded-lg" :class="tab === t ? 'bg-surface text-accent shadow-sm' : 'text-muted'">
            {{ t === 'schedule' ? '班表' : '預約班別' }}
          </button>
        </div>
      </div>
    </PageHeader>

    <!-- ── 班表 ── -->
    <section v-if="tab === 'schedule'" class="py-3">
      <div class="flex items-center justify-between px-4 mb-3">
        <button @click="moveS(-1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">‹</button>
        <span class="font-bold">{{ sy }} 年 {{ sm }} 月</span>
        <button @click="moveS(1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">›</button>
      </div>
      <p v-if="sCachedOnly" class="mx-4 mb-2 text-xs text-warning">離線中，顯示手機上的班表</p>
      <p v-if="sLoading" class="py-12 text-center text-sm text-muted">載入中…</p>
      <p v-else-if="sError" class="py-12 text-center text-sm text-danger">{{ sError }}</p>
      <p v-else-if="!rows.length" class="py-12 text-center text-sm text-muted">此月尚無已發布的班表</p>
      <div v-else ref="tableBox" class="overflow-x-auto">
        <table class="text-sm border-collapse min-w-max">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-sunken px-3 py-2 text-left text-xs text-muted">姓名</th>
              <th v-for="d in sDays" :key="d" class="w-9 py-1 text-center text-xs" :class="[dowClass(sy, sm, d), isToday(d) ? 'bg-accent/15 rounded-t-lg' : '']">
                <div class="font-bold">{{ d }}</div>
                <div>{{ DOW[new Date(sy, sm - 1, d).getDay()] }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sortedRows" :key="r.name" class="border-t border-hairline" :class="isMine(r.name) ? 'bg-accent/10' : ''">
              <td class="sticky left-0 z-10 px-3 py-2 font-bold whitespace-nowrap" :class="isMine(r.name) ? 'bg-accent/10 text-accent' : 'bg-sunken text-fg'">{{ r.name }}</td>
              <td v-for="(c, i) in r.days.slice(0, sDays)" :key="i" class="text-center py-1.5" :class="isToday(i + 1) ? 'bg-accent/10' : ''">
                <span v-if="c" class="inline-block min-w-7 px-1 py-0.5 rounded-md text-xs font-bold bg-surface border border-hairline text-fg">{{ c }}</span>
                <span v-else class="text-muted">·</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── 預約 ── -->
    <section v-else class="py-3">
      <div v-if="!me?.staffCode" class="mx-4 p-4 rounded-2xl bg-surface border border-hairline text-sm text-fg-secondary">
        你（HIS {{ me?.his }}）不在排班名單中，無法預約班別。如需預約，請排班負責人在排班系統的人員資料填入你的員工編號。
      </div>
      <template v-else>
        <div class="flex items-center justify-between px-4 mb-2">
          <button @click="moveB(-1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">‹</button>
          <div class="text-center">
            <div class="font-bold">{{ by }} 年 {{ bm }} 月預約</div>
            <div class="text-xs font-bold" :class="bookingOpen ? 'text-success' : 'text-muted'">{{ bookingOpen ? '● 開放中' : '○ 已關閉' }}</div>
          </div>
          <button @click="moveB(1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">›</button>
        </div>
        <p class="px-4 mb-2 text-xs text-muted">點日期設定志願。格內為第 1 志願，右下紫點＝第 2 志願、左下橘點＝第 3 志願。</p>

        <div class="grid grid-cols-7 gap-1 px-3">
          <div v-for="w in DOW" :key="w" class="text-center text-xs text-muted py-1">{{ w }}</div>
          <div v-for="n in new Date(by, bm - 1, 1).getDay()" :key="`b${n}`" />
          <button v-for="d in bDays" :key="d" @click="openPicker(d)" :disabled="!bookingOpen"
            class="relative aspect-square rounded-xl border text-sm flex flex-col items-center justify-center"
            :class="votes[d]?.v1 ? 'bg-accent/15 border-accent/40' : 'bg-surface border-hairline'">
            <span class="text-xs" :class="dowClass(by, bm, d)">{{ d }}</span>
            <span class="font-bold text-accent leading-tight">{{ votes[d]?.v1 ?? '' }}</span>
            <span v-if="votes[d]?.v2" class="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-500" />
            <span v-if="votes[d]?.v3" class="absolute bottom-1 left-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
          </button>
        </div>

        <details class="mx-4 mt-4 rounded-2xl bg-surface border border-hairline">
          <summary class="px-4 py-3 text-sm font-bold text-fg-secondary">其他人已送出的預約（{{ others.length }}）{{ bLoading ? '…' : '' }}</summary>
          <div class="overflow-x-auto pb-2">
            <table class="text-xs border-collapse min-w-max">
              <tbody>
                <tr v-for="o in others" :key="o.code" class="border-t border-hairline">
                  <td class="sticky left-0 bg-surface px-3 py-1.5 font-bold whitespace-nowrap">{{ o.name }}</td>
                  <td v-for="d in bDays" :key="d" class="w-8 text-center py-1.5">{{ o.days[d - 1]?.v1 ?? '·' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>

        <div class="fixed inset-x-0 z-20 px-4 py-3 bg-surface/95 backdrop-blur border-t border-hairline flex items-center gap-3"
          :style="{ bottom: 'calc(var(--tabbar-h) + var(--safe-b))' }">
          <span class="flex-1 text-sm text-muted">已填 {{ filled }} 天</span>
          <button @click="submit" :disabled="!bookingOpen || submitting || !filled"
            class="h-11 px-5 rounded-xl bg-accent text-white font-bold disabled:opacity-40">
            {{ submitting ? '送出中…' : '確認送出' }}
          </button>
        </div>
        <div class="h-20" />
      </template>
    </section>

    <!-- 志願選擇 -->
    <Teleport to="body">
      <div v-if="pickerDay" class="fixed inset-0 z-50 flex flex-col justify-end">
        <div class="absolute inset-0 bg-black/50" @click="closePicker" />
        <div class="relative bg-surface rounded-t-3xl px-5 pt-5 space-y-4" :style="{ paddingBottom: 'calc(var(--safe-b) + 1.25rem)' }">
          <div class="flex items-center justify-between">
            <p class="font-bold">{{ bm }} 月 {{ pickerDay }} 日（{{ DOW[new Date(by, bm - 1, pickerDay).getDay()] }}）</p>
            <button @click="votes[pickerDay] = { v1: null, v2: null, v3: null }" class="text-sm text-danger">清除本日</button>
          </div>
          <div v-for="(k, i) in (['v1', 'v2', 'v3'] as const)" :key="k">
            <p class="text-xs font-bold mb-1.5" :class="['text-accent', 'text-violet-500', 'text-amber-500'][i]">第 {{ i + 1 }} 志願</p>
            <div class="flex flex-wrap gap-2">
              <button v-for="s in shifts" :key="s" @click="setVote(k, s)" :disabled="i > 0 && !votes[pickerDay]?.v1"
                class="h-10 px-4 rounded-xl border text-sm font-bold disabled:opacity-30"
                :class="votes[pickerDay]?.[k] === s ? 'bg-accent text-white border-accent' : 'bg-sunken border-hairline text-fg'">{{ s }}</button>
              <button @click="setVote(k, null)" class="h-10 px-3 rounded-xl border border-hairline text-sm text-muted">✕</button>
            </div>
          </div>
          <button @click="closePicker" class="w-full h-12 rounded-xl bg-accent text-white font-bold">完成</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
