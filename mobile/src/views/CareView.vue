<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { data, loadCache, pullRefresh } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { parseSpec, EM_CATEGORIES, type EmCard } from '@shared/emergency/types'
import { visibleCards } from '@shared/emergency/logic'
import { parseHbSpec, visibleEntries, searchHandbook, SECTION_LABELS, type HbEntry } from '@shared/handbook/types'
import { ALL_TOOLS, type ToolRef } from '@shared/tools'

/** 處置及臨床工具：依症狀、數值判讀、藥物速查、計算工具、手冊（離線可用） */
const route = useRoute()
const router = useRouter()
void loadCache()

type Tab = 'symptom' | 'value' | 'drug' | 'tools' | 'manual'
const TABS: { key: Tab; label: string }[] = [
  { key: 'symptom', label: '症狀' }, { key: 'value', label: '數值' }, { key: 'drug', label: '藥物' },
  { key: 'tools', label: '工具' }, { key: 'manual', label: '手冊' },
]
const tab = computed<Tab>(() => (TABS.some(t => t.key === route.query.tab) ? route.query.tab : 'symptom') as Tab)
const setTab = (t: Tab) => router.replace({ query: { tab: t } })
const q = ref('')

const entries = computed<HbEntry[]>(() => visibleEntries(data.tables.handbook
  .map(r => ({ uid: r.uid, name: r.name, spec: parseHbSpec(r.spec)! })).filter(e => !!e.spec)))
const cards = computed<EmCard[]>(() => visibleCards(data.tables.emergency
  .map(r => ({ uid: r.uid, name: r.name, spec: parseSpec(r.spec) })).filter((c): c is EmCard => !!c.spec)))

const symptoms = computed(() => searchHandbook(entries.value.filter(e => e.spec.section === 'oncall'), q.value))
const drugs = computed(() => searchHandbook(entries.value.filter(e => e.spec.section === 'drug'), q.value))
const manual = computed(() => searchHandbook(entries.value.filter(e => e.spec.section === 'surgical' || e.spec.section === 'admin'), q.value))
const valueGroups = computed(() => {
  const w = q.value.trim().toLowerCase()
  const list = cards.value.filter(c => !w || [c.name, ...c.spec.keywords].join(' ').toLowerCase().includes(w))
  return [...new Set([...EM_CATEGORIES, ...list.map(c => c.spec.category)])]
    .map(cat => ({ cat, items: list.filter(c => c.spec.category === cat) })).filter(g => g.items.length)
})
const tools = computed(() => ALL_TOOLS.filter(t => !q.value.trim() || `${t.name} ${t.desc}`.toLowerCase().includes(q.value.trim().toLowerCase())))
const toolLink = (t: ToolRef) => `/tool/${t.id}`

usePullRefresh(() => pullRefresh(['handbook', 'emergency']))
</script>

<template>
  <div class="pad-tabbar">
    <PageHeader title="處置及臨床工具" back>
      <div class="px-4 pb-2">
        <div class="grid grid-cols-5 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="t in TABS" :key="t.key" @click="setTab(t.key)" class="h-9 rounded-lg"
            :class="tab === t.key ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ t.label }}</button>
        </div>
      </div>
    </PageHeader>

    <div class="p-4 space-y-3">
      <input v-model="q" :placeholder="tab === 'symptom' ? '搜尋症狀：喘、發燒、低血壓…' : '搜尋'" class="w-full h-11 px-4 rounded-xl bg-surface border border-hairline" />
      <p v-if="!entries.length && !cards.length" class="py-12 text-center text-sm text-muted">{{ data.refreshing ? '下載中…' : '還沒有資料，下拉更新' }}</p>

      <!-- 依症狀 -->
      <div v-if="tab === 'symptom'" class="grid grid-cols-2 gap-2">
        <RouterLink v-for="e in symptoms" :key="e.uid" :to="`/care/s/${e.uid}`"
          class="h-16 px-3 flex flex-col justify-center rounded-2xl bg-surface border border-hairline">
          <span class="font-black text-fg">{{ e.name }}</span>
          <span class="text-[11px] text-muted">{{ e.spec.category }}</span>
        </RouterLink>
      </div>

      <!-- 數值判讀 -->
      <template v-else-if="tab === 'value'">
        <section v-for="g in valueGroups" :key="g.cat">
          <p class="text-xs font-bold text-muted mb-2">{{ g.cat }}</p>
          <div class="grid grid-cols-2 gap-2">
            <RouterLink v-for="c in g.items" :key="c.uid" :to="`/emergency?c=${c.uid}`"
              class="h-14 px-3 flex items-center rounded-2xl bg-surface border border-hairline font-black text-fg">{{ c.name }}</RouterLink>
          </div>
        </section>
      </template>

      <!-- 計算工具 -->
      <div v-else-if="tab === 'tools'" class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
        <RouterLink v-for="t in tools" :key="t.id" :to="toolLink(t)" class="flex items-center gap-2 px-4 py-3">
          <span class="flex-1 min-w-0"><span class="block font-bold text-fg">{{ t.name }}</span><span class="block text-xs text-muted truncate">{{ t.desc }}</span></span>
          <span class="text-muted">›</span>
        </RouterLink>
      </div>

      <!-- 藥物、手冊 -->
      <div v-else class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
        <RouterLink v-for="e in (tab === 'drug' ? drugs : manual)" :key="e.uid" :to="`/handbook?tab=${e.spec.section}&e=${e.uid}`" class="flex items-center gap-2 px-4 py-3">
          <span class="flex-1 min-w-0"><span class="block font-bold text-fg">{{ e.name }}</span>
            <span class="block text-xs text-muted">{{ tab === 'manual' ? SECTION_LABELS[e.spec.section] + ' · ' : '' }}{{ e.spec.category }}</span></span>
          <span class="text-muted">›</span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
