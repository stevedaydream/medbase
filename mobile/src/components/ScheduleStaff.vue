<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { sched, doc } from '../lib/sched'
import { toast } from '../lib/ui'
import {
  snapshot, lockOf, hasLock, acquireLock, releaseLock, startMonth, publishMonth, revertMonth,
  editCells, createSwap, deleteSwap, settleDebt, addPrefillSwap, removePrefillSwap, LockedError,
} from '../lib/schedOps'
import { colorOf } from '@shared/sched/palette'
import { daysIn, dowOf, dayTypeOf, dateStr, prevYm } from '@shared/sched/calendar'
import { computeQuotas } from '@shared/sched/engine/quota'
import { cellFnOf } from '@shared/sched/engine/prefill'
import { needOf } from '@shared/sched/engine/staffing'
import { validate, personStats, dayStats, RULE_LABELS, type Issue, type GridCtx, type RuleCode } from '@shared/sched/engine/validate'
import { monthTargets, revertDeadline, prefillSwapCells, prefillSwapCandidates, prefillSwapCautions } from '@shared/sched/ops'
import {
  CONSTRAINT_MARKS, cellKey, DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES,
  type MonthDoc, type PrebookDoc, type ShiftDef, type QuotaItem, type RuleParams, type HolidayDoc, type DebtRec, type LogDoc,
} from '@shared/sched/types'

/** 排班者手機排班（ADR-015）：全表／單日／單人三種檢視＋底部抽屜；流程與桌機共用 ops */
const DOW = ['日', '一', '二', '三', '四', '五', '六']
const STATUS = { open: '開放預班', scheduling: '排班中', published: '已發布' } as const

const yms = computed(() => Object.keys(sched.docs).filter(k => k.startsWith('month:')).map(k => k.slice(6)).sort())
function defaultYm() {
  const list = yms.value
  const st = (y: string) => doc<MonthDoc>(`month:${y}`)?.status
  return list.find(y => st(y) === 'scheduling') ?? list.find(y => st(y) === 'open') ?? list[list.length - 1] ?? ''
}
const ym = ref(defaultYm())
watch(yms, () => { if (!yms.value.includes(ym.value)) ym.value = defaultYm() })
const month = computed(() => doc<MonthDoc>(`month:${ym.value}`))
const prebook = computed(() => doc<PrebookDoc>(`prebook:${ym.value}`))
const shifts = computed(() => doc<ShiftDef[]>('shifts') ?? DEFAULT_SHIFTS)
const items = computed(() => (doc<QuotaItem[]>('quotaItems') ?? DEFAULT_QUOTA_ITEMS).filter(i => i.enabled))
const rules = computed(() => doc<RuleParams>('rules') ?? DEFAULT_RULES)
const holidays = computed(() => doc<HolidayDoc>('holidays') ?? { days: {}, workdays: [], cny: [] })
const people = computed(() => doc<{ id: string; name: string }[]>('people') ?? [])
const nameOf = (id: string) => people.value.find(p => p.id === id)?.name ?? '?'
const nd = computed(() => ym.value ? daysIn(ym.value) : 0)
const days = computed(() => Array.from({ length: nd.value }, (_, i) => i + 1))
const rows = computed(() => (month.value?.roster ?? []).filter(r => r.flags.active))

type View = 'grid' | 'day' | 'person'
const view = ref<View>('grid')
const postEdit = ref(false)
watch(ym, () => { postEdit.value = false })
const layer = computed<'pre' | 'sched'>(() => month.value?.status === 'open' ? 'pre' : 'sched')
const mine = computed(() => hasLock(ym.value))
const lock = computed(() => lockOf(ym.value))
const editable = computed(() => {
  const m = month.value
  if (!m) return false
  if (layer.value === 'pre') return m.status === 'open'
  return mine.value && (m.status === 'scheduling' || (m.status === 'published' && postEdit.value))
})

// ── 資料與檢核 ────────────────────────────────────────────────
const isMark = (v: string) => (CONSTRAINT_MARKS as readonly string[]).includes(v)
function read(id: string, d: number) {
  if (layer.value === 'pre') return prebook.value?.cells[cellKey(id, d)]?.v ?? ''
  return month.value?.schedule[id]?.[d - 1] ?? ''
}
const cellFn = computed(() => (id: string, d: number) => { const v = read(id, d); return isMark(v) ? '' : v })
const quota = computed(() => month.value
  ? computeQuotas({ month: month.value, holidays: holidays.value, shifts: shifts.value, items: doc<QuotaItem[]>('quotaItems') ?? DEFAULT_QUOTA_ITEMS, cell: cellFnOf(month.value, prebook.value) })
  : null)
