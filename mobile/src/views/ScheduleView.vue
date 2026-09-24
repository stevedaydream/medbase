<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { gas, ApiError } from '../lib/api'
import { kvGet, kvSet } from '../lib/kv'
import { session } from '../lib/session'
import { toast } from '../lib/ui'
import { usePullRefresh } from '../lib/pull'
import { sched, syncSchedDocs, loadSchedCache, doc, setMyPrebook, markNoticesRead } from '../lib/sched'
import { colorOf } from '@shared/sched/palette'
import { dayTypeOf, daysIn, dateStr } from '@shared/sched/calendar'
import {
  BLANK_BY_DAYTYPE, CONSTRAINT_MARKS, cellKey,
  type ShiftDef, type PrebookDoc, type EstDoc, type HolidayDoc, type NoticeItem,
} from '@shared/sched/types'

/** 班表（ADR-015）：我的班、全部班表（已發布）、預班（開放中的月份，登記自己的） */
type Tab = 'mine' | 'all' | 'pre'
const tab = ref<Tab>('mine')
const DOW = ['日', '一', '二', '三', '四', '五', '六']
const today = new Date()
const ym = (y: number, m: number) => `${y}${String(m).padStart(2, '0')}`
function shiftMonth(y: number, m: number, d: number) { const t = new Date(y, m - 1 + d, 1); return { y: t.getFullYear(), m: t.getMonth() + 1 } }

onMounted(async () => { await loadSchedCache(); void syncSchedDocs() })

// ── 共用文件 ─────────────────────────────────────────────────────
const shifts = computed(() => doc<ShiftDef[]>('shifts') ?? [])
const holidays = computed<HolidayDoc>(() => doc<HolidayDoc>('holidays') ?? { days: {}, workdays: [], cny: [] })
const people = computed(() => doc<{ id: string; name: string }[]>('people') ?? [])
const nameOf = (id: string) => people.value.find(p => p.id === id)?.name ?? '?'
function codeStyle(code: string) {
  const s = shifts.value.find(x => x.code === code)
  if (!s) return (CONSTRAINT_MARKS as readonly string[]).includes(code) ? { color: 'var(--color-danger)' } : {}
  const c = colorOf(s.color)
  return { backgroundColor: c.bg, color: c.text }
}

// ── 已發布班表（我的班、全部班表）──────────────────────────────────
const sy = ref(today.getFullYear()), sm = ref(today.getMonth() + 1)
const sYM = computed(() => ym(sy.value, sm.value))
interface Row { name: string; days: (string | null)[] }
const rows = ref<Row[]>([])
const sLoading = ref(false)
const sError = ref('')
function moveS(d: number) { const t = shiftMonth(sy.value, sm.value, d); sy.value = t.y; sm.value = t.m }
const sDays = computed(() => new Date(sy.value, sm.value, 0).getDate())

function parseSheet(values: (string | number)[][]): Row[] {
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
  sLoading.value = !cached
  try {
    const r = await gas<{ data: (string | number)[][] }>('getSchedule', { sheetName: `Schedule_${sYM.value}` })
    rows.value = parseSheet(r.data ?? [])
    await kvSet(key, rows.value)
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'OFFLINE') && !cached) sError.value = (e as Error).message.includes('不存在') ? '' : (e as Error).message
    if (!cached) rows.value = []
  } finally {
    sLoading.value = false
  }
}
watch(sYM, loadSchedule, { immediate: true })

const myName = computed(() => sched.me?.name ?? session.user?.name ?? '')
const isMine = (name: string) => !!myName.value && name.replace(/^[A-Z]/, '').trim() === myName.value
const myRow = computed(() => rows.value.find(r => isMine(r.name)) ?? null)
const sortedRows = computed(() => [...rows.value].sort((a, b) => Number(isMine(b.name)) - Number(isMine(a.name))))
const isToday = (y: number, m: number, d: number) => y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate()
function dowClass(y: number, m: number, d: number) {
  const w = new Date(y, m - 1, d).getDay()
  return w === 0 ? 'text-danger' : w === 6 ? 'text-accent' : 'text-muted'
}
/** 空白格：平日 S1、週六 H3 */
function effective(y: number, m: number, d: number, v: string | null) {
  return v || BLANK_BY_DAYTYPE[dayTypeOf(ym(y, m), d, holidays.value)] || ''
}
const myStats = computed(() => {
  if (!myRow.value) return null
  const counts: Record<string, number> = {}
  let hours = 0
  for (let d = 1; d <= sDays.value; d++) {
    const c = effective(sy.value, sm.value, d, myRow.value.days[d - 1])
    if (!c) continue
    counts[c] = (counts[c] ?? 0) + 1
    hours += shifts.value.find(s => s.code === c)?.hours ?? 0
  }
  return { counts, hours }
})

