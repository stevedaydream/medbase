<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import BottomSearch from '../components/BottomSearch.vue'
import { data, type Row } from '../lib/data'
import { matchTerms } from '../lib/ui'

/** 套組：處方／手術／疾病／檢查／品項套組五個分頁（與桌機 SetsHubView 相同） */
type Kind = 'prescriptions' | 'surgery' | 'disease' | 'examination' | 'sets'
const TABS: { key: Kind; label: string }[] = [
  { key: 'prescriptions', label: '處方' },
  { key: 'surgery', label: '手術' },
  { key: 'disease', label: '疾病' },
  { key: 'examination', label: '檢查' },
  { key: 'sets', label: '品項套組' },
]
const TAB_KEY = 'mb_sets_tab'
const route = useRoute()
const router = useRouter()
const isKind = (v: unknown): v is Kind => TABS.some(t => t.key === v)
const tab = ref<Kind>(isKind(route.query.tab) ? route.query.tab : isKind(localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) as Kind : 'prescriptions')
watch(tab, t => { localStorage.setItem(TAB_KEY, t); router.replace({ query: { tab: t } }) })
const q = ref('')

/** 每種的「分組」與副標 */
function groupOf(k: Kind, r: Row): string {
  if (k === 'sets') return r.physician_name || '未指定醫師'
  return r.category || '未分類'
}
function subOf(k: Kind, r: Row): string {
  if (k === 'disease') return [r.icd10].filter(Boolean).join('')
  if (k === 'examination') return r.his_code || r.indication || ''
  if (k === 'sets') return r.surgery_type || ''
  return r.indication || ''
}

const groups = computed(() => {
  const k = tab.value
  const rows = data.tables[k]
    .filter(r => matchTerms([r.name, r.category, r.indication, r.icd10, r.his_code, r.physician_name, r.surgery_type].filter(Boolean).join(' '), q.value))
    .sort((a, b) => groupOf(k, a).localeCompare(groupOf(k, b), 'zh-TW') || a.name.localeCompare(b.name, 'zh-TW'))
  const map = new Map<string, Row[]>()
  for (const r of rows) {
    const g = groupOf(k, r)
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(r)
  }
  return [...map.entries()]
})
const total = computed(() => groups.value.reduce((n, [, rs]) => n + rs.length, 0))
</script>

<template>
  <div class="accent-teal pad-search">
    <PageHeader title="套組">
      <div class="flex gap-1.5 px-4 pb-2 overflow-x-auto no-scrollbar">
        <button v-for="t in TABS" :key="t.key" @click="tab = t.key"
          class="shrink-0 h-9 px-4 rounded-full text-sm font-bold border"
          :class="tab === t.key ? 'bg-accent text-white border-accent' : 'bg-sunken text-fg-secondary border-hairline'">
          {{ t.label }} <span class="opacity-70 tabular-nums">{{ data.tables[t.key].length }}</span>
        </button>
      </div>
    </PageHeader>

    <div class="p-4 space-y-4">
      <p v-if="!total" class="py-12 text-center text-sm text-muted">{{ q ? `找不到「${q}」` : '尚無資料' }}</p>
      <section v-for="[g, rows] in groups" :key="g">
        <p class="text-xs font-bold text-muted mb-1.5 px-1">{{ g }} · {{ rows.length }}</p>
        <div class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
          <RouterLink v-for="r in rows" :key="r.uid" :to="`/sets/${tab}/${r.uid}`" class="flex items-center gap-2 px-4 py-3">
            <span class="flex-1 min-w-0">
              <span class="block font-bold text-fg">{{ r.name }}</span>
              <span v-if="subOf(tab, r)" class="block text-xs text-muted truncate">{{ subOf(tab, r) }}</span>
            </span>
            <span class="text-muted">›</span>
          </RouterLink>
        </div>
      </section>
    </div>

    <BottomSearch v-model="q" :placeholder="`搜尋${TABS.find(t => t.key === tab)?.label}…`" />
  </div>
</template>