const targets = computed(() => month.value ? monthTargets(snapshot(), month.value) : {})
const ctx = computed<GridCtx | null>(() => {
  const m = month.value
  if (!m || !quota.value) return null
  const pm = doc<MonthDoc>(`month:${prevYm(m.ym)}`)
  const prevTail = pm ? Object.fromEntries(Object.entries(pm.schedule).map(([id, a]) => [id, a.slice(-7)])) : undefined
  return {
    month: m, prebook: prebook.value, holidays: holidays.value, shifts: shifts.value, items: items.value, rules: rules.value,
    cell: cellFn.value, prevTail, targets: targets.value, offSlots: quota.value.offSlots, name: nameOf,
    approved: new Set((m.changeLog ?? []).filter(c => c.approved).map(c => c.personId)),
  }
})
const issues = computed<Issue[]>(() => ctx.value ? validate(ctx.value) : [])
const badCells = computed(() => new Set(issues.value.filter(i => i.personId && i.day).map(i => `${i.personId}|${i.day}`)))
const stats = (id: string) => ctx.value ? personStats(ctx.value, id) : null
const dstat = (d: number) => ctx.value ? dayStats(ctx.value, d) : { D: 0, N: 0, S1: 0, off: 0 }
const need = (d: number) => month.value ? needOf(month.value, d, holidays.value) : { D: 0, N: 0, S1: 0 }

function codeStyle(code: string) {
  const s = shifts.value.find(x => x.code === code)
  if (!s) return isMark(code) ? { color: 'var(--color-danger)' } : {}
  const c = colorOf(s.color)
  return { backgroundColor: c.bg, color: c.text }
}
const isRest = (d: number) => dayTypeOf(ym.value, d, holidays.value) !== 'weekday'
const isSys = (id: string, d: number) => { const c = prebook.value?.cells[cellKey(id, d)]; return c?.src === 'sys' && !!c.v && read(id, d) === c.v }
const changed = computed(() => new Set((month.value?.changeLog ?? []).map(c => `${c.personId}|${c.day}`)))

// ── 單日／單人 ────────────────────────────────────────────────
const dayIdx = ref(1)
watch(ym, () => { dayIdx.value = 1 })
const personId = ref('')
watch(rows, r => { if (!r.some(x => x.personId === personId.value)) personId.value = r[0]?.personId ?? '' }, { immediate: true })

// ── 選單與編輯 ────────────────────────────────────────────────
const pick = ref<{ personId: string; day: number } | null>(null)
const menuCodes = computed(() => layer.value === 'pre'
  ? [...shifts.value.filter(s => !s.reducesOff).map(s => s.code), ...CONSTRAINT_MARKS]
  : shifts.value.map(s => s.code))
function openPick(id: string, d: number) {
  pick.value = { personId: id, day: d }
}
const reasonFor = ref<{ personId: string; day: number; value: string } | null>(null)
const reasonText = ref('')
const reasonApproved = ref(false)
const busy = ref(false)

async function setCode(value: string) {
  const p = pick.value
  if (!p) return
  if (!editable.value) { toast('此月份目前不可修改'); return }
  if (layer.value === 'pre' && isSys(p.personId, p.day)) { toast('系統預填不可修改'); return }
  if (month.value?.status === 'published') { reasonFor.value = { ...p, value }; pick.value = null; return }
  await doEdit([{ ...p, value }])
}
async function doEdit(edits: { personId: string; day: number; value: string }[], reason?: { text: string; approved: boolean }) {
  busy.value = true
  try {
    const n = await editCells(ym.value, layer.value, edits, reason)
    if (!n) toast('沒有變更')
    pick.value = null
  } catch (e) { toast((e as Error).message) } finally { busy.value = false }
}
async function confirmReason() {
  const r = reasonFor.value
  if (!r) return
  if (!reasonText.value.trim()) { toast('請填寫原因'); return }
  await doEdit([r], { text: reasonText.value, approved: reasonApproved.value })
  toast('已修改並重新發布到手機')
  reasonFor.value = null; reasonText.value = ''; reasonApproved.value = false
}