const tableBox = ref<HTMLElement | null>(null)
watch([rows, tableBox, tab], async () => {
  if (tab.value !== 'all' || !tableBox.value || !rows.value.length || !isToday(sy.value, sm.value, today.getDate())) return
  await nextTick()
  tableBox.value.scrollLeft = Math.max(0, (today.getDate() - 3) * 36)
})

// ── 預班 ─────────────────────────────────────────────────────────
const openYms = computed(() => Object.keys(sched.docs).filter(k => k.startsWith('est:'))
  .map(k => doc<EstDoc>(k)!).filter(e => e.status === 'open').map(e => e.ym).sort())
const pYM = ref('')
watch(openYms, list => { if (!list.includes(pYM.value)) pYM.value = list[0] ?? '' }, { immediate: true })
const pIdx = computed(() => openYms.value.indexOf(pYM.value))
const est = computed(() => doc<EstDoc>(`est:${pYM.value}`))
const prebook = computed(() => doc<PrebookDoc>(`prebook:${pYM.value}`))
const pY = computed(() => Number(pYM.value.slice(0, 4))), pM = computed(() => Number(pYM.value.slice(4)))
const pDays = computed(() => pYM.value ? daysIn(pYM.value) : 0)
const offCodes = computed(() => new Set(shifts.value.filter(s => s.takesOff).map(s => s.code)))

function cellOf(personId: string, d: number) {
  return prebook.value?.cells[cellKey(personId, d)]
}
const myCell = (d: number) => sched.me ? cellOf(sched.me.id, d) : undefined
/** 當天所有人的預班（公開，唯讀） */
function dayEntries(d: number) {
  const out: { id: string; name: string; v: string; sys: boolean }[] = []
  for (const [k, c] of Object.entries(prebook.value?.cells ?? {})) {
    const [pid, day] = k.split('|')
    if (Number(day) !== d || !c.v) continue
    out.push({ id: pid, name: nameOf(pid), v: c.v, sys: c.src === 'sys' })
  }
  return out.sort((a, b) => Number(offCodes.value.has(b.v)) - Number(offCodes.value.has(a.v)) || a.name.localeCompare(b.name))
}
const offCount = (d: number) => dayEntries(d).filter(e => offCodes.value.has(e.v)).length
const myOffBooked = computed(() => {
  if (!sched.me) return 0
  let n = 0
  for (let d = 1; d <= pDays.value; d++) { const v = myCell(d)?.v; if (v && offCodes.value.has(v)) n++ }
  return n
})
const bookCodes = computed(() => [...shifts.value.filter(s => !s.reducesOff).map(s => s.code), ...CONSTRAINT_MARKS])
const inRoster = computed(() => !!sched.me && !!est.value && sched.me.id in (est.value.quotas ?? {}))

