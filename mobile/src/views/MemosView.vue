<script setup lang="ts">
import { ref, computed } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import BottomSearch from '../components/BottomSearch.vue'
import SideDrawer from '../components/SideDrawer.vue'
import { data, type Row } from '../lib/data'
import { matchTerms } from '../lib/ui'

/** 規則備忘錄（唯讀）：搜尋標題與內文，☰ 依分類篩選 */
const q = ref('')
const drawer = ref(false)
const category = ref('')

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const memos = computed(() => data.tables.shiftMemos
  .map(m => ({ ...m, text: plain(m.content || '') }) as Row & { text: string })
  .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'zh-TW') || Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.title.localeCompare(b.title, 'zh-TW')))
const categories = computed(() => [...new Set(memos.value.map(m => m.category || '一般'))])
const filtered = computed(() => memos.value.filter(m =>
  (!category.value || (m.category || '一般') === category.value) && matchTerms(`${m.title} ${m.category} ${m.text}`, q.value)))

/** 搜尋時顯示命中處附近的文字 */
function snippet(text: string): string {
  const term = q.value.trim().split(/\s+/)[0]?.toLowerCase()
  if (!term) return text.slice(0, 80)
  const i = text.toLowerCase().indexOf(term)
  return i < 0 ? text.slice(0, 80) : `${i > 20 ? '…' : ''}${text.slice(Math.max(0, i - 20), i + 60)}`
}
</script>

<template>
  <div class="accent-blue pad-search">
    <PageHeader title="規則備忘錄" back />
    <div class="p-4 space-y-2">
      <button v-if="category" @click="category = ''" class="h-8 px-3 rounded-full bg-accent/10 text-accent text-sm">{{ category }} ×</button>
      <p v-if="!filtered.length" class="py-12 text-center text-sm text-muted">{{ q || category ? '找不到符合的備忘' : '尚無備忘' }}</p>
      <RouterLink v-for="m in filtered" :key="m.uid" :to="`/memos/${m.uid}`" class="block rounded-2xl bg-surface border border-hairline p-4">
        <p class="text-xs font-bold text-accent">{{ m.category || '一般' }}</p>
        <p class="font-bold text-fg">{{ m.title }}</p>
        <p v-if="m.text" class="mt-1 text-sm text-muted line-clamp-2">{{ snippet(m.text) }}</p>
      </RouterLink>
    </div>

    <SideDrawer v-model="drawer" title="分類">
      <div class="p-2">
        <button @click="category = ''; drawer = false" class="w-full text-left px-3 h-11 rounded-xl" :class="!category ? 'bg-accent/10 text-accent font-bold' : 'text-fg'">全部</button>
        <button v-for="c in categories" :key="c" @click="category = c; drawer = false" class="w-full text-left px-3 h-11 rounded-xl"
          :class="category === c ? 'bg-accent/10 text-accent font-bold' : 'text-fg'">{{ c }}</button>
      </div>
    </SideDrawer>

    <BottomSearch v-model="q" placeholder="搜尋備忘標題或內容…" :filter-count="category ? 1 : 0" @filter="drawer = true" />
  </div>
</template>
