<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { research, table } from '../lib/research'
import { toast } from '../lib/ui'
import { stageMeta, studyTypeLabel } from '@shared/researchMeta'
import { wordCount } from '@shared/manuscriptFiles'
import { sectionsToMarkdown, manuscriptTitle, assetIdOf, isMd } from '@shared/manuscriptMarkdown'
import { renderMarkdown } from '@shared/markdown/render'
import { buildDocx } from '@shared/markdown/export/docx'
import { emptyAssets } from '@shared/markdown/export/html'
import { normalizePrint } from '@shared/markdown/export/settings'

/** 論文專案詳情（唯讀）：概要、作者、稿件；稿件可匯出 Word 並分享 */
const route = useRoute()
const router = useRouter()
if (!research.snapshot) router.replace('/research')

const id = String(route.params.id)
const project = computed(() => table('research_projects').find(p => String(p.id) === id))
const tab = ref<'overview' | 'manuscript' | 'authors'>('manuscript')

const authors = computed(() => {
  const byId = new Map(table('research_authors').map(a => [String(a.id), a]))
  return table('research_project_authors')
    .filter(pa => String(pa.project_id) === id)
    .sort((a, b) => Number(a.author_order) - Number(b.author_order))
    .map(pa => ({ ...pa, author: byId.get(String(pa.author_id)) }) as Record<string, unknown> & { author?: Record<string, unknown> })
})

const sections = computed(() => table('research_manuscript_sections')
  .filter(s => String(s.project_id) === id)
  .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
  .map(s => ({ id: String(s.id), title: String(s.title), body: String(s.body ?? ''), format: String(s.format ?? 'text') })))

// 稿件圖片（ms-asset:<id>）：備份中的 base64
const assetRows = computed(() => new Map(table('research_manuscript_assets')
  .filter(a => String(a.project_id) === id).map(a => [String(a.id), a])))
function assetUri(src: string): string {
  const a = assetRows.value.get(assetIdOf(src) ?? '')
  return a ? `data:${a.mime};base64,${a.data}` : ''
}
/** Markdown 段落的顯示（原文 HTML 不輸出，公式用 MathML） */
const renderedHtml = computed(() => {
  const s = sections.value[activeSec.value]
  return s && isMd(s) ? renderMarkdown(s.body, { math: 'mathml', image: assetUri }).html : ''
})
const activeSec = ref(0)
const totalWords = computed(() => sections.value.reduce((n, s) => n + wordCount(s.body), 0))

async function share() {
  if (!sections.value.length) return
  const title = String(project.value?.title ?? 'manuscript')
  const name = `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.docx`
  // 與桌機相同的 Word 匯出（組稿成 Markdown）；圖片取自備份，mermaid 圖表在手機以原始碼呈現
  const assets = emptyAssets()
  for (const [aid, a] of assetRows.value) {
    const bin = atob(String(a.data))
    assets.images.set(`ms-asset:${aid}`, {
      bytes: Uint8Array.from(bin, c => c.charCodeAt(0)), mime: String(a.mime),
      width: Number(a.width) || 600, height: Number(a.height) || 400,
    })
  }
  const settings = normalizePrint({ title: manuscriptTitle(sections.value, title) })
  const docx = buildDocx(sectionsToMarkdown(sections.value), settings, assets)
  const file = new File([docx], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title })
    else {
      const url = URL.createObjectURL(file)
      Object.assign(document.createElement('a'), { href: url, download: name }).click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast('此瀏覽器不支援分享檔案，已改為下載')
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast(`匯出失敗：${(e as Error).message}`)
  }
}

const FIELDS: [string, string][] = [
  ['specialty', '專科'], ['irb_number', 'IRB 編號'], ['irb_approved_date', 'IRB 核准日'], ['created_at', '建立'], ['updated_at', '最後變更'],
]
</script>

