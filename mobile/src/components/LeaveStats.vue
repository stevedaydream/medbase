<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { sched, doc, syncSchedDocs } from '../lib/sched'
import { gas } from '../lib/api'
import { kvGet, kvSet } from '../lib/kv'
import { toast } from '../lib/ui'
import {
  leaveLedger, normalizeLeaveRules, compAccrueOf, fmtLeave, LEAVE_LABELS,
  type LeaveRules, type LeaveOpen, type LeaveOpenDoc, type OvertimeDoc, type PaySetting, type LeaveMonthInput,
} from '@shared/sched/leave'
import { DEFAULT_SHIFTS, type MonthDoc, type ShiftDef, type HolidayDoc, type LeaveKind } from '@shared/sched/types'
import { daysIn } from '@shared/sched/calendar'

/** 假勤統計（ADR-027）：本月值班費與補假、補換假，目前各假別餘額；登記加班、期初餘額、時薪與值班費 */
const props = defineProps<{ ym: string }>()

const me = computed(() => sched.me!.id)
const rules = computed<LeaveRules>(() => normalizeLeaveRules(doc<Partial<LeaveRules>>('leaveRules')))
const shifts = computed(() => doc<ShiftDef[]>('shifts') ?? DEFAULT_SHIFTS)
const holidays = computed<HolidayDoc>(() => doc<HolidayDoc>('holidays') ?? { days: {}, workdays: [], cny: [] })
const open = computed<LeaveOpen | undefined>(() => doc<LeaveOpenDoc>('leaveOpen')?.[me.value])
const hireDate = computed(() => doc<{ id: string; hireDate?: string }[]>('people')?.find(p => p.id === me.value)?.hireDate ?? '')
const hpd = computed(() => rules.value.hoursPerDay)
const fmt = (h: number) => fmtLeave(h, hpd.value)
const money = (n: number) => `${Math.round(n).toLocaleString()} 元`

/** 自己的加班（伺服器只給自己的） */
const overtimes = computed(() => Object.keys(sched.docs).filter(k => k.startsWith('overtime:'))
  .flatMap(k => (doc<OvertimeDoc>(k)?.items ?? []).filter(i => i.personId === me.value).map(i => ({ ...i, ym: k.slice(9) }))))

/** 已發布月份（伺服器只給自己那列） */
const months = computed<LeaveMonthInput[]>(() => Object.keys(sched.docs).filter(k => k.startsWith('month:'))
  .map(k => doc<MonthDoc>(k)!).filter(m => m?.status === 'published')
  .map(m => ({ ym: m.ym, published: true, code: (d: number) => m.schedule?.[me.value]?.[d - 1] ?? '' })))

// ── 個人薪資設定（只有本人看得到；離線用上次的）──────────────────
const pay = ref<PaySetting | null>(null)
onMounted(async () => {
  pay.value = (await kvGet<PaySetting>('leave:pay')) ?? null
  try {
    pay.value = (await gas<{ pay: PaySetting | null }>('mobileGetPay')).pay
    await kvSet('leave:pay', pay.value ? JSON.parse(JSON.stringify(pay.value)) : null)
  } catch { /* 離線 */ }
})

const ledger = computed(() => leaveLedger({
  hireDate: hireDate.value, rules: rules.value, open: open.value, shifts: shifts.value, holidays: holidays.value,
  months: months.value, overtime: overtimes.value, pay: pay.value ?? undefined,
  today: new Date().toLocaleString('sv-SE').slice(0, 10),
}))
const stat = computed(() => ledger.value.months[props.ym])
const bal = computed(() => ledger.value.balance)
const lastExpired = computed(() => bal.value.expired[bal.value.expired.length - 1])
const daysLeft = (date: string) => Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
const carrySoon = computed(() => bal.value.carry > 0 && !!bal.value.carryUntil && daysLeft(bal.value.carryUntil) <= 30)
const hourly = computed(() => pay.value?.hourly ?? 0)
const monthOvertime = computed(() => overtimes.value.filter(o => o.ym === props.ym).sort((a, b) => a.day - b.day))
const USED: LeaveKind[] = ['annual', 'comp', 'swap']