// ── 換班 ─────────────────────────────────────────────────────
// ── 預填換人（開放預班的系統預填格）──────────────────────────
const pSwap = ref<{ from: string; cells: { day: number; code: string }[] } | null>(null)
const pSwapTo = ref('')
const pSwapNote = ref('')
const canPrefillSwap = (id: string, d: number) => layer.value === 'pre' && month.value?.status === 'open' && isSys(id, d)
function openPrefillSwap(id: string, d: number) {
  const cells = prefillSwapCells(snapshot(), ym.value, id, d)
  if (!cells.length) return
  pSwap.value = { from: id, cells }
  pSwapTo.value = ''; pSwapNote.value = ''
  pick.value = null
}
const pSwapCandidates = computed(() => pSwap.value && month.value ? prefillSwapCandidates(month.value, pSwap.value.cells[0].code, pSwap.value.from) : [])
const cautionOf = (id: string) => {
  const c = pSwap.value ? prefillSwapCautions(snapshot(), ym.value, id, pSwap.value.cells) : []
  return c.length ? `⚠ ${c.join('、')}` : ''
}
async function doPrefillSwap() {
  const p = pSwap.value
  if (!p || !pSwapTo.value) return
  await run(() => addPrefillSwap(ym.value, p.from, pSwapTo.value, p.cells, pSwapNote.value.trim()), '已換人，並通知雙方')
  pSwap.value = null
}
const prefillGroups = computed(() => {
  const g = new Map<string, { group: string; days: string; code: string; from: string; to: string; note: string }>()
  for (const x of month.value?.prefillSwaps ?? []) {
    const cur = g.get(x.group)
    const d = `${mD.value}/${x.day}`
    if (cur) cur.days += `、${d}`
    else g.set(x.group, { group: x.group, days: d, code: x.code, from: x.from, to: x.to, note: x.note })
  }
  return [...g.values()]
})

const swapFrom = ref<{ personId: string; day: number } | null>(null)
const swapWith = ref('')
const swapNote = ref('')
async function doSwap() {
  const s = swapFrom.value
  if (!s || !swapWith.value) return
  await run(async () => { await createSwap(ym.value, s.day, s.personId, swapWith.value, swapNote.value.trim()) }, '已建立換班')
  swapFrom.value = null; swapWith.value = ''; swapNote.value = ''
}

// ── 流程 ─────────────────────────────────────────────────────
const lockConflict = ref('')
async function run(fn: () => Promise<unknown>, ok?: string) {
  busy.value = true
  try { await fn(); if (ok) toast(ok) } catch (e) {
    if (e instanceof LockedError) lockConflict.value = e.holder.name
    else toast((e as Error).message)
  } finally { busy.value = false }
}
const confirmForce = ref(false)
async function onStart(force = false) {
  busy.value = true
  try { await startMonth(ym.value, force); confirmForce.value = false; toast('已開始排班') } catch (e) {
    if (e instanceof LockedError) lockConflict.value = e.holder.name
    else if ((e as Error).message === '上個月尚未發布') confirmForce.value = true
    else toast((e as Error).message)
  } finally { busy.value = false }
}
const showPublish = ref(false)
const issueSummary = computed(() => {
  const c = new Map<RuleCode, number>()
  for (const i of issues.value) c.set(i.rule, (c.get(i.rule) ?? 0) + 1)
  return [...c.entries()].map(([r, n]) => `${RULE_LABELS[r]} ${n}`)
})
const doPublish = () => run(async () => {
  const sheet = await publishMonth(ym.value, issues.value.length)
  showPublish.value = false
  toast(sheet ? '已發布，手機可查看' : '已發布（推送手機班表失敗，稍後再試）')
})
const revertLeft = computed(() => {
  const m = month.value
  const dl = m ? revertDeadline(m, rules.value) : null
  if (!dl || dl < Date.now()) return ''
  const h = Math.floor((dl - Date.now()) / 3600_000)
  return `${h} 小時`
})

// ── 底部抽屜 ─────────────────────────────────────────────────
type Drawer = 'issues' | 'quota' | 'swap' | 'change' | 'log'
const drawer = ref<Drawer | null>(null)
const debts = computed(() => (doc<DebtRec[]>('debts') ?? []).filter(d => !d.settledAt && d.qty > 0))
const logs = computed(() => [...(doc<LogDoc>(`log:${ym.value}`)?.entries ?? [])].reverse().slice(0, 100))
function goIssue(i: Issue) {
  drawer.value = null
  if (i.personId && i.day) { view.value = 'person'; personId.value = i.personId; openPick(i.personId, i.day) }
  else if (i.day) { view.value = 'day'; dayIdx.value = i.day }
}
const fmt = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const statCls = (act: number, t: number | undefined) => t === undefined ? 'text-fg-secondary' : act === t ? 'text-success' : act > t ? 'text-danger' : 'text-warning'
const mD = computed(() => Number(ym.value.slice(4)))
</script>

