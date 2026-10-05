<script setup lang="ts">
import { ref, computed } from 'vue'
import { doc, sched, syncSchedDocs } from '../lib/sched'
import { gas } from '../lib/api'
import { toast } from '../lib/ui'
import {
  compAccrueOf, normalizeLeaveRules, hourlyOf, monthlyCounted, type LeaveOpen, type LeaveRules, type PaySetting, type Salary,
} from '@shared/sched/leave'
import { DEFAULT_SHIFTS, type ShiftDef } from '@shared/sched/types'

/**
 * 期初餘額／時薪與值班費表單（底部抽屜，ADR-027）。
 * personId 省略＝本人；指定別人時只有 super 能存（GAS 檢查）。
 */
const props = defineProps<{
  mode: 'open' | 'pay'
  ym: string
  personId?: string
  name?: string
  open?: LeaveOpen
  pay?: PaySetting | null
}>()
const emit = defineEmits<{ close: []; saved: [value: LeaveOpen | PaySetting] }>()

const rules = computed(() => normalizeLeaveRules(doc<Partial<LeaveRules>>('leaveRules')))
const hpd = computed(() => rules.value.hoursPerDay)
const shifts = computed(() => doc<ShiftDef[]>('shifts') ?? DEFAULT_SHIFTS)
/** 會領值班費的班別：有預設值或會累積補假的班 */
const dutyShifts = computed(() => shifts.value.filter(s => s.dutyPay !== undefined || compAccrueOf(s) > 0))
const who = computed(() => props.name ? `${props.name}的` : '')

const openForm = ref<LeaveOpen>(props.open ? { ...props.open } : { from: props.ym, annual: 0, carry: 0, carryUntil: '', comp: 0, swap: 0 })
const payForm = ref<{ hourly: number; dutyPay: Record<string, number | ''>; salary: Salary }>({
  hourly: props.pay?.hourly ?? 0,
  dutyPay: Object.fromEntries(dutyShifts.value.map(s => [s.code, props.pay?.dutyPay?.[s.code] ?? ''])),
  salary: props.pay?.salary ? JSON.parse(JSON.stringify(props.pay.salary)) : { base: 0, professional: 0, custom: [] },
})
/** 薪資條換算：有填薪資就自動算時薪（月薪 ÷ 240），全部清空才可手動填 */
const monthly = computed(() => monthlyCounted(payForm.value.salary))
const autoHourly = computed(() => hourlyOf({ hourly: 0, dutyPay: {}, salary: payForm.value.salary }, rules.value))
const fmtMoney = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

const busy = ref(false)
const target = () => (props.personId ? { personId: props.personId } : {})
async function save() {
  if (sched.offline) { toast('目前離線，無法儲存'); return }
  busy.value = true
  try {
    let value: LeaveOpen | PaySetting
    let r: { ok: boolean; error?: string }
    if (props.mode === 'open') {
      value = { ...openForm.value }
      r = await gas('mobileSetLeaveOpen', { open: value, ...target() })
    } else {
      const f = payForm.value
      const salary: Salary = { base: Number(f.salary.base) || 0, professional: Number(f.salary.professional) || 0,
        custom: f.salary.custom.filter(c => c.name.trim() || c.amount).map(c => ({ name: c.name.trim(), amount: Number(c.amount) || 0, counted: c.counted })) }
      const hasSalary = salary.base || salary.professional || salary.custom.length
      value = {
        hourly: hasSalary ? autoHourly.value : Number(f.hourly) || 0,
        dutyPay: Object.fromEntries(Object.entries(f.dutyPay).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
        ...(hasSalary ? { salary } : {}),
      }
      r = await gas('mobileSetPay', { pay: value, ...target() })
    }
    if (r.ok === false) { toast(r.error ?? '儲存失敗'); return }
    if (props.mode === 'open') await syncSchedDocs()
    toast('已儲存')
    emit('saved', value)
  } catch (e) {
    toast((e as Error).message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/40 flex items-end" @click.self="emit('close')">
    <div class="w-full max-h-[85vh] overflow-y-auto bg-surface rounded-t-2xl p-4 pb-8 space-y-3 text-sm">
      <template v-if="mode === 'open'">
        <p class="font-bold text-fg">{{ who }}期初餘額（小時）</p>
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
        <button class="w-full h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40" :disabled="busy || !/^\d{6}$/.test(openForm.from)" @click="save">儲存</button>
      </template>

      <template v-else>
        <p class="font-bold text-fg">{{ who }}時薪與值班費</p>
        <p class="text-xs text-muted">{{ personId ? '只有本人與 super 看得到。' : '只有你自己（與 super）看得到。' }}時薪用來估算特休作廢可換的金額；值班費空白＝用單位預設金額。</p>
        <!-- 薪資條換算時薪 -->
        <div class="rounded-xl bg-sunken border border-hairline p-3 space-y-2">
          <p class="font-bold text-fg">薪資結構（月薪）</p>
          <label class="flex items-center gap-2">本薪<input v-model.number="payForm.salary.base" type="number" min="0" class="flex-1 h-10 px-2 rounded-lg bg-surface border border-hairline" /></label>
          <label class="flex items-center gap-2">專業加給<input v-model.number="payForm.salary.professional" type="number" min="0" class="flex-1 h-10 px-2 rounded-lg bg-surface border border-hairline" /></label>
          <div v-for="(c, i) in payForm.salary.custom" :key="i" class="flex items-center gap-1.5">
            <input v-model="c.name" maxlength="30" placeholder="項目名稱" class="w-24 h-10 px-2 rounded-lg bg-surface border border-hairline" />
            <input v-model.number="c.amount" type="number" class="flex-1 min-w-0 h-10 px-2 rounded-lg bg-surface border border-hairline" />
            <label class="flex items-center gap-1 text-xs shrink-0"><input v-model="c.counted" type="checkbox" class="w-4 h-4" />計入</label>
            <button class="shrink-0 w-8 h-10 text-muted" aria-label="刪除項目" @click="payForm.salary.custom.splice(i, 1)">×</button>
          </div>
          <button class="w-full h-9 rounded-lg bg-surface border border-hairline text-xs font-bold" @click="payForm.salary.custom.push({ name: '', amount: 0, counted: true })">＋ 自訂項目</button>
          <p class="text-xs text-muted">本薪、專業加給一律計入；自訂項目勾「計入」才算進時薪（每月固定領的才勾，例如職務加給）。</p>
        </div>
        <label class="flex items-center gap-2">時薪
          <input v-if="monthly > 0" :value="fmtMoney(autoHourly)" readonly class="flex-1 h-10 px-2 rounded-lg bg-raised border border-hairline text-fg-secondary" />
          <input v-else v-model.number="payForm.hourly" type="number" min="0" class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" />
        </label>
        <p v-if="monthly > 0" class="text-xs text-muted">＝ 月薪 {{ fmtMoney(monthly) }} ÷ {{ rules.hourlyDivisor }}（清空薪資項目才可手動填時薪）</p>
        <label v-for="s in dutyShifts" :key="s.code" class="flex items-center gap-2">{{ s.code }} 值班費
          <input v-model="payForm.dutyPay[s.code]" type="number" min="0" step="50" :placeholder="s.dutyPay !== undefined ? `預設 ${s.dutyPay}` : '未設定'"
            class="flex-1 h-10 px-2 rounded-lg bg-sunken border border-hairline" />
        </label>
        <button class="w-full h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40" :disabled="busy" @click="save">儲存</button>
      </template>
    </div>
  </div>
</template>