const pickDay = ref(0)
const saving = ref(false)
async function book(v: string | null) {
  const d = pickDay.value
  if (!d || !pYM.value) return
  if (sched.offline) { toast('目前離線，無法登記'); return }
  saving.value = true
  try {
    const r = await setMyPrebook(pYM.value, [{ day: d, v }])
    if (!r.ok) toast(r.error ?? '登記失敗')
    else if (r.rejected.length) toast(`未登記：${r.rejected.map(x => x.reason).join('、')}`)
    else toast(v ? `✓ ${pM.value}/${d} 已登記 ${v}` : `✓ ${pM.value}/${d} 已清除`)
    pickDay.value = 0
  } catch (e) {
    toast(e instanceof ApiError && e.code === 'OFFLINE' ? '目前離線，無法登記' : `登記失敗：${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

// ── 通知 ─────────────────────────────────────────────────────────
const notices = computed(() => [...(doc<NoticeItem[]>('notices') ?? [])].filter(n => n.personId === sched.me?.id).reverse())
const unread = computed(() => notices.value.filter(n => !n.read))
const showNotices = ref(false)
async function closeNotices() {
  showNotices.value = false
  try { await markNoticesRead(unread.value.map(n => n.id)) } catch { /* 離線時下次再標記 */ }
}

usePullRefresh(async () => {
  await Promise.all([loadSchedule(), syncSchedDocs()])
  return sched.offline ? '目前離線，顯示手機裡的資料' : sError.value || sched.error || '已更新：班表與預班'
})

const fmtTime = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
</script>

<template>
  <div class="accent-blue pad-tabbar">
    <PageHeader title="班表">
      <template #right>
        <button v-if="sched.me" class="relative w-9 h-9 text-lg" aria-label="通知" @click="showNotices = true">
          🔔<span v-if="unread.length" class="absolute top-0.5 right-0 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] leading-4 font-bold">{{ unread.length }}</span>
        </button>
      </template>
      <div class="px-4 pb-2">
        <div class="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="t in (['mine', 'all', 'pre'] as const)" :key="t" @click="tab = t"
            class="h-9 rounded-lg" :class="tab === t ? 'bg-surface text-accent shadow-sm' : 'text-muted'">
            {{ { mine: '我的班', all: '全部班表', pre: '預班' }[t] }}
          </button>
        </div>
      </div>
    </PageHeader>

    <!-- ── 我的班 ── -->
    <section v-if="tab === 'mine'" class="py-3">
      <div class="flex items-center justify-between px-4 mb-3">
        <button @click="moveS(-1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">‹</button>
        <span class="font-bold">{{ sy }} 年 {{ sm }} 月</span>
        <button @click="moveS(1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">›</button>
      </div>
      <p v-if="sLoading" class="py-12 text-center text-sm text-muted">載入中…</p>
      <p v-else-if="sError" class="py-12 text-center text-sm text-danger">{{ sError }}</p>
      <p v-else-if="!rows.length" class="py-12 text-center text-sm text-muted">此月尚無已發布的班表</p>
      <p v-else-if="!myRow" class="mx-4 p-4 rounded-2xl bg-surface border border-hairline text-sm text-fg-secondary">此月班表沒有你的班（{{ myName }}）</p>
      <template v-else>
        <div class="grid grid-cols-7 gap-1 px-3">
          <div v-for="w in DOW" :key="w" class="text-center text-xs text-muted py-1">{{ w }}</div>
          <div v-for="n in new Date(sy, sm - 1, 1).getDay()" :key="`b${n}`" />
          <div v-for="d in sDays" :key="d" class="aspect-square rounded-xl border flex flex-col items-center justify-center"
            :class="isToday(sy, sm, d) ? 'border-accent border-2' : 'border-hairline bg-surface'">
            <span class="text-xs" :class="dowClass(sy, sm, d)">{{ d }}</span>
            <span class="mt-0.5 min-w-8 px-1 rounded-md text-xs font-bold text-center" :style="codeStyle(effective(sy, sm, d, myRow.days[d - 1]))">
              {{ effective(sy, sm, d, myRow.days[d - 1]) || '·' }}
            </span>
          </div>
        </div>
        <div v-if="myStats" class="mx-4 mt-4 p-4 rounded-2xl bg-surface border border-hairline text-sm">
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <span v-for="(n, c) in myStats.counts" :key="c"><b>{{ c }}</b> {{ n }}</span>
          </div>
          <div class="mt-1 text-muted">總時數 {{ myStats.hours }} 小時</div>
        </div>
      </template>
    </section>

    <!-- ── 全部班表 ── -->
    <section v-else-if="tab === 'all'" class="py-3">
      <div class="flex items-center justify-between px-4 mb-3">
        <button @click="moveS(-1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">‹</button>
        <span class="font-bold">{{ sy }} 年 {{ sm }} 月</span>
        <button @click="moveS(1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">›</button>
      </div>
      <p v-if="sLoading" class="py-12 text-center text-sm text-muted">載入中…</p>
      <p v-else-if="!rows.length" class="py-12 text-center text-sm text-muted">此月尚無已發布的班表</p>
      <div v-else ref="tableBox" class="overflow-x-auto">
        <table class="text-sm border-collapse min-w-max">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-sunken px-3 py-2 text-left text-xs text-muted">姓名</th>
              <th v-for="d in sDays" :key="d" class="w-9 py-1 text-center text-xs" :class="[dowClass(sy, sm, d), isToday(sy, sm, d) ? 'bg-accent/15 rounded-t-lg' : '']">
                <div class="font-bold">{{ d }}</div>
                <div>{{ DOW[new Date(sy, sm - 1, d).getDay()] }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sortedRows" :key="r.name" class="border-t border-hairline" :class="isMine(r.name) ? 'bg-accent/10' : ''">
              <td class="sticky left-0 z-10 px-3 py-2 font-bold whitespace-nowrap" :class="isMine(r.name) ? 'bg-accent/10 text-accent' : 'bg-sunken text-fg'">{{ r.name }}</td>
              <td v-for="(c, i) in r.days.slice(0, sDays)" :key="i" class="text-center py-1.5" :class="isToday(sy, sm, i + 1) ? 'bg-accent/10' : ''">
                <span v-if="c" class="inline-block min-w-7 px-1 py-0.5 rounded-md text-xs font-bold" :style="codeStyle(c)">{{ c }}</span>
                <span v-else class="text-muted">·</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── 預班 ── -->
    <section v-else class="py-3">
      <p v-if="!sched.loaded || (sched.syncing && !openYms.length)" class="py-12 text-center text-sm text-muted">載入中…</p>
      <p v-else-if="!sched.me" class="mx-4 p-4 rounded-2xl bg-surface border border-hairline text-sm text-fg-secondary">
        你（HIS {{ session.user?.his }}）不在排班名單中，無法登記預班，請洽排班者。
      </p>
      <p v-else-if="!openYms.length" class="py-12 text-center text-sm text-muted">目前沒有開放預班的月份</p>
      <template v-else>
        <div class="flex items-center justify-between px-4 mb-2">
          <button @click="pYM = openYms[pIdx - 1]" :disabled="pIdx <= 0" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg disabled:opacity-30">‹</button>
          <div class="text-center">
            <div class="font-bold">{{ pY }} 年 {{ pM }} 月預班</div>
            <div class="text-xs font-bold text-success">● 開放中</div>
          </div>
          <button @click="pYM = openYms[pIdx + 1]" :disabled="pIdx >= openYms.length - 1" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg disabled:opacity-30">›</button>
        </div>

        <div v-if="!inRoster" class="mx-4 mb-2 p-3 rounded-xl bg-surface border border-hairline text-sm text-fg-secondary">你不在這個月份的排班名單中，只能查看。</div>
        <div v-else-if="est" class="mx-4 mb-3 p-3 rounded-2xl bg-surface border border-hairline text-sm">
          <div class="text-xs text-muted mb-1">我的預估配額（排班前可能變動）</div>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <span v-for="it in est.items" :key="it.id"><b>{{ it.name }}</b> {{ est.quotas[sched.me.id]?.[it.id] ?? 0 }}</span>
          </div>
          <div class="mt-1 text-xs text-muted">已登記休假 {{ myOffBooked }} 天</div>
        </div>

        <p class="px-4 mb-2 text-xs text-muted">點日期登記；灰底🔒＝系統預填（8-4、國定假日、週末輪序、春節）。每格下方為「已休／可休」。</p>
        <div class="grid grid-cols-7 gap-1 px-3">
          <div v-for="w in DOW" :key="w" class="text-center text-xs text-muted py-1">{{ w }}</div>
          <div v-for="n in new Date(pY, pM - 1, 1).getDay()" :key="`p${n}`" />
          <button v-for="d in pDays" :key="d" @click="pickDay = d"
            class="relative aspect-square rounded-xl border flex flex-col items-center justify-center"
            :class="myCell(d)?.src === 'sys' && myCell(d)?.v ? 'bg-raised border-hairline' : myCell(d)?.v ? 'bg-accent/15 border-accent/40' : 'bg-surface border-hairline'">
            <span class="text-xs" :class="dowClass(pY, pM, d)">{{ d }}</span>
            <span class="text-xs font-bold leading-tight" :class="(CONSTRAINT_MARKS as readonly string[]).includes(myCell(d)?.v ?? '') ? 'text-danger' : 'text-accent'">
              {{ myCell(d)?.v ?? '' }}<span v-if="myCell(d)?.src === 'sys' && myCell(d)?.v">🔒</span>
            </span>
            <span class="text-[10px] leading-none mt-0.5" :class="est && offCount(d) >= (est.offSlots[d - 1] ?? 0) ? 'text-danger font-bold' : 'text-muted'">
              {{ offCount(d) }}/{{ est?.offSlots[d - 1] ?? '-' }}
            </span>
          </button>
        </div>
      </template>
    </section>

    <!-- 預班底部選單 -->
    <Teleport to="body">
      <div v-if="pickDay" class="fixed inset-0 z-50 flex flex-col justify-end">
        <div class="absolute inset-0 bg-black/50" @click="pickDay = 0" />
        <div class="relative bg-surface rounded-t-3xl px-5 pt-5 space-y-4 max-h-[85vh] overflow-y-auto" :style="{ paddingBottom: 'calc(var(--safe-b) + 1.25rem)' }">
          <div class="flex items-center justify-between">
            <p class="font-bold">{{ pM }} 月 {{ pickDay }} 日（{{ DOW[new Date(pY, pM - 1, pickDay).getDay()] }}）
              <span v-if="holidays.days[dateStr(pYM, pickDay)]" class="text-danger text-sm">{{ holidays.days[dateStr(pYM, pickDay)] }}</span>
            </p>
            <span class="text-sm" :class="est && offCount(pickDay) >= (est.offSlots[pickDay - 1] ?? 0) ? 'text-danger font-bold' : 'text-muted'">
              已休 {{ offCount(pickDay) }}／可休 {{ est?.offSlots[pickDay - 1] ?? '-' }}
            </span>
          </div>

          <template v-if="inRoster">
            <p v-if="myCell(pickDay)?.src === 'sys' && myCell(pickDay)?.v" class="text-sm text-fg-secondary">🔒 系統預填：{{ myCell(pickDay)?.v }}（由輪序決定，無法在此修改）</p>
            <template v-else>
              <p v-if="sched.offline" class="text-sm text-warning font-bold">目前離線，無法登記</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="c in bookCodes" :key="c" @click="book(c)" :disabled="saving || sched.offline"
                  class="h-11 px-4 rounded-xl border text-sm font-bold disabled:opacity-30"
                  :class="myCell(pickDay)?.v === c ? 'ring-2 ring-accent' : 'border-hairline'" :style="codeStyle(c)">{{ c }}</button>
                <button @click="book(null)" :disabled="saving || sched.offline || !myCell(pickDay)?.v" class="h-11 px-4 rounded-xl border border-hairline text-sm text-muted disabled:opacity-30">清除</button>
              </div>
            </template>
          </template>

          <div>
            <p class="text-xs font-bold text-muted mb-1.5">當天預班（{{ dayEntries(pickDay).length }}）</p>
            <p v-if="!dayEntries(pickDay).length" class="text-sm text-muted">還沒有人登記</p>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="e in dayEntries(pickDay)" :key="e.id" class="px-2 py-1 rounded-lg text-xs bg-sunken border border-hairline"
                :class="e.id === sched.me?.id ? 'border-accent' : ''">
                {{ e.name }} <b :style="codeStyle(e.v)" class="px-1 rounded">{{ e.v }}</b><span v-if="e.sys">🔒</span>
              </span>
            </div>
          </div>
          <button @click="pickDay = 0" class="w-full h-12 rounded-xl bg-sunken text-fg font-bold">關閉</button>
        </div>
      </div>

      <!-- 通知 -->
      <div v-if="showNotices" class="fixed inset-0 z-50 flex flex-col justify-end">
        <div class="absolute inset-0 bg-black/50" @click="closeNotices" />
        <div class="relative bg-surface rounded-t-3xl px-5 pt-5 space-y-2 max-h-[80vh] overflow-y-auto" :style="{ paddingBottom: 'calc(var(--safe-b) + 1.25rem)' }">
          <p class="font-bold">排班通知</p>
          <p v-if="!notices.length" class="py-6 text-center text-sm text-muted">沒有通知</p>
          <div v-for="n in notices" :key="n.id" class="p-3 rounded-xl text-sm" :class="n.read ? 'text-muted' : 'bg-accent/10 text-fg'">
            {{ n.text }}<div class="text-xs text-muted mt-0.5">{{ fmtTime(n.at) }}</div>
          </div>
          <button @click="closeNotices" class="w-full h-12 rounded-xl bg-sunken text-fg font-bold">關閉</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
