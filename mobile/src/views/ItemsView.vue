<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import BottomSearch from '../components/BottomSearch.vue'
import SideDrawer from '../components/SideDrawer.vue'
import { items, setRecs, surgeryTypes, surgeryItems } from '../lib/records'
import { copy } from '../lib/ui'
import {
  buildHaystacks, searchItems, makeMatcher, facetOptions, sectionize, activeChips, doctorState, toggleDoctor,
  filterSurgeryOptions, filterSetGroups, filterCount, type Dim, type Key, type Filters, type FilterContext,
} from '@shared/itemsSearch'

/** 自費品項（篩選與搜尋邏輯與桌機共用 shared/itemsSearch） */
const route = useRoute()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const drawer = ref(false)

const filters = ref<Filters>({ dept: new Set(), purpose: new Set(), surgery: new Set(), set: new Set() })
const ctx = computed<FilterContext>(() => ({ filters: filters.value, surgeryItems: surgeryItems.value, sets: setRecs.value }))

const haystacks = computed(() => buildHaystacks(items.value, setRecs.value))
const searched = computed(() => searchItems(items.value, haystacks.value, q.value))
const filtered = computed(() => { const passes = makeMatcher(ctx.value); return searched.value.filter(m => passes(m)) })
const sections = computed(() => sectionize(filtered.value, setRecs.value, filters.value.set))
const facets = computed(() => facetOptions(items.value, searched.value, ctx.value, surgeryTypes.value))
const chips = computed(() => activeChips(filters.value, surgeryTypes.value, facets.value.setGroups))
const nFilters = computed(() => filterCount(filters.value))

function toggle(dim: Dim, key: Key) {
  const next = new Set<Key>(filters.value[dim] as Set<Key>)
  if (next.has(key)) next.delete(key); else next.add(key)
  filters.value = { ...filters.value, [dim]: next }
}
function toggleDoc(setIds: Key[]) {
  filters.value = { ...filters.value, set: toggleDoctor(filters.value.set, setIds) }
}
function removeChip(c: { dim: Dim; key: Key; setIds?: Key[] }) {
  if (c.setIds) toggleDoc(c.setIds); else toggle(c.dim, c.key)
}
function reset() { filters.value = { dept: new Set(), purpose: new Set(), surgery: new Set(), set: new Set() } }

const open = ref<Record<Dim, boolean>>({ dept: true, purpose: false, surgery: false, set: false })
const surgeryQ = ref('')
const setQ = ref('')
const visibleSurgery = computed(() => filterSurgeryOptions(facets.value.surgery, surgeryQ.value, filters.value.surgery))
const visibleGroups = computed(() => filterSetGroups(facets.value.setGroups, setQ.value, filters.value.set))
const has = (dim: Dim, key: Key) => (filters.value[dim] as Set<Key>).has(key)
</script>