<template>
  <section class="py-3 space-y-2">
    <p v-if="!yms.length" class="py-12 text-center text-sm text-muted">尚無月份（請在桌機匯入或新增）</p>
    <template v-else>
      <!-- 頂端列 -->
      <div class="px-3 flex items-center gap-2 flex-wrap">
        <select v-model="ym" class="h-9 px-2 rounded-lg bg-surface border border-hairline font-bold">
          <option v-for="y in yms" :key="y" :value="y">{{ y.slice(0, 4) }}/{{ y.slice(4) }}</option>
        </select>
        <span v-if="month" class="px-2 py-0.5 rounded-full border text-xs font-bold"
          :class="month.status === 'open' ? 'border-accent text-accent' : month.status === 'scheduling' ? 'border-warning text-warning' : 'border-success text-success'">
          {{ STATUS[month.status] }}{{ postEdit ? '・修改中' : '' }}
        </span>
        <span v-if="mine" class="text-xs text-success font-bold">🔒 本機持鎖</span>
        <span v-else-if="lock" class="text-xs text-warning font-bold">🔒 {{ lock.name }} 排班中</span>
      </div>
      <div v-if="month" class="px-3 flex gap-2 flex-wrap">
        <button v-if="month.status === 'open'" :disabled="busy" @click="onStart()" class="h-9 px-3 rounded-lg bg-accent text-white text-sm font-bold disabled:opacity-40">開始排班</button>
        <template v-if="month.status === 'scheduling'">
          <button v-if="!mine" :disabled="busy" @click="run(() => acquireLock(ym), '已取得排班鎖')" class="h-9 px-3 rounded-lg border border-warning text-warning text-sm font-bold">取得排班鎖</button>
          <button v-else :disabled="busy" @click="showPublish = true" class="h-9 px-3 rounded-lg bg-success text-white text-sm font-bold">發布…</button>
        </template>
        <template v-if="month.status === 'published'">
          <button v-if="revertLeft && !postEdit" :disabled="busy" @click="run(() => revertMonth(ym), '已退回排班中')" class="h-9 px-3 rounded-lg border border-hairline text-sm">退回（剩 {{ revertLeft }}）</button>
          <button v-if="!postEdit" :disabled="busy" @click="run(async () => { await acquireLock(ym); postEdit = true }, '已進入修改模式')" class="h-9 px-3 rounded-lg border border-warning text-warning text-sm font-bold">修改已發布班表</button>
          <button v-else :disabled="busy" @click="run(async () => { await releaseLock(ym); postEdit = false }, '已結束修改')" class="h-9 px-3 rounded-lg bg-accent text-white text-sm font-bold">結束修改</button>
        </template>
      </div>
      <div v-if="lockConflict" class="mx-3 p-3 rounded-xl bg-warning/10 border border-warning/40 text-sm space-y-2">
        <p class="text-warning">{{ lockConflict }} 正在排這個月。強制接手會讓對方無法再存檔。</p>
        <div class="flex gap-2">
          <button @click="run(async () => { await acquireLock(ym, true); lockConflict = ''; if (month?.status === 'published') postEdit = true }, '已接手')" class="h-9 px-3 rounded-lg border border-warning text-warning font-bold">強制接手</button>
          <button @click="lockConflict = ''" class="h-9 px-3 text-muted">取消</button>
        </div>
      </div>
      <div v-if="confirmForce" class="mx-3 p-3 rounded-xl bg-warning/10 border border-warning/40 text-sm space-y-2">
        <p class="text-warning">{{ prevYm(ym) }} 尚未發布，X 還沒定案。</p>
        <button @click="onStart(true)" class="h-9 px-3 rounded-lg border border-warning text-warning font-bold">強制以目前 X 交接</button>
      </div>

      <!-- 檢視切換 -->
      <div class="px-3">
        <div class="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="v in (['grid', 'day', 'person'] as const)" :key="v" @click="view = v"
            class="h-8 rounded-lg" :class="view === v ? 'bg-surface text-accent shadow-sm' : 'text-muted'">
            {{ { grid: '全表', day: '單日', person: '單人' }[v] }}
          </button>
        </div>
        <p class="mt-1 text-xs text-muted">{{ layer === 'pre' ? '預班層（開放中，可代登）' : editable ? '排班層：點格子修改' : '排班層：唯讀（需持鎖或進入修改模式）' }}</p>
      </div>

      <!-- 全表 -->
      <div v-if="view === 'grid' && month" class="overflow-x-auto">
        <table class="text-xs border-collapse min-w-max">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-sunken px-2 text-left text-muted">姓名</th>
              <th v-for="d in days" :key="d" class="w-8 text-center" :class="isRest(d) ? 'text-danger' : 'text-muted'">
                <div class="font-bold">{{ d }}</div><div>{{ DOW[dowOf(ym, d)] }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.personId" class="border-t border-hairline">
              <td class="sticky left-0 z-10 bg-sunken px-2 py-1 font-bold whitespace-nowrap" @click="view = 'person'; personId = r.personId">{{ nameOf(r.personId) }}</td>
              <td v-for="d in days" :key="d" class="p-0.5" @click="openPick(r.personId, d)">
                <div class="relative h-7 min-w-7 rounded-md flex items-center justify-center font-bold"
                  :class="[badCells.has(`${r.personId}|${d}`) ? 'ring-2 ring-danger' : '', isSys(r.personId, d) ? 'italic opacity-80' : '']"
                  :style="codeStyle(read(r.personId, d))">
                  {{ read(r.personId, d) }}
                  <span v-if="changed.has(`${r.personId}|${d}`)" class="absolute top-0 left-0 w-1.5 h-1.5 rounded-full bg-warning" />
                </div>
              </td>
            </tr>
            <tr class="border-t border-hairline text-muted">
              <td class="sticky left-0 bg-sunken px-2">休／可休</td>
              <td v-for="d in days" :key="d" class="text-center" :class="dstat(d).off > (quota?.offSlots[d - 1] ?? 0) ? 'text-danger font-bold' : ''">{{ dstat(d).off }}/{{ quota?.offSlots[d - 1] }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 單日 -->
      <div v-else-if="view === 'day' && month" class="px-3 space-y-2">
        <div class="flex items-center justify-between">
          <button @click="dayIdx = Math.max(1, dayIdx - 1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">‹</button>
          <span class="font-bold" :class="isRest(dayIdx) ? 'text-danger' : ''">{{ mD }}/{{ dayIdx }}（{{ DOW[dowOf(ym, dayIdx)] }}）{{ holidays.days[dateStr(ym, dayIdx)] ?? '' }}</span>
          <button @click="dayIdx = Math.min(nd, dayIdx + 1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">›</button>
        </div>
        <div class="grid grid-cols-4 gap-2 text-center text-sm">
          <div v-for="k in (['D', 'N', 'S1'] as const)" :key="k" class="p-2 rounded-xl bg-surface border border-hairline"
            :class="layer === 'sched' && dstat(dayIdx)[k] !== need(dayIdx)[k] ? 'border-danger text-danger' : ''">
            <div class="text-xs text-muted">{{ k }}</div><b>{{ dstat(dayIdx)[k] }}/{{ need(dayIdx)[k] }}</b>
          </div>
          <div class="p-2 rounded-xl bg-surface border border-hairline" :class="dstat(dayIdx).off > (quota?.offSlots[dayIdx - 1] ?? 0) ? 'border-danger text-danger' : ''">
            <div class="text-xs text-muted">休／可休</div><b>{{ dstat(dayIdx).off }}/{{ quota?.offSlots[dayIdx - 1] }}</b>
          </div>
        </div>
        <div class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
          <button v-for="r in rows" :key="r.personId" @click="openPick(r.personId, dayIdx)" class="w-full flex items-center gap-2 px-4 py-2.5 text-left">
            <span class="flex-1 font-bold">{{ nameOf(r.personId) }}</span>
            <span class="min-w-10 px-2 py-0.5 rounded-md text-sm font-bold text-center" :class="badCells.has(`${r.personId}|${dayIdx}`) ? 'ring-2 ring-danger' : ''" :style="codeStyle(read(r.personId, dayIdx))">{{ read(r.personId, dayIdx) || '·' }}</span>
          </button>
        </div>
      </div>

      <!-- 單人 -->
      <div v-else-if="view === 'person' && month" class="px-3 space-y-2">
        <select v-model="personId" class="w-full h-10 px-3 rounded-xl bg-surface border border-hairline font-bold">
          <option v-for="r in rows" :key="r.personId" :value="r.personId">{{ nameOf(r.personId) }}</option>
        </select>
        <div v-if="stats(personId)" class="p-3 rounded-2xl bg-surface border border-hairline text-sm flex flex-wrap gap-x-4 gap-y-1">
          <span v-for="it in items" :key="it.id" :class="statCls(stats(personId)!.counts[it.id], targets[personId]?.[it.id])">
            <b>{{ it.name }}</b> {{ stats(personId)!.counts[it.id] }}/{{ targets[personId]?.[it.id] ?? '-' }}
          </span>
          <span class="text-muted">總時 {{ stats(personId)!.hours }}</span>
        </div>
        <div class="grid grid-cols-7 gap-1">
          <div v-for="w in DOW" :key="w" class="text-center text-xs text-muted">{{ w }}</div>
          <div v-for="n in dowOf(ym, 1)" :key="`b${n}`" />
          <button v-for="d in days" :key="d" @click="openPick(personId, d)"
            class="relative aspect-square rounded-xl border flex flex-col items-center justify-center"
            :class="badCells.has(`${personId}|${d}`) ? 'border-danger border-2' : 'border-hairline bg-surface'">
            <span class="text-xs" :class="isRest(d) ? 'text-danger' : 'text-muted'">{{ d }}</span>
            <span class="text-xs font-bold px-1 rounded" :style="codeStyle(read(personId, d))">{{ read(personId, d) || '·' }}</span>
          </button>
        </div>
      </div>

      <!-- 底部抽屜按鈕 -->
      <div class="px-3 flex gap-2 flex-wrap text-sm">
        <button v-for="t in ([['issues', `問題 ${issues.length}`], ['quota', '配額'], ['swap', '換班'], ['change', '異動'], ['log', '紀錄']] as const)" :key="t[0]"
          @click="drawer = t[0]" class="h-9 px-3 rounded-lg bg-surface border border-hairline font-bold" :class="t[0] === 'issues' && issues.length ? 'text-danger' : ''">{{ t[1] }}</button>
      </div>
    </template>

    <Teleport to="body">
      <!-- 格子選單 -->
      <div v-if="pick" class="fixed inset-0 z-50 flex flex-col justify-end">
        <div class="absolute inset-0 bg-black/50" @click="pick = null" />
        <div class="relative bg-surface rounded-t-3xl px-5 pt-5 space-y-3" :style="{ paddingBottom: 'calc(var(--safe-b) + 1.25rem)' }">
          <p class="font-bold">{{ nameOf(pick.personId) }}　{{ mD }}/{{ pick.day }}（{{ DOW[dowOf(ym, pick.day)] }}）　目前：{{ read(pick.personId, pick.day) || '空白' }}</p>
          <p v-for="i in issues.filter(x => x.personId === pick!.personId && x.day === pick!.day)" :key="i.message" class="text-sm text-danger">⚠ {{ i.message }}</p>
          <template v-if="editable && !(layer === 'pre' && isSys(pick.personId, pick.day))">
            <div class="flex flex-wrap gap-2">
              <button v-for="c in menuCodes" :key="c" :disabled="busy" @click="setCode(c)" class="h-11 px-4 rounded-xl border border-hairline text-sm font-bold" :style="codeStyle(c)">{{ c }}</button>
              <button :disabled="busy" @click="setCode('')" class="h-11 px-4 rounded-xl border border-hairline text-sm text-muted">清除</button>
            </div>
            <button v-if="layer === 'sched'" @click="swapFrom = pick; pick = null" class="w-full h-11 rounded-xl border border-hairline text-sm font-bold">建立換班（同日與另一人互換）…</button>
          </template>
          <template v-else-if="canPrefillSwap(pick.personId, pick.day)">
            <p class="text-sm text-muted">🔒 系統預填（{{ read(pick.personId, pick.day) }}）：不能直接改，可以交給別人代上。</p>
            <button @click="openPrefillSwap(pick.personId, pick.day)" class="w-full h-11 rounded-xl bg-accent text-white text-sm font-bold">換人…</button>
          </template>
          <p v-else class="text-sm text-muted">{{ layer === 'pre' && isSys(pick.personId, pick.day) ? '🔒 系統預填' : '目前不可修改（需持鎖或進入修改模式）' }}</p>
          <button @click="pick = null" class="w-full h-12 rounded-xl bg-sunken font-bold">關閉</button>
        </div>
      </div>

      <!-- 發布後修改原因 -->
      <div v-if="reasonFor" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div class="w-full max-w-sm bg-surface rounded-2xl p-5 space-y-3">
          <p class="font-bold">修改已發布班表：{{ nameOf(reasonFor.personId) }} {{ mD }}/{{ reasonFor.day }} → {{ reasonFor.value || '空白' }}</p>
          <textarea v-model="reasonText" rows="3" placeholder="修改原因（必填）" class="w-full p-3 rounded-xl bg-sunken border border-hairline" />
          <label class="flex items-center gap-2 text-sm"><input v-model="reasonApproved" type="checkbox" />核准偏離：此人配額不符不再警告</label>
          <div class="flex gap-2">
            <button @click="reasonFor = null" class="flex-1 h-11 rounded-xl bg-sunken font-bold">取消</button>
            <button :disabled="busy" @click="confirmReason" class="flex-1 h-11 rounded-xl bg-accent text-white font-bold">確定修改</button>
          </div>
        </div>
      </div>

      <!-- 預填換人 -->
      <div v-if="pSwap" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div class="w-full max-w-sm bg-surface rounded-2xl p-5 space-y-3 text-sm">
          <p class="font-bold text-base">預填換人：{{ pSwap.cells.map(c => `${mD}/${c.day}`).join('、') }} {{ pSwap.cells[0].code }}</p>
          <p class="text-fg-secondary">原本由 {{ nameOf(pSwap.from) }} 上。輪序照舊，開始排班時記為換班（{{ nameOf(pSwap.from) }} −1、代班者 +1）。⚠ 只提示、不阻擋。</p>
          <select v-model="pSwapTo" class="w-full h-11 px-3 rounded-xl bg-sunken border border-hairline">
            <option value="">選擇代班者…</option>
            <option v-for="id in pSwapCandidates" :key="id" :value="id">
              {{ nameOf(id) }}（{{ pSwap.cells.map(c => read(id, c.day) || '空白').join('／') }}）{{ cautionOf(id) }}
            </option>
          </select>
          <input v-model="pSwapNote" placeholder="原因（選填，例如：長假）" class="w-full h-11 px-3 rounded-xl bg-sunken border border-hairline" />
          <div class="flex gap-2">
            <button @click="pSwap = null" class="flex-1 h-11 rounded-xl bg-sunken font-bold">取消</button>
            <button :disabled="!pSwapTo || busy" @click="doPrefillSwap" class="flex-1 h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40">換人</button>
          </div>
        </div>
      </div>

      <!-- 換班 -->
      <div v-if="swapFrom" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div class="w-full max-w-sm bg-surface rounded-2xl p-5 space-y-3">
          <p class="font-bold">換班：{{ nameOf(swapFrom.personId) }} {{ mD }}/{{ swapFrom.day }}（{{ read(swapFrom.personId, swapFrom.day) || '空白' }}）</p>
          <select v-model="swapWith" class="w-full h-11 px-3 rounded-xl bg-sunken border border-hairline">
            <option value="">選擇對象…</option>
            <option v-for="r in rows.filter(x => x.personId !== swapFrom!.personId)" :key="r.personId" :value="r.personId">
              {{ nameOf(r.personId) }}（{{ read(r.personId, swapFrom.day) || '空白' }}）
            </option>
          </select>
          <input v-model="swapNote" placeholder="備註（選填）" class="w-full h-11 px-3 rounded-xl bg-sunken border border-hairline" />
          <div class="flex gap-2">
            <button @click="swapFrom = null" class="flex-1 h-11 rounded-xl bg-sunken font-bold">取消</button>
            <button :disabled="!swapWith || busy" @click="doSwap" class="flex-1 h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40">互換</button>
          </div>
        </div>
      </div>

      <!-- 發布確認 -->
      <div v-if="showPublish" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div class="w-full max-w-sm bg-surface rounded-2xl p-5 space-y-3 text-sm">
          <p class="font-bold text-base">發布 {{ ym }}</p>
          <p class="text-fg-secondary">發布後配額與 X 定案，手機即可查看；{{ rules.revertHours }} 小時內可退回。</p>
          <div v-if="issues.length" class="p-3 rounded-xl bg-warning/10 border border-warning/40">
            <p class="font-bold text-warning">仍有 {{ issues.length }} 項檢核警告</p>
            <p v-for="s in issueSummary" :key="s" class="text-fg-secondary">・{{ s }}</p>
          </div>
          <div class="flex gap-2">
            <button @click="showPublish = false" class="flex-1 h-11 rounded-xl bg-sunken font-bold">取消</button>
            <button :disabled="busy" @click="doPublish" class="flex-1 h-11 rounded-xl bg-success text-white font-bold">{{ issues.length ? '確認仍要發布' : '發布' }}</button>
          </div>
        </div>
      </div>

      <!-- 底部抽屜 -->
      <div v-if="drawer" class="fixed inset-0 z-50 flex flex-col justify-end">
        <div class="absolute inset-0 bg-black/50" @click="drawer = null" />
        <div class="relative bg-surface rounded-t-3xl px-4 pt-4 max-h-[80vh] overflow-y-auto text-sm space-y-2" :style="{ paddingBottom: 'calc(var(--safe-b) + 1.25rem)' }">
          <div class="flex gap-1 overflow-x-auto">
            <button v-for="t in ([['issues', '問題'], ['quota', '配額'], ['swap', '換班'], ['change', '異動'], ['log', '紀錄']] as const)" :key="t[0]"
              @click="drawer = t[0]" class="h-8 px-3 rounded-lg font-bold whitespace-nowrap" :class="drawer === t[0] ? 'bg-accent text-white' : 'bg-sunken text-muted'">{{ t[1] }}</button>
          </div>
          <template v-if="drawer === 'issues'">
            <p v-if="!issues.length" class="py-6 text-center text-success">沒有違規 ✓</p>
            <button v-for="(i, k) in issues" :key="k" @click="goIssue(i)" class="w-full text-left p-2 rounded-lg bg-sunken">
              <b class="text-danger">{{ RULE_LABELS[i.rule] }}</b>　{{ i.message }}
            </button>
          </template>
          <template v-else-if="drawer === 'quota'">
            <div v-for="r in rows" :key="r.personId" class="p-2 rounded-lg bg-sunken flex flex-wrap gap-x-3">
              <b class="w-16">{{ nameOf(r.personId) }}</b>
              <span v-for="it in items" :key="it.id" :class="statCls(stats(r.personId)?.counts[it.id] ?? 0, targets[r.personId]?.[it.id])">
                {{ it.name }} {{ stats(r.personId)?.counts[it.id] ?? 0 }}/{{ targets[r.personId]?.[it.id] ?? '-' }}
                <span v-if="month?.markers[it.id]?.v === r.personId" class="text-accent font-bold">V</span>
                <span v-if="month?.markers[it.id]?.x === r.personId" class="text-accent font-bold">X</span>
              </span>
            </div>
          </template>
          <template v-else-if="drawer === 'swap'">
            <template v-if="prefillGroups.length">
              <p class="font-bold">預填換人{{ month?.status === 'open' ? '' : '（已轉為換班）' }}</p>
              <div v-for="g in prefillGroups" :key="g.group" class="p-2 rounded-lg bg-sunken">
                <div class="flex items-center gap-2">
                  <span class="flex-1">{{ g.days }} {{ g.code }}：{{ nameOf(g.from) }} → {{ nameOf(g.to) }}</span>
                  <button v-if="month?.status === 'open'" @click="run(() => removePrefillSwap(ym, g.group), '已取消預填換人')" class="text-danger">取消</button>
                </div>
                <div v-if="g.note" class="text-xs text-muted">{{ g.note }}</div>
              </div>
            </template>
            <p class="font-bold">本月換班</p>
            <p v-if="!month?.swaps?.length" class="text-muted">沒有換班（點格子建立）</p>
            <div v-for="s in month?.swaps ?? []" :key="s.id" class="p-2 rounded-lg bg-sunken flex items-center gap-2">
              <span class="flex-1">{{ mD }}/{{ s.day }} {{ nameOf(s.a) }} {{ s.aCode || '空白' }} ⇄ {{ nameOf(s.b) }} {{ s.bCode || '空白' }}</span>
              <button @click="run(() => deleteSwap(ym, s.id), '已刪除換班')" class="text-danger">刪除</button>
            </div>
            <p class="font-bold pt-2">未平的欠班</p>
            <p v-if="!debts.length" class="text-muted">沒有欠班</p>
            <div v-for="d in debts" :key="d.id" class="p-2 rounded-lg bg-sunken flex items-center gap-2">
              <span class="flex-1">{{ nameOf(d.from) }} 欠 {{ nameOf(d.to) }} {{ d.item }}×{{ d.qty }}（{{ d.ym }}）</span>
              <button @click="run(() => settleDebt(d.id, ''), '已平帳')" class="text-accent font-bold">平帳</button>
            </div>
          </template>
          <template v-else-if="drawer === 'change'">
            <p v-if="!month?.changeLog?.length" class="py-6 text-center text-muted">發布後沒有異動</p>
            <div v-for="(c, k) in [...(month?.changeLog ?? [])].reverse()" :key="k" class="p-2 rounded-lg bg-sunken">
              <b>{{ nameOf(c.personId) }} {{ mD }}/{{ c.day }}</b> {{ c.from || '空白' }} → {{ c.to || '空白' }}
              <div class="text-xs text-muted">{{ c.reason }}{{ c.approved ? '（核准偏離）' : '' }}　{{ c.by }}　{{ fmt(c.at) }}</div>
            </div>
          </template>
          <template v-else>
            <p v-if="!logs.length" class="py-6 text-center text-muted">沒有紀錄</p>
            <div v-for="(e, k) in logs" :key="k" class="p-2 rounded-lg bg-sunken">
              <div class="flex gap-2"><b>{{ e.action }}</b><span class="text-muted">{{ e.actor === 'system' ? '系統' : e.actor }}</span><span class="ml-auto text-xs text-muted">{{ fmt(e.at) }}</span></div>
              <div class="text-fg-secondary break-all">{{ e.detail }}</div>
            </div>
          </template>
          <button @click="drawer = null" class="w-full h-11 rounded-xl bg-sunken font-bold">關閉</button>
        </div>
      </div>
    </Teleport>
  </section>
</template>