// ── 登記加班 ─────────────────────────────────────────────────────
const otForm = ref<{ day: number; hours: number; note: string } | null>(null)
const busy = ref(false)
async function run(fn: () => Promise<unknown>, ok: string) {
  if (sched.offline) { toast('目前離線，無法儲存'); return }
  busy.value = true
  try {
    const r = await fn() as { ok: boolean; error?: string }
    if (r && r.ok === false) { toast(r.error ?? '儲存失敗'); return }
    await syncSchedDocs()
    toast(ok)
    return true
  } catch (e) {
    toast((e as Error).message)
  } finally {
    busy.value = false
  }
}
async function addOvertime() {
  const f = otForm.value
  if (!f || !(f.hours > 0)) return
  if (await run(() => gas('mobileSetOvertime', { ym: props.ym, op: 'add', ...f }), '已登記加班')) otForm.value = null
}
const delOvertime = (id: string, ym: string) => run(() => gas('mobileSetOvertime', { ym, op: 'delete', id }), '已刪除')

// ── 期初餘額 ─────────────────────────────────────────────────────
const openForm = ref<LeaveOpen | null>(null)
function editOpen() {
  const o = open.value
  openForm.value = o ? { ...o } : { from: props.ym, annual: 0, carry: 0, carryUntil: '', comp: 0, swap: 0 }
}
async function saveOpen() {
  if (!openForm.value) return
  if (await run(() => gas('mobileSetLeaveOpen', { open: openForm.value }), '已儲存期初餘額')) openForm.value = null
}

// ── 時薪與值班費 ─────────────────────────────────────────────────
/** 會領值班費的班別：有預設值或會累積補假的班 */
const dutyShifts = computed(() => shifts.value.filter(s => s.dutyPay !== undefined || compAccrueOf(s) > 0))
const payForm = ref<{ hourly: number; dutyPay: Record<string, number | ''> } | null>(null)
function editPay() {
  const p = pay.value
  payForm.value = { hourly: p?.hourly ?? 0, dutyPay: Object.fromEntries(dutyShifts.value.map(s => [s.code, p?.dutyPay?.[s.code] ?? ''])) }
}
async function savePay() {
  const f = payForm.value
  if (!f) return
  const next = { hourly: Number(f.hourly) || 0, dutyPay: Object.fromEntries(Object.entries(f.dutyPay).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) }
  if (await run(() => gas('mobileSetPay', { pay: next }), '已儲存')) {
    pay.value = next
    await kvSet('leave:pay', next)
    payForm.value = null
  }
}
const ymLabel = computed(() => `${Number(props.ym.slice(4))} 月`)
</script>

