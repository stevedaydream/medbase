<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { data } from '../lib/data'
import { pushRecent } from '../lib/records'
import { sanitizeHtml } from '../lib/sanitize'

const route = useRoute()
const memo = computed(() => data.tables.shiftMemos.find(m => m.uid === route.params.id))
const html = computed(() => sanitizeHtml(memo.value?.content || ''))
watch(memo, m => { if (m) pushRecent({ to: route.fullPath, title: m.title, type: '備忘' }) }, { immediate: true })
</script>

<template>
  <div class="accent-blue pad-tabbar">
    <PageHeader :title="memo?.title ?? '找不到備忘'" back />
    <div v-if="!memo" class="p-8 text-center text-sm text-muted">這則備忘不存在或已被刪除</div>
    <article v-else class="p-4">
      <p class="text-xs font-bold text-accent mb-3">{{ memo.category || '一般' }}</p>
      <div class="memo rounded-2xl bg-surface border border-hairline p-4 text-fg" v-html="html" />
    </article>
  </div>
</template>

<style scoped>
.memo :deep(p) { margin: 0.5rem 0; line-height: 1.7; }
.memo :deep(h1), .memo :deep(h2), .memo :deep(h3) { font-weight: 800; margin: 1rem 0 0.5rem; padding-left: 0.5rem; border-left: 3px solid var(--color-accent); }
.memo :deep(ul) { list-style: disc; padding-left: 1.25rem; }
.memo :deep(ol) { list-style: decimal; padding-left: 1.25rem; }
.memo :deep(li) { margin: 0.25rem 0; line-height: 1.6; }
.memo :deep(strong) { font-weight: 700; }
.memo :deep(a) { color: var(--color-accent); text-decoration: underline; }
.memo :deep(blockquote) { border-left: 3px solid var(--color-hairline); padding-left: 0.75rem; color: var(--color-fg-secondary); }
</style>
