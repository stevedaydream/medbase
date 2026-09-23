<script setup lang="ts">
import { ref, computed } from 'vue'
import { data, type DutyRow } from '../lib/data'
import { hisByName } from '../lib/records'
import { copy, useNow } from '../lib/ui'
import {
  NP_WARDS, VS_PRIMARY, VS_OTHERS, addDays, localDateKey, withCarriedNight, isOnDuty, isTimedShift, shiftLabel, normName,
} from '@shared/duty'

/** 首頁的今日值班（規則與桌機側邊欄共用 shared/duty） */
const now = useNow()
const view = ref<'today' | 'tomorrow'>('today')
const group = ref<'NP' | 'VS'>('NP')
const showOtherVs = ref(false)

function rowsOf(date: Date): DutyRow[] {
  const key = localDateKey(date)
  return (data.duty[key.slice(0, 7)] ?? []).filter(r => r.duty_date.slice(0, 10) === key)
}

const viewingToday = computed(() => view.value === 'today')
const viewDate = computed(() => addDays(now.value, viewingToday.value ? 0 : 1))
const rows = computed(() => withCarriedNight(
  rowsOf(viewDate.value),
  viewingToday.value && now.value.getHours() < 8 ? rowsOf(addDays(now.value, -1)) : [],
  now.value, viewingToday.value,
))
const units = computed<readonly string[]>(() => group.value === 'NP'
  ? NP_WARDS
  : showOtherVs.value ? [VS_PRIMARY, ...VS_OTHERS] : [VS_PRIMARY])
const hasAny = computed(() => rows.value.some(r => (group.value === 'NP' ? NP_WARDS : [VS_PRIMARY, ...VS_OTHERS] as readonly string[]).includes(r.ward)))
const wardRows = (w: string) => rows.value.filter(r => r.ward === w)
const on = (r: DutyRow & { carried: boolean }) => isOnDuty(r, now.value, viewingToday.value)
const his = (name: string) => hisByName.value.get(normName(name)) ?? ''
</script>

<template>
  <section class="rounded-2xl bg-surface border border-hairline p-3">
    <div class="flex items-center gap-2 mb-3">
      <div class="flex rounded-xl bg-sunken p-0.5 text-sm font-bold">
        <button v-for="v in (['today', 'tomorrow'] as const)" :key="v" @click="view = v"
          class="h-8 px-3 rounded-lg" :class="view === v ? 'bg-surface text-accent shadow-sm' : 'text-muted'">
          {{ v === 'today' ? '今日' : '明日' }}
        </button>
      </div>
      <span class="text-sm font-bold text-accent tabular-nums">{{ viewDate.getMonth() + 1 }}/{{ viewDate.getDate() }}</span>
      <div class="flex-1" />
      <div class="flex rounded-xl bg-sunken p-0.5 text-sm font-bold">
        <button v-for="g in (['NP', 'VS'] as const)" :key="g" @click="group = g"
          class="h-8 px-3 rounded-lg" :class="group === g ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ g }}</button>
      </div>
    </div>

    <p v-if="!hasAny" class="py-3 text-sm text-muted">尚無 {{ group }} 值班資料</p>
    <div v-else class="space-y-2">
      <div v-for="w in units" :key="w" :class="group === 'NP' ? 'flex gap-3' : ''">
        <span class="inline-block shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-bold text-accent"
          :class="group === 'NP' ? 'w-9 text-center self-start mt-0.5' : 'mb-1'">{{ w }}</span>
        <div v-if="wardRows(w).length" class="flex-1 min-w-0 space-y-1">
          <div v-for="r in wardRows(w)" :key="`${r.duty_date}-${r.ward}-${r.shift}-${r.np_name}-${r.carried}`"
            class="flex items-center gap-2 rounded-lg px-2 py-1.5"
            :class="[on(r) ? 'bg-accent/15' : '', viewingToday && isTimedShift(r) && !on(r) ? 'opacity-50' : '']">
            <span class="shrink-0 text-xs font-bold w-7" :class="on(r) ? 'text-accent' : 'text-muted'">{{ shiftLabel(r) }}</span>
            <span class="flex-1 min-w-0">
              <span class="font-bold text-fg">{{ r.np_name }}</span>
              <button v-if="his(r.np_name)" @click="copy(his(r.np_name), 'HIS 帳號')" class="ml-2 text-xs text-muted font-mono">HIS {{ his(r.np_name) }}</button>
            </span>
            <button v-if="r.extension" @click="copy(r.extension, '分機')" class="shrink-0 font-mono font-bold text-accent tabular-nums">{{ r.extension }}</button>
          </div>
        </div>
        <span v-else class="text-sm text-muted">未排</span>
      </div>
      <button v-if="group === 'VS'" @click="showOtherVs = !showOtherVs" class="w-full h-9 rounded-lg text-sm font-bold text-muted bg-sunken">
        {{ showOtherVs ? '▴ 收合其他科別' : `▾ 其他科別（${VS_OTHERS.length}）` }}
      </button>
    </div>
  </section>
</template>
