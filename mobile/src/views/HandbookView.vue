<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { data, loadCache, pullRefresh } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { FORMULAS } from '@shared/handbook/formulas'
import { SECTION_LABELS, STATUS_LABELS, parseHbSpec, searchHandbook, visibleEntries, type HbEntry, type HbSection } from '@shared/handbook/types'
import { DISCLAIMER } from '@shared/emergency/types'

/** 隨身工作手冊（ADR-018）：離線可用 */
const route = useRoute()
const router = useRouter()
void loadCache()

type Tab = HbSection | 'formula'
const TABS: { key: Tab; label: string }[] = [
  { key: 'oncall', label: '值班狀況' }, { key: 'surgical', label: '外科照護' },
  { key: 'formula', label: '公式' }, { key: 'admin', label: '行政' },
]
const tab = computed<Tab>(() => (route.query.tab as Tab) || 'oncall')
const setTab = (t: Tab) => router.replace({ query: { tab: t } })

const entries = computed<HbEntry[]>(() => visibleEntries(data.tables.handbook
  .map(r => ({ uid: r.uid, name: r.name, spec: parseHbSpec(r.spec)! }))
  .filter(e => !!e.spec)))
const emNames = computed(() => Object.fromEntries(data.tables.emergency.map(r => [r.uid, r.name])))
const q = ref('')
const list = computed(() => tab.value === 'formula' ? [] : searchHandbook(entries.value.filter(e => e.spec.section === tab.value), q.value))
const selected = computed(() => entries.value.find(e => e.uid === route.query.e) ?? null)
const open = (e: HbEntry) => router.push({ query: { tab: tab.value, e: e.uid } })

// ── 公式 ─────────────────────────────────────────────────────
const formula = computed(() => FORMULAS.find(f => f.id === route.query.f) ?? null)
const inputs = ref<Record<string, string>>({})
watch(() => route.query.f, () => { inputs.value = {} })
const out = computed(() => formula.value?.compute(Object.fromEntries(Object.entries(inputs.value).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))) ?? null)

const title = computed(() => selected.value?.name ?? formula.value?.name ?? '工作手冊')
usePullRefresh(() => pullRefresh(['handbook', 'emergency']))
</script>

<template>
  <div class="pad-tabbar">
    <PageHeader :title="title" :back="!!(selected || formula)">
      <div v-if="!selected && !formula" class="px-4 pb-2">
        <div class="grid grid-cols-4 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="t in TABS" :key="t.key" @click="setTab(t.key)" class="h-9 rounded-lg"
            :class="tab === t.key ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ t.label }}</button>
        </div>
      </div>
    </PageHeader>

    <!-- 公式計算 -->
    <div v-if="formula" class="p-4 space-y-3">
      <p class="text-xs text-muted font-mono">{{ formula.formula }}</p>
      <label v-for="i in formula.inputs" :key="i.key" class="block">
        <span class="text-sm font-bold text-fg">{{ i.label }} <span class="text-muted font-normal">{{ i.unit }}</span></span>
        <div v-if="i.options" class="mt-1 grid grid-cols-2 gap-2">
          <button v-for="o in i.options" :key="o.value" @click="inputs[i.key] = String(o.value)" class="h-11 rounded-xl border font-bold"
            :class="inputs[i.key] === String(o.value) ? 'bg-accent text-white border-accent' : 'bg-sunken border-hairline'">{{ o.label }}</button>
        </div>
        <input v-else v-model="inputs[i.key]" inputmode="decimal" class="mt-1 w-full h-12 px-4 rounded-xl bg-sunken border border-hairline text-xl font-mono" />
      </label>
      <div v-if="out" class="p-4 rounded-2xl bg-accent/10 border border-accent/30">
        <p class="text-3xl font-black text-accent font-mono">{{ out.value }} <span class="text-base">{{ out.unit }}</span></p>
        <p v-if="out.note" class="text-sm text-fg-secondary mt-1">{{ out.note }}</p>
      </div>
      <p v-if="formula.normal" class="text-xs text-muted">參考：{{ formula.normal }}</p>
      <a :href="formula.ref.url" target="_blank" rel="noopener" class="block text-xs underline text-muted">📚 {{ formula.ref.title }}</a>
    </div>

    <!-- 條目內容 -->
    <div v-else-if="selected" class="p-4 space-y-4">
      <div v-if="selected.spec.status === 'literature'" class="p-3 rounded-xl bg-warning/15 border border-warning/40 text-xs font-bold text-warning">
        ⚠ {{ STATUS_LABELS.literature }}：依國際指引與教科書整理
      </div>
      <div v-if="selected.spec.emergency.some(u => emNames[u])" class="flex flex-wrap gap-2">
        <RouterLink v-for="u in selected.spec.emergency.filter(x => emNames[x])" :key="u" :to="`/emergency?c=${u}`"
          class="px-3 py-2 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm font-bold">🚨 {{ emNames[u] }}</RouterLink>
      </div>
      <section v-for="b in selected.spec.blocks.filter(x => x.items.length)" :key="b.title" class="p-4 rounded-2xl bg-surface border border-hairline">
        <h3 class="text-sm font-black text-accent mb-2">{{ b.title }}</h3>
        <ul class="space-y-1.5">
          <li v-for="(it, i) in b.items" :key="i" class="text-[15px] text-fg flex gap-2 leading-snug"><span class="text-muted">•</span>{{ it }}</li>
        </ul>
      </section>
      <p v-if="selected.spec.notes" class="text-sm text-fg-secondary">📝 {{ selected.spec.notes }}</p>
      <div class="pt-3 border-t border-hairline text-[11px] text-muted space-y-1">
        <p>依據：{{ selected.spec.source || '—' }}<template v-if="selected.spec.reviewer">　審核：{{ selected.spec.reviewer }}</template></p>
        <p v-for="(r, i) in selected.spec.refs" :key="r.url"><a :href="r.url" target="_blank" rel="noopener" class="underline">📚 [{{ i + 1 }}] {{ r.title }}</a></p>
        <p class="font-bold">{{ DISCLAIMER }}</p>
      </div>
    </div>

    <!-- 公式清單 -->
    <div v-else-if="tab === 'formula'" class="p-4">
      <div class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
        <RouterLink v-for="f in FORMULAS" :key="f.id" :to="{ query: { tab: 'formula', f: f.id } }" class="flex items-center px-4 py-3.5">
          <span class="flex-1 font-bold text-fg">{{ f.name }}</span><span class="text-muted">›</span>
        </RouterLink>
      </div>
    </div>

    <!-- 條目清單 -->
    <div v-else class="p-4 space-y-3">
      <input v-model="q" placeholder="搜尋" class="w-full h-11 px-4 rounded-xl bg-surface border border-hairline" />
      <p v-if="!list.length" class="py-12 text-center text-sm text-muted">
        {{ tab === 'admin' ? '院內流程尚未填寫' : data.refreshing ? '下載中…' : '沒有資料，下拉更新' }}
      </p>
      <div v-else class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
        <button v-for="e in list" :key="e.uid" @click="open(e)" class="w-full flex items-center gap-2 px-4 py-3.5 text-left">
          <span class="flex-1 min-w-0">
            <span class="block font-bold text-fg">{{ e.name }}</span>
            <span class="block text-xs text-muted">{{ e.spec.category }}</span>
          </span>
          <span class="text-muted">›</span>
        </button>
      </div>
      <p class="text-[11px] text-muted">{{ SECTION_LABELS[tab as HbSection] }}：文獻版內容尚未經院內審核，{{ DISCLAIMER }}</p>
    </div>
  </div>
</template>