<template>
  <div class="accent-violet pad-search">
    <PageHeader title="自費品項" back>
      <template #right><span class="text-xs text-muted tabular-nums">{{ filtered.length }}/{{ items.length }}</span></template>
      <div v-if="chips.length" class="flex gap-1.5 px-4 pb-2 overflow-x-auto no-scrollbar">
        <span v-for="c in chips" :key="`${c.dim}-${c.key}`" class="shrink-0 inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full bg-accent/10 text-accent text-sm">
          <span class="text-2xs opacity-70">{{ c.type }}</span>{{ c.label }}
          <button @click="removeChip(c)" class="w-6 h-6 text-base" :aria-label="`移除 ${c.label}`">×</button>
        </span>
        <button @click="reset" class="shrink-0 h-8 px-3 text-sm text-muted">清除</button>
      </div>
    </PageHeader>

    <div class="py-2">
      <p v-if="!items.length" class="py-12 text-center text-sm text-muted">尚無資料</p>
      <p v-else-if="!filtered.length" class="py-12 text-center text-sm text-muted">找不到符合條件的品項</p>
      <section v-for="sec in sections" :key="sec.key">
        <h2 v-if="sec.title" class="sticky top-12 z-10 px-4 py-2 bg-sunken border-y border-hairline text-lg font-bold text-fg">
          {{ sec.title }} <span class="text-xs font-normal text-muted">{{ sec.items.length }} 筆</span>
        </h2>
        <div v-for="m in sec.items" :key="m.hospital_code" class="px-4 py-2.5 border-b border-hairline bg-surface">
          <div class="flex items-baseline gap-2">
            <button @click="copy(m.hospital_code, '院內碼')" class="shrink-0 font-mono text-sm font-bold text-accent">{{ m.hospital_code }}</button>
            <span class="flex-1 min-w-0 font-bold text-fg">{{ m.name_zh || m.name_en || '—' }}</span>
            <span class="shrink-0 font-mono font-bold text-success tabular-nums">{{ m.price != null ? `$${m.price.toLocaleString()}` : '—' }}</span>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-secondary">
            <span v-if="m.name_zh && m.name_en">{{ m.name_en }}</span>
            <span v-if="m.purpose" class="rounded-full bg-accent/10 text-accent px-2 py-px font-bold">{{ m.purpose }}</span>
            <span v-for="d in m.depts" :key="d" class="rounded-full bg-sunken border border-hairline px-2 py-px">{{ d }}</span>
            <span v-if="m.unit" class="text-muted">單位 {{ m.unit }}</span>
            <span v-if="m.supplier" class="text-muted">{{ m.supplier }}</span>
            <span v-if="m.notes" class="text-muted">{{ m.notes }}</span>
          </div>
        </div>
      </section>
    </div>

    <SideDrawer v-model="drawer" title="篩選">
      <template #actions>
        <button v-if="nFilters" @click="reset" class="text-sm text-muted">清除</button>
      </template>
      <!-- 科別、用途 -->
      <section v-for="sec in ([{ dim: 'dept', title: '科別', opts: facets.dept }, { dim: 'purpose', title: '用途', opts: facets.purpose }] as const)"
        :key="sec.dim" class="border-b border-hairline">
        <button @click="open[sec.dim] = !open[sec.dim]" class="w-full flex items-center gap-2 px-4 h-12 font-bold text-fg-secondary">
          <span class="w-3 text-muted">{{ open[sec.dim] ? '▾' : '▸' }}</span>{{ sec.title }}
          <span v-if="filters[sec.dim].size" class="rounded-full bg-accent/15 text-accent px-2 text-xs">{{ filters[sec.dim].size }}</span>
        </button>
        <div v-if="open[sec.dim]" class="pb-2">
          <label v-for="o in sec.opts" :key="o.key" class="flex items-center gap-3 px-4 h-11"
            :class="o.count === 0 && !has(sec.dim, o.key) ? 'opacity-40' : ''">
            <input type="checkbox" class="w-5 h-5 accent-accent" :checked="has(sec.dim, o.key)" @change="toggle(sec.dim, o.key)" />
            <span class="flex-1" :class="has(sec.dim, o.key) ? 'text-accent font-bold' : 'text-fg'">{{ o.label }}</span>
            <span class="text-xs text-muted tabular-nums">{{ o.count }}</span>
          </label>
        </div>
      </section>
      <!-- 手術術式 -->
      <section class="border-b border-hairline">
        <button @click="open.surgery = !open.surgery" class="w-full flex items-center gap-2 px-4 h-12 font-bold text-fg-secondary">
          <span class="w-3 text-muted">{{ open.surgery ? '▾' : '▸' }}</span>手術術式
          <span v-if="filters.surgery.size" class="rounded-full bg-accent/15 text-accent px-2 text-xs">{{ filters.surgery.size }}</span>
        </button>
        <div v-if="open.surgery" class="pb-2">
          <input v-if="facets.surgery.length > 8" v-model="surgeryQ" placeholder="篩選術式…"
            class="mx-4 mb-1 w-[calc(100%-2rem)] h-10 px-3 rounded-xl bg-sunken border border-hairline text-base outline-none" />
          <p v-if="!facets.surgery.length" class="px-4 py-2 text-sm text-muted">尚無術式</p>
          <label v-for="o in visibleSurgery" :key="o.key" class="flex items-center gap-3 px-4 min-h-11 py-1"
            :class="o.count === 0 && !has('surgery', o.key) ? 'opacity-40' : ''">
            <input type="checkbox" class="w-5 h-5 accent-accent" :checked="has('surgery', o.key)" @change="toggle('surgery', o.key)" />
            <span class="flex-1" :class="has('surgery', o.key) ? 'text-accent font-bold' : 'text-fg'">{{ o.label }}<span v-if="o.sub" class="ml-1 text-xs text-muted">{{ o.sub }}</span></span>
            <span class="text-xs text-muted tabular-nums">{{ o.count }}</span>
          </label>
        </div>
      </section>
      <!-- 醫師套組 -->
      <section>
        <button @click="open.set = !open.set" class="w-full flex items-center gap-2 px-4 h-12 font-bold text-fg-secondary">
          <span class="w-3 text-muted">{{ open.set ? '▾' : '▸' }}</span>醫師套組
          <span v-if="filters.set.size" class="rounded-full bg-accent/15 text-accent px-2 text-xs">{{ filters.set.size }}</span>
        </button>
        <div v-if="open.set" class="pb-2">
          <input v-if="setRecs.length > 8" v-model="setQ" placeholder="篩選醫師或套組…"
            class="mx-4 mb-1 w-[calc(100%-2rem)] h-10 px-3 rounded-xl bg-sunken border border-hairline text-base outline-none" />
          <p v-if="!setRecs.length" class="px-4 py-2 text-sm text-muted">尚無套組</p>
          <div v-for="g in visibleGroups" :key="g.doctor">
            <label class="flex items-center gap-3 px-4 h-11">
              <input type="checkbox" class="w-5 h-5 accent-accent"
                :checked="doctorState(filters.set, g.setIds) === 'all'" :indeterminate="doctorState(filters.set, g.setIds) === 'some'"
                @change="toggleDoc(g.setIds)" />
              <span class="flex-1 font-bold" :class="doctorState(filters.set, g.setIds) === 'none' ? 'text-fg' : 'text-accent'">{{ g.doctor }}</span>
              <span class="text-xs text-muted tabular-nums">{{ g.count }}</span>
            </label>
            <label v-for="o in g.options" :key="o.key" class="flex items-center gap-3 pl-11 pr-4 min-h-10 py-1"
              :class="o.count === 0 && !has('set', o.key) ? 'opacity-40' : ''">
              <input type="checkbox" class="w-5 h-5 accent-accent" :checked="has('set', o.key)" @change="toggle('set', o.key)" />
              <span class="flex-1 text-sm" :class="has('set', o.key) ? 'text-accent font-bold' : 'text-fg'">{{ o.label }}</span>
              <span class="text-xs text-muted tabular-nums">{{ o.count }}</span>
            </label>
          </div>
        </div>
      </section>
    </SideDrawer>

    <BottomSearch v-model="q" placeholder="搜尋品名、院內碼、廠商、醫師、套組…" :filter-count="nFilters" @filter="drawer = true" />
  </div>
</template>
