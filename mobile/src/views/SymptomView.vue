<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import EmergencyCardPanel from '../components/EmergencyCardPanel.vue'
import { data, loadCache } from '../lib/data'
import { parseSpec, DISCLAIMER, type EmCard } from '@shared/emergency/types'
import { parseHbSpec, STATUS_LABELS } from '@shared/handbook/types'
import { toolById } from '@shared/tools'

/** 依症狀：值班步驟＋數值判讀＋相關藥物＋相關工具，同一頁（離線可用） */
const route = useRoute()
void loadCache()

const entry = computed(() => {
  const r = data.tables.handbook.find(x => x.uid === route.params.uid)
  const spec = r ? parseHbSpec(r.spec) : null
  return r && spec ? { uid: r.uid, name: r.name, spec } : null
})
const cards = computed<EmCard[]>(() => (entry.value?.spec.emergency ?? [])
  .map(u => data.tables.emergency.find(r => r.uid === u))
  .map(r => r ? { uid: r.uid, name: r.name, spec: parseSpec(r.spec)! } : null)
  .filter((c): c is EmCard => !!c && !!c.spec && c.spec.status !== 'draft'))
const drugNames = computed(() => Object.fromEntries(data.tables.handbook.map(r => [r.uid, r.name])))
const cardTab = ref('')
watch(() => route.params.uid, () => { cardTab.value = '' })
const active = computed(() => cards.value.find(c => c.uid === cardTab.value) ?? cards.value[0] ?? null)
const toolLink = (id: string) => { const t = toolById(id)!; return t.kind === 'calc' ? `/tools?tool=${t.calcId}` : `/handbook?tab=formula&f=${t.id}` }
</script>

<template>
  <div class="pad-tabbar">
    <PageHeader :title="entry?.name ?? '症狀'" back />
    <p v-if="!entry" class="py-12 text-center text-sm text-muted">找不到這個症狀</p>
    <div v-else class="p-4 space-y-4">
      <div v-if="entry.spec.status === 'literature'" class="p-3 rounded-xl bg-warning/15 border border-warning/40 text-xs font-bold text-warning">
        ⚠ {{ STATUS_LABELS.literature }}：依國際指引與教科書整理
      </div>

      <div v-if="entry.spec.drugs.length || entry.spec.tools.length" class="flex flex-wrap gap-2">
        <RouterLink v-for="u in entry.spec.drugs.filter(x => drugNames[x])" :key="u" :to="`/handbook?tab=drug&e=${u}`"
          class="px-3 py-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-bold">💊 {{ drugNames[u] }}</RouterLink>
        <RouterLink v-for="t in entry.spec.tools.filter(x => toolById(x))" :key="t" :to="toolLink(t)"
          class="px-3 py-2 rounded-xl bg-surface border border-hairline text-fg-secondary text-sm font-bold">🧮 {{ toolById(t)!.name }}</RouterLink>
      </div>

      <!-- 數值判讀：直接在這頁輸入 -->
      <section v-if="cards.length" class="p-4 rounded-2xl bg-surface border border-hairline space-y-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="text-sm font-black text-fg">📊 數值判讀</h3>
          <button v-for="c in cards" :key="c.uid" @click="cardTab = c.uid" class="px-3 h-8 rounded-lg text-xs font-bold border"
            :class="active?.uid === c.uid ? 'bg-accent text-white border-accent' : 'bg-sunken border-hairline text-fg-secondary'">{{ c.name }}</button>
        </div>
        <EmergencyCardPanel v-if="active" :card="active" />
      </section>

      <!-- 處置步驟 -->
      <section v-for="b in entry.spec.blocks.filter(x => x.items.length)" :key="b.title" class="p-4 rounded-2xl bg-surface border border-hairline">
        <h3 class="text-sm font-black text-accent mb-2">{{ b.title }}</h3>
        <ul class="space-y-1.5">
          <li v-for="(it, i) in b.items" :key="i" class="text-[15px] text-fg flex gap-2 leading-snug"><span class="text-muted">•</span>{{ it }}</li>
        </ul>
      </section>
      <p v-if="entry.spec.notes" class="text-sm text-fg-secondary">📝 {{ entry.spec.notes }}</p>
      <div class="pt-3 border-t border-hairline text-[11px] text-muted space-y-1">
        <p v-for="(r, i) in entry.spec.refs" :key="r.url"><a :href="r.url" target="_blank" rel="noopener" class="underline">📚 [{{ i + 1 }}] {{ r.title }}</a></p>
        <p class="font-bold">{{ DISCLAIMER }}</p>
      </div>
    </div>
  </div>
</template>
