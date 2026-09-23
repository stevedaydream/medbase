<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import BottomSearch from '../components/BottomSearch.vue'
import SideDrawer from '../components/SideDrawer.vue'
import SecretText from '../components/SecretText.vue'
import { data, pullRefresh } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { matchTerms, copy } from '../lib/ui'

/**
 * 通訊錄：人員（含 HIS 帳密，作為沒有桌機時的備援）＋單位分機（ADR-013）。
 * 密碼預設遮蔽、點一下露出約 10 秒；分機、HIS 帳號、密碼都可點一下複製。
 */
type Tab = 'all' | 'person' | 'unit'
interface Entry {
  kind: 'person' | 'unit'; key: string; name: string; group: string; title: string
  ext: string; hisAccount: string; hisPassword: string; notes: string; haystack: string
}

const route = useRoute()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const tab = ref<Tab>('all')
const groupFilter = ref('')
const titleFilter = ref('')
const drawer = ref(false)
const s = (v: string | undefined) => (v ?? '').trim()

const entries = computed<Entry[]>(() => [
  ...data.tables.physicians.map(p => ({
    kind: 'person' as const, key: `p-${p.name}`, name: p.name, group: s(p.department), title: s(p.title),
    ext: s(p.ext), hisAccount: s(p.his_account), hisPassword: s(p.his_password), notes: s(p.notes),
  })),
  ...data.tables.contacts.map(c => ({
    kind: 'unit' as const, key: `u-${c.uid}`, name: c.label, group: s(c.category) || '常用分機', title: '',
    ext: s(c.ext), hisAccount: '', hisPassword: '', notes: s(c.notes),
  })),
].map(e => ({ ...e, haystack: [e.name, e.group, e.title, e.ext, e.hisAccount, e.notes].join(' ') }))
  .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'person' ? -1 : 1) || a.group.localeCompare(b.group, 'zh-TW') || a.name.localeCompare(b.name, 'zh-TW')))