<template>
  <div class="mx-4 mt-4 space-y-3">
    <!-- ① 本月 -->
    <section class="p-4 rounded-2xl bg-surface border border-hairline text-sm space-y-2">
      <p class="font-bold text-fg">{{ ymLabel }}假勤</p>
      <p v-if="!stat" class="text-muted">此月班表尚未發布</p>
      <template v-else>
        <div class="flex justify-between">
          <span class="text-fg-secondary">值班費</span>
          <span class="font-bold tabular-nums">{{ money(stat.dutyPay) }}</span>
        </div>
        <p v-if="stat.dutyPayDefaults.length" class="text-xs text-muted">{{ stat.dutyPayDefaults.join('、') }} 用單位預設金額；可在下方設定自己的</p>
        <p v-if="stat.dutyPayMissing.length" class="text-xs text-warning">{{ stat.dutyPayMissing.join('、') }} 還沒有值班費金額</p>
        <div class="flex justify-between">
          <span class="text-fg-secondary">累積補假</span>
          <span class="font-bold tabular-nums">{{ fmt(stat.compFromShifts + stat.compFromUnrest) }}</span>
        </div>
        <p class="text-xs text-muted">值班超時 {{ fmt(stat.compFromShifts) }}；應休 {{ stat.requiredOff }} 天、實際 OFF {{ stat.offDays }} 天，沒休完 {{ fmt(stat.compFromUnrest) }}</p>
        <div class="flex justify-between">
          <span class="text-fg-secondary">累積補換假（加班）</span>
          <span class="font-bold tabular-nums">{{ fmt(stat.swapFromOvertime) }}</span>
        </div>
        <div v-if="USED.some(k => stat!.used[k])" class="flex justify-between">
          <span class="text-fg-secondary">本月使用</span>
          <span class="tabular-nums">{{ USED.filter(k => stat!.used[k]).map(k => `${LEAVE_LABELS[k]} ${fmt(stat!.used[k])}`).join('、') }}</span>
        </div>
      </template>
      <div class="pt-1 border-t border-hairline">
        <div class="flex items-center justify-between py-1">
          <span class="text-fg-secondary">加班登記</span>
          <button class="h-8 px-3 rounded-lg bg-accent text-white text-xs font-bold" @click="otForm = { day: 1, hours: 1, note: '' }">＋ 登記加班</button>
        </div>
        <p v-if="!monthOvertime.length" class="text-xs text-muted">這個月沒有登記</p>
        <div v-for="o in monthOvertime" :key="o.id" class="flex items-center gap-2 py-1 text-xs">
          <span class="w-10 text-fg-secondary">{{ o.day }} 日</span>
          <span class="font-bold">{{ o.hours }} 小時</span>
          <span class="flex-1 min-w-0 truncate text-muted">{{ o.note }}</span>
          <button class="text-muted" :disabled="busy" @click="delOvertime(o.id, o.ym)">刪除</button>
        </div>
      </div>
    </section>

    <!-- ② 目前餘額 -->
    <section class="p-4 rounded-2xl bg-surface border border-hairline text-sm space-y-2">
      <p class="font-bold text-fg">目前餘額<span class="ml-1 text-xs font-normal text-muted">算到最新已發布的月份</span></p>
      <p v-if="!open" class="text-xs text-warning">還沒有設定期初餘額，下列數字從 0 起算</p>
      <div class="flex justify-between">
        <span class="text-fg-secondary">特休</span>
        <span class="font-bold tabular-nums" :class="bal.annual < 0 ? 'text-danger' : ''">{{ fmt(bal.annual) }}</span>
      </div>
      <p class="text-xs text-muted">
        <template v-if="hireDate">本期額度 {{ fmt(bal.annualQuota) }}<template v-if="bal.nextGrant">，下次週年 {{ bal.nextGrant }}</template></template>
        <template v-else>人員名單沒有到職日，無法計算特休額度，請洽排班者</template>
      </p>
      <div v-if="bal.carry > 0" class="flex justify-between">
        <span class="text-fg-secondary">特休展延</span>
        <span class="font-bold tabular-nums">{{ fmt(bal.carry) }}</span>
      </div>
      <p v-if="bal.carry > 0" class="text-xs" :class="carrySoon ? 'text-danger font-bold' : 'text-muted'">
        {{ bal.carryUntil }} 到期作廢<template v-if="hourly">，約可換 {{ money(bal.carry * hourly) }}</template><template v-if="carrySoon">（剩 {{ daysLeft(bal.carryUntil) }} 天）</template>
      </p>
      <p v-if="lastExpired" class="text-xs text-muted">{{ lastExpired.date }} 已作廢展延 {{ fmt(lastExpired.hours) }}<template v-if="hourly">（約 {{ money(lastExpired.hours * hourly) }}）</template></p>
      <div class="flex justify-between">
        <span class="text-fg-secondary">補假</span>
        <span class="font-bold tabular-nums" :class="bal.comp < 0 ? 'text-danger' : ''">{{ fmt(bal.comp) }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-fg-secondary">補換假</span>
        <span class="font-bold tabular-nums" :class="bal.swap < 0 ? 'text-danger' : ''">{{ fmt(bal.swap) }}</span>
      </div>
      <div class="flex gap-2 pt-1">
        <button class="flex-1 h-9 rounded-lg bg-sunken border border-hairline text-xs font-bold" @click="editOpen">期初餘額</button>
        <button class="flex-1 h-9 rounded-lg bg-sunken border border-hairline text-xs font-bold" @click="editPay">時薪與值班費</button>
      </div>
    </section>

    <!-- 表單（底部抽屜） -->
    <div v-if="otForm || openForm || payForm" class="fixed inset-0 z-50 bg-black/40 flex items-end" @click.self="otForm = openForm = payForm = null">
      <div class="w-full max-h-[85vh] overflow-y-auto bg-surface rounded-t-2xl p-4 pb-8 space-y-3 text-sm">
        <template v-if="otForm">
          <p class="font-bold text-fg">登記加班（{{ ymLabel }}）</p>
          <label class="flex items-center gap-2">日期
            <select v-model.number="otForm.day" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline">
              <option v-for="d in daysIn(ym)" :key="d" :value="d">{{ d }} 日</option>
            </select>
          </label>
          <label class="flex items-center gap-2">時數
            <input v-model.number="otForm.hours" type="number" min="0.5" max="24" step="0.5" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" />
          </label>
          <input v-model="otForm.note" maxlength="100" placeholder="事由（選填）" class="w-full h-10 px-2 rounded-lg bg-sunken border border-hairline" />
          <p class="text-xs text-muted">登記後直接計入補換假</p>
          <button class="w-full h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40" :disabled="busy || !(otForm.hours > 0)" @click="addOvertime">登記</button>
        </template>

        <template v-else-if="openForm">
          <p class="font-bold text-fg">期初餘額（小時）</p>
          <p class="text-xs text-muted">填寫起算月份 1 日當時的剩餘時數，之後由系統依班表與加班登記自動增減。1 天＝{{ hpd }} 小時。</p>
          <label class="flex items-center gap-2">起算月份
            <input :value="`${openForm.from.slice(0, 4)}-${openForm.from.slice(4)}`" type="month" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline"
              @change="openForm.from = ($event.target as HTMLInputElement).value.replace('-', '')" />
          </label>
          <label class="flex items-center gap-2">特休（本期剩餘）<input v-model.number="openForm.annual" type="number" step="0.5" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" /></label>
          <label class="flex items-center gap-2">特休展延<input v-model.number="openForm.carry" type="number" min="0" step="0.5" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" /></label>
          <label v-if="openForm.carry > 0" class="flex items-center gap-2">展延到期日<input v-model="openForm.carryUntil" type="date" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" /></label>
          <label class="flex items-center gap-2">補假<input v-model.number="openForm.comp" type="number" step="0.5" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" /></label>
          <label class="flex items-center gap-2">補換假<input v-model.number="openForm.swap" type="number" step="0.5" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" /></label>
          <button class="w-full h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40" :disabled="busy || !/^\d{6}$/.test(openForm.from)" @click="saveOpen">儲存</button>
        </template>

        <template v-else-if="payForm">
          <p class="font-bold text-fg">時薪與值班費</p>
          <p class="text-xs text-muted">只有你自己看得到。時薪用來估算特休作廢可換的金額；值班費空白＝用單位預設金額。</p>
          <label class="flex items-center gap-2">時薪<input v-model.number="payForm.hourly" type="number" min="0" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" /></label>
          <label v-for="s in dutyShifts" :key="s.code" class="flex items-center gap-2">{{ s.code }} 值班費
            <input v-model="payForm.dutyPay[s.code]" type="number" min="0" step="50" :placeholder="s.dutyPay !== undefined ? `預設 ${s.dutyPay}` : '未設定'"
              class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" />
          </label>
          <button class="w-full h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40" :disabled="busy" @click="savePay">儲存</button>
        </template>
      </div>
    </div>
  </div>
</template>
