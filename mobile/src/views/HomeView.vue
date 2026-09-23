<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import BottomSearch from '../components/BottomSearch.vue'
import DutyCard from '../components/DutyCard.vue'
import { data, pullRefresh } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { recentList } from '../lib/records'
import { matchTerms, copy } from '../lib/ui'
import { session } from '../lib/session'

/** 首頁：全域搜尋＋今日值班＋最近查看（ADR-013） */
const router = useRouter()
const q = ref('')
const recent = recentList()

interface Hit { type: string; title: string; sub: string; to?: string; copyText?: string; copyLabel?: string }

const index = computed<Hit[]>(() => {
  const t = data.tables
  return [
    ...t.prescriptions.map(r => ({ type: '處方', title: r.name, sub: [r.category, r.indication].filter(Boolean).join(' · '), to: `/sets/prescriptions/${r.uid}` })),
    ...t.surgery.map(r => ({ type: '手術', title: r.name, sub: [r.category, r.indication].filter(Boolean).join(' · '), to: `/sets/surgery/${r.uid}` })),
    ...t.disease.map(r => ({ type: '疾病', title: r.name, sub: [r.icd10, r.category].filter(Boolean).join(' · '), to: `/sets/disease/${r.uid}` })),
    ...t.examination.map(r => ({ type: '檢查', title: r.name, sub: [r.his_code, r.category].filter(Boolean).join(' · '), to: `/sets/examination/${r.uid}` })),
    ...t.sets.map(r => ({ type: '套組', title: r.name, sub: [r.physician_name, r.surgery_type].filter(Boolean).join(' · '), to: `/sets/sets/${r.uid}` })),
    ...t.items.map(r => ({ type: '自費', title: r.name_zh || r.name_en || r.hospital_code, sub: [r.hospital_code, r.purpose, r.price ? `$${Number(r.price).toLocaleString()}` : ''].filter(Boolean).join(' · '), to: `/items?q=${encodeURIComponent(r.hospital_code)}`, copyText: r.hospital_code, copyLabel: '院內碼' })),
    ...t.physicians.map(r => ({ type: '人員', title: r.name, sub: [r.department, r.title, r.ext ? `分機 ${r.ext}` : '', r.his_account ? `HIS ${r.his_account}` : ''].filter(Boolean).join(' · '), to: `/contacts?q=${encodeURIComponent(r.name)}`, copyText: r.ext, copyLabel: '分機' })),
    ...t.contacts.map(r => ({ type: '分機', title: r.label, sub: [r.category, r.ext ? `分機 ${r.ext}` : '', r.notes].filter(Boolean).join(' · '), to: `/contacts?q=${encodeURIComponent(r.label)}`, copyText: r.ext, copyLabel: '分機' })),
    ...t.shiftMemos.map(r => ({ type: '備忘', title: r.title, sub: r.category, to: `/memos/${r.uid}` })),
  ]
})

const results = computed(() => {
  if (!q.value.trim()) return []
  return index.value.filter(h => matchTerms(`${h.type} ${h.title} ${h.sub}`, q.value)).slice(0, 80)
})

const empty = computed(() => data.loaded && Object.values(data.tables).every(t => !t.length))

usePullRefresh(() => pullRefresh(['npDuty', 'physicians']))
</script>

<template>
  <div class="pad-search">
    <PageHeader :title="`你好，${session.user?.name ?? ''}`" />

    <div v-if="!q.trim()" class="p-4 space-y-4">
      <p v-if="empty && data.refreshing" class="text-sm text-muted">第一次使用，正在下載資料…</p>
      <p v-else-if="empty && data.offline" class="text-sm text-warning">目前離線，這支手機還沒有資料</p>
      <DutyCard />
      <section v-if="recent.length">
        <p class="text-xs font-bold text-muted mb-2">最近查看</p>
        <div class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
          <RouterLink v-for="r in recent" :key="r.to" :to="r.to" class="flex items-center gap-2 px-4 py-3">
            <span class="text-xs font-bold text-accent w-8">{{ r.type }}</span>
            <span class="flex-1 min-w-0 truncate text-fg">{{ r.title }}</span>
            <span class="text-muted">›</span>
          </RouterLink>
        </div>
      </section>
    </div>

    <div v-else class="p-4">
      <p v-if="!results.length" class="py-12 text-center text-sm text-muted">找不到「{{ q }}」</p>
      <div v-else class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
        <div v-for="(h, i) in results" :key="i" class="flex items-center gap-2 px-4 py-3">
          <button @click="h.to && router.push(h.to)" class="flex-1 min-w-0 flex items-center gap-2 text-left">
            <span class="shrink-0 w-8 text-xs font-bold text-accent">{{ h.type }}</span>
            <span class="min-w-0">
              <span class="block font-bold text-fg truncate">{{ h.title }}</span>
              <span v-if="h.sub" class="block text-xs text-muted truncate">{{ h.sub }}</span>
            </span>
          </button>
          <button v-if="h.copyText" @click="copy(h.copyText!, h.copyLabel)" class="shrink-0 h-9 px-3 rounded-lg bg-sunken text-xs font-bold text-fg-secondary">複製{{ h.copyLabel }}</button>
        </div>
      </div>
    </div>

    <BottomSearch v-model="q" placeholder="搜尋處方、套組、自費品項、人員、分機…" />
  </div>
</template>
