<script setup lang="ts">
import { ref, computed } from 'vue'
import LeaveForms from './LeaveForms.vue'
import { doc, sched } from '../lib/sched'
import { gas } from '../lib/api'
import { toast } from '../lib/ui'
import { personGroup } from '@shared/sched/groups'
import { fmtLeave, type LeaveOpenDoc, type PaySetting } from '@shared/sched/leave'
import type { Person } from '@shared/sched/types'

/** super 修改他人期初餘額與薪資設定（ADR-027；GAS 確認 super 才能存，薪資不進桌機） */
const props = defineProps<{ ym: string }>()

const show = ref(false)
/** 還沒有月份時起算月份預設本月 */
const ymOr = computed(() => props.ym || new Date().toLocaleString('sv-SE').slice(0, 7).replace('-', ''))
const people = computed(() => (doc<Person[]>('people') ?? [])
  .filter(p => p.active && personGroup(p) === sched.group)
  .sort((a, b) => a.order - b.order))
const opens = computed(() => doc<LeaveOpenDoc>('leaveOpen') ?? {})

function summary(id: string): string {
  const o = opens.value[id]
  if (!o) return '尚未設定期初餘額'
  return `${o.from.slice(0, 4)}/${o.from.slice(4)} 起：特休 ${fmtLeave(o.annual)}${o.carry ? `、展延 ${fmtLeave(o.carry)}` : ''}、補假 ${fmtLeave(o.comp)}、補換假 ${fmtLeave(o.swap)}`
}

const editing = ref<{ mode: 'open' | 'pay'; person: Person; pay: PaySetting | null } | null>(null)
const loading = ref('')
async function editPay(p: Person) {
  if (sched.offline) { toast('目前離線，無法讀取薪資設定'); return }
  loading.value = p.id
  try {
    const r = await gas<{ pay: PaySetting | null }>('mobileGetPay', { personId: p.id })
    editing.value = { mode: 'pay', person: p, pay: r.pay }
  } catch (e) {
    toast((e as Error).message)
  } finally {
    loading.value = ''
  }
}
</script>

<template>
  <div class="px-3">
    <button class="w-full h-10 rounded-xl bg-surface border border-hairline text-sm font-bold flex items-center justify-center gap-1" @click="show = !show">
      人員假勤設定（super）<span class="text-muted">{{ show ? '▴' : '▾' }}</span>
    </button>
    <div v-if="show" class="mt-2 rounded-2xl bg-surface border border-hairline divide-y divide-hairline text-sm">
      <p v-if="!people.length" class="p-4 text-center text-muted">這個群組沒有在職人員</p>
      <div v-for="p in people" :key="p.id" class="p-3 space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="font-bold text-fg">{{ p.name }}</span>
          <span class="text-xs" :class="p.hireDate ? 'text-muted' : 'text-warning'">{{ p.hireDate ? `到職 ${p.hireDate}` : '未填到職日' }}</span>
        </div>
        <p class="text-xs text-muted">{{ summary(p.id) }}</p>
        <div class="flex gap-2">
          <button class="flex-1 h-8 rounded-lg bg-sunken border border-hairline text-xs font-bold" @click="editing = { mode: 'open', person: p, pay: null }">期初餘額</button>
          <button class="flex-1 h-8 rounded-lg bg-sunken border border-hairline text-xs font-bold disabled:opacity-40" :disabled="loading === p.id" @click="editPay(p)">
            {{ loading === p.id ? '讀取中…' : '時薪與值班費' }}
          </button>
        </div>
      </div>
      <p class="p-3 text-xs text-muted">到職日請在桌機人員名單填寫。薪資設定只有本人與 super 看得到。</p>
    </div>
    <LeaveForms v-if="editing" :mode="editing.mode" :ym="ymOr" :person-id="editing.person.id" :name="editing.person.name"
      :open="opens[editing.person.id]" :pay="editing.pay" @close="editing = null" @saved="editing = null" />
  </div>
</template>
