<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import EmergencyCardPanel from '../components/EmergencyCardPanel.vue'
import { data, loadCache, pullRefresh } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { searchCards, visibleCards } from '@shared/emergency/logic'
import { parseSpec, EM_CATEGORIES, type EmCard } from '@shared/emergency/types'

/** 數值判讀（ADR-017）：離線可用；選卡 → 輸入數值、回答是非題 → 顯示符合級距的處置 */
const route = useRoute()
const router = useRouter()
void loadCache()

const cards = computed<EmCard[]>(() => visibleCards(data.tables.emergency
  .map(r => ({ uid: r.uid, name: r.name, spec: parseSpec(r.spec) }))
  .filter((c): c is EmCard => !!c.spec)))
const q = ref('')
const list = computed(() => searchCards(cards.value, q.value))
const groups = computed(() => [...new Set([...EM_CATEGORIES, ...list.value.map(c => c.spec.category)])]
  .map(cat => ({ cat, items: list.value.filter(c => c.spec.category === cat) })).filter(g => g.items.length))

const selected = computed(() => cards.value.find(c => c.uid === route.query.c) ?? null)
const open = (c: EmCard) => router.push({ query: { c: c.uid } })

usePullRefresh(() => pullRefresh(['emergency']))
</script>

<template>
  <div class="pad-tabbar">
    <PageHeader :title="selected ? selected.name : '數值判讀'" back />

    <div v-if="!selected" class="p-4 space-y-4">
      <input v-model="q" placeholder="搜尋：K、低血鈉、血壓、血糖…" class="w-full h-12 px-4 rounded-2xl bg-surface border border-hairline text-base" />
      <p v-if="!cards.length" class="py-12 text-center text-sm text-muted">{{ data.refreshing ? '下載中…' : '還沒有數值判讀卡，下拉更新' }}</p>
      <section v-for="g in groups" :key="g.cat">
        <p class="text-xs font-bold text-muted mb-2">{{ g.cat }}</p>
        <div class="grid grid-cols-2 gap-2">
          <button v-for="c in g.items" :key="c.uid" @click="open(c)"
            class="h-16 px-3 rounded-2xl bg-surface border border-hairline text-fg font-black text-base text-left">
            {{ c.name }}
            <span v-if="c.spec.status === 'literature'" class="block text-[10px] font-bold text-warning">文獻版</span>
          </button>
        </div>
      </section>
    </div>

    <div v-else class="p-4">
      <EmergencyCardPanel :card="selected" />
    </div>
  </div>
</template>