<template>
  <div class="accent-fuchsia pad-tabbar">
    <PageHeader :title="String(project?.title ?? '找不到專案')" back>
      <div class="px-4 pb-2">
        <div class="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="t in ([['manuscript', '稿件'], ['overview', '概要'], ['authors', '作者']] as const)" :key="t[0]" @click="tab = t[0]"
            class="h-9 rounded-lg" :class="tab === t[0] ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ t[1] }}</button>
        </div>
      </div>
    </PageHeader>

    <div v-if="!project" class="p-8 text-center text-sm text-muted">這個專案不在目前的備份中</div>

    <!-- 稿件 -->
    <div v-else-if="tab === 'manuscript'" class="p-4 space-y-3">
      <p v-if="!sections.length" class="py-12 text-center text-sm text-muted">這篇論文還沒有稿件</p>
      <template v-else>
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted">全文 {{ totalWords.toLocaleString() }} 字</span>
          <div class="flex-1" />
          <button @click="share" class="h-9 px-4 rounded-xl bg-accent text-white text-sm font-bold">匯出 Word 並分享</button>
        </div>
        <div class="flex gap-1.5 overflow-x-auto no-scrollbar">
          <button v-for="(s, i) in sections" :key="s.id" @click="activeSec = i" class="shrink-0 h-9 px-3 rounded-full text-sm font-bold border"
            :class="activeSec === i ? 'bg-accent text-white border-accent' : 'bg-surface text-fg-secondary border-hairline'">{{ s.title }}</button>
        </div>
        <article class="rounded-2xl bg-surface border border-hairline p-4">
          <p class="text-xs text-muted mb-2">{{ wordCount(sections[activeSec]?.body ?? '') }} 字</p>
          <div v-if="renderedHtml" class="ms-md text-base leading-relaxed text-fg font-serif" v-html="renderedHtml" />
          <p v-else class="text-base leading-relaxed text-fg whitespace-pre-wrap font-serif">{{ sections[activeSec]?.body || '（空白）' }}</p>
        </article>
      </template>
    </div>

    <!-- 概要 -->
    <div v-else-if="tab === 'overview'" class="p-4">
      <section class="rounded-2xl bg-surface border border-hairline p-4 space-y-2 text-sm">
        <p><span class="text-muted">階段　</span><span class="font-bold">{{ stageMeta(String(project.stage)).label }}</span></p>
        <p><span class="text-muted">研究類型　</span>{{ studyTypeLabel(project.study_type as string | null) }}</p>
        <p v-if="project.title_zh"><span class="text-muted">中文標題　</span>{{ project.title_zh }}</p>
        <p v-for="[k, l] in FIELDS.filter(([k]) => project![k])" :key="k"><span class="text-muted">{{ l }}　</span>{{ project[k] }}</p>
      </section>
    </div>

    <!-- 作者 -->
    <div v-else class="p-4 space-y-2">
      <p v-if="!authors.length" class="py-12 text-center text-sm text-muted">尚未加入作者</p>
      <div v-for="(a, i) in authors" :key="String(a.id)" class="rounded-2xl bg-surface border border-hairline p-4">
        <p class="font-bold text-fg">
          <span class="text-muted tabular-nums mr-1">{{ i + 1 }}.</span>{{ a.author?.name_zh ?? '（名冊已刪除）' }}
          <span v-if="Number(a.is_corresponding)" class="ml-1 text-xs text-accent">通訊作者</span>
        </p>
        <p class="text-xs text-muted">{{ [a.author?.name_en, a.author?.title, a.author?.department].filter(Boolean).join(' · ') }}</p>
        <p v-if="a.irb_category" class="mt-1 text-sm text-fg-secondary">{{ a.irb_category }}<template v-if="a.work_months">（{{ a.work_months }} 個月）</template></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ms-md :deep(p), .ms-md :deep(ul), .ms-md :deep(ol), .ms-md :deep(table), .ms-md :deep(blockquote), .ms-md :deep(pre) { margin: 0 0 0.7em; }
.ms-md :deep(h1), .ms-md :deep(h2), .ms-md :deep(h3), .ms-md :deep(h4) { font-weight: 800; margin: 0.9em 0 0.4em; }
.ms-md :deep(ul) { list-style: disc; padding-left: 1.25rem; }
.ms-md :deep(ol) { list-style: decimal; padding-left: 1.25rem; }
.ms-md :deep(li.md-task) { list-style: none; }
.ms-md :deep(table) { border-collapse: collapse; display: block; overflow-x: auto; font-size: 0.9em; }
.ms-md :deep(th), .ms-md :deep(td) { border: 1px solid var(--color-hairline); padding: 0.2rem 0.5rem; }
.ms-md :deep(blockquote) { border-left: 3px solid var(--color-hairline); padding-left: 0.75rem; color: var(--color-fg-secondary); }
.ms-md :deep(pre) { background: var(--color-sunken); padding: 0.6rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.85em; }
.ms-md :deep(img) { max-width: 100%; border-radius: 0.5rem; }
.ms-md :deep(.md-math) { overflow-x: auto; text-align: center; }
.ms-md :deep(.footnotes) { font-size: 0.85em; color: var(--color-fg-secondary); }
</style>