const matched = computed(() => entries.value.filter(e => matchTerms(e.haystack, q.value)))
const counts = computed(() => ({
  all: matched.value.length,
  person: matched.value.filter(e => e.kind === 'person').length,
  unit: matched.value.filter(e => e.kind === 'unit').length,
}))
const inTab = computed(() => tab.value === 'all' ? matched.value : matched.value.filter(e => e.kind === tab.value))
const groups = computed(() => [...new Set(entries.value.filter(e => tab.value === 'all' || e.kind === tab.value).map(e => e.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-TW')))
const titles = computed(() => [...new Set(entries.value.filter(e => e.kind === 'person').map(e => e.title).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-TW')))
const filtered = computed(() => inTab.value.filter(e =>
  (!groupFilter.value || e.group === groupFilter.value) && (!titleFilter.value || e.title === titleFilter.value)))
const filterCount = computed(() => (groupFilter.value ? 1 : 0) + (titleFilter.value ? 1 : 0))

const TABS: { key: Tab; label: string }[] = [{ key: 'all', label: '全部' }, { key: 'person', label: '人員' }, { key: 'unit', label: '單位分機' }]
function setTab(t: Tab) {
  tab.value = t
  if (groupFilter.value && !groups.value.includes(groupFilter.value)) groupFilter.value = ''
  if (t === 'unit') titleFilter.value = ''
}

usePullRefresh(() => pullRefresh(['physicians', 'contacts']))
</script>

<template>
  <div class="accent-cyan pad-search">
    <PageHeader title="通訊錄">
      <div class="px-4 pb-2">
        <div class="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="t in TABS" :key="t.key" @click="setTab(t.key)" class="h-9 rounded-lg"
            :class="tab === t.key ? 'bg-surface text-accent shadow-sm' : 'text-muted'">
            {{ t.label }} <span class="opacity-70 tabular-nums">{{ counts[t.key] }}</span>
          </button>
        </div>
      </div>
    </PageHeader>

    <div class="p-4 space-y-2">
      <div v-if="filterCount" class="flex flex-wrap gap-1.5">
        <button v-if="groupFilter" @click="groupFilter = ''" class="h-8 px-3 rounded-full bg-accent/10 text-accent text-sm">{{ groupFilter }} ×</button>
        <button v-if="titleFilter" @click="titleFilter = ''" class="h-8 px-3 rounded-full bg-accent/10 text-accent text-sm">{{ titleFilter }} ×</button>
      </div>
      <p v-if="!filtered.length" class="py-12 text-center text-sm text-muted">{{ q || filterCount ? '找不到符合條件的資料' : '尚無資料' }}</p>

      <article v-for="e in filtered" :key="e.key" class="rounded-2xl bg-surface border border-hairline p-3.5">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <p class="font-bold text-fg">
              <span v-if="tab === 'all'" class="mr-1.5 rounded px-1 text-2xs font-bold align-middle"
                :class="e.kind === 'person' ? 'bg-accent/10 text-accent' : 'bg-warning/15 text-warning'">{{ e.kind === 'person' ? '人員' : '單位' }}</span>
              {{ e.name }}
            </p>
            <p class="text-xs text-muted">{{ [e.group, e.title].filter(Boolean).join(' · ') || '—' }}</p>
          </div>
          <button v-if="e.ext" @click="copy(e.ext, '分機')" class="shrink-0 text-right">
            <span class="block font-mono text-lg font-black text-accent tabular-nums leading-tight">{{ e.ext }}</span>
            <span class="block text-2xs text-muted">點擊複製</span>
          </button>
        </div>
        <div v-if="e.hisAccount || e.hisPassword" class="mt-2.5 grid grid-cols-2 gap-2 text-sm">
          <button @click="copy(e.hisAccount, 'HIS 帳號')" :disabled="!e.hisAccount" class="rounded-xl bg-sunken px-3 py-2 text-left">
            <span class="block text-2xs text-muted">HIS 帳號</span>
            <span class="font-mono text-fg">{{ e.hisAccount || '—' }}</span>
          </button>
          <div class="rounded-xl bg-sunken px-3 py-2">
            <span class="block text-2xs text-muted">HIS 密碼</span>
            <SecretText :value="e.hisPassword" label="HIS 密碼" />
          </div>
        </div>
        <p v-if="e.notes" class="mt-2 text-xs text-fg-secondary">{{ e.notes }}</p>
      </article>
    </div>

    <SideDrawer v-model="drawer" title="篩選">
      <div class="p-4 space-y-5">
        <div>
          <p class="text-xs font-bold text-muted mb-2">{{ tab === 'unit' ? '分類' : tab === 'person' ? '科別' : '科別／分類' }}</p>
          <div class="flex flex-wrap gap-2">
            <button @click="groupFilter = ''" class="h-9 px-3 rounded-full text-sm border" :class="!groupFilter ? 'bg-accent text-white border-accent' : 'border-hairline text-fg-secondary'">全部</button>
            <button v-for="g in groups" :key="g" @click="groupFilter = g" class="h-9 px-3 rounded-full text-sm border"
              :class="groupFilter === g ? 'bg-accent text-white border-accent' : 'border-hairline text-fg-secondary'">{{ g }}</button>
          </div>
        </div>
        <div v-if="tab !== 'unit'">
          <p class="text-xs font-bold text-muted mb-2">職稱</p>
          <div class="flex flex-wrap gap-2">
            <button @click="titleFilter = ''" class="h-9 px-3 rounded-full text-sm border" :class="!titleFilter ? 'bg-accent text-white border-accent' : 'border-hairline text-fg-secondary'">全部</button>
            <button v-for="t in titles" :key="t" @click="titleFilter = t" class="h-9 px-3 rounded-full text-sm border"
              :class="titleFilter === t ? 'bg-accent text-white border-accent' : 'border-hairline text-fg-secondary'">{{ t }}</button>
          </div>
        </div>
      </div>
    </SideDrawer>

    <BottomSearch v-model="q" placeholder="搜尋姓名、科別、分機、HIS 帳號…" :filter-count="filterCount" @filter="drawer = true" />
  </div>
</template>
