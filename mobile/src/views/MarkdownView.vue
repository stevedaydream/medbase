<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { toast } from '../lib/ui'
import { renderMarkdown } from '@shared/markdown/render'
import { markdownImage, markdownPdf } from '../lib/markdownPdf'
import 'katex/dist/katex.min.css'

const name = ref('文件.md')
const source = ref('')
const saved = ref('')
const opened = ref(false)
const mode = ref<'read' | 'edit'>('read')
const busy = ref(false)
const page = ref(0)
const pdf = ref<File | null>(null)
const dirty = computed(() => source.value !== saved.value)
const rendered = computed(() => renderMarkdown(source.value, { image: markdownImage }))
const fileName = (ext: string) => `${name.value.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.(md|markdown|pdf)$/i, '') || '文件'}.${ext}`
const canSharePdf = computed(() => !!pdf.value && !!navigator.canShare?.({ files: [pdf.value] }))
watch([source, name], () => { pdf.value = null })

async function openFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/\.(md|markdown)$/i.test(file.name)) { toast('請選擇 .md 或 .markdown 檔案'); return }
  if (file.size > 5 * 1024 * 1024) { toast('檔案超過 5 MB，請先縮小文件'); return }
  if (dirty.value && !window.confirm('目前修改尚未另存，仍要開啟其他檔案嗎？')) return
  try {
    const text = await file.text()
    source.value = saved.value = text.replace(/^\uFEFF/, '')
    name.value = file.name
    opened.value = true
    mode.value = 'read'
  } catch (e) { toast(`開啟失敗：${(e as Error).message}`) }
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
function saveMarkdown() {
  download(new File([source.value], fileName('md'), { type: 'text/markdown;charset=utf-8' }))
  saved.value = source.value
  toast('已另存 .md 檔案')
}
async function exportPdf() {
  busy.value = true
  page.value = 0
  try {
    const blob = await markdownPdf(source.value, fileName('md').replace(/\.md$/, ''), n => { page.value = n })
    pdf.value = new File([blob], fileName('pdf'), { type: 'application/pdf' })
    toast('PDF 已產生，可下載或分享')
  } catch (e) { toast(`PDF 產生失敗：${(e as Error).message}`, 4000) }
  finally { busy.value = false }
}
async function sharePdf() {
  if (!pdf.value) return
  try { await navigator.share({ files: [pdf.value], title: pdf.value.name }) }
  catch (e) { if ((e as Error).name !== 'AbortError') toast(`分享失敗：${(e as Error).message}，可改用下載`) }
}
const confirmLeave = () => !dirty.value || window.confirm('修改尚未另存為 .md，確定離開嗎？')
onBeforeRouteLeave(confirmLeave)
function beforeUnload(e: BeforeUnloadEvent) { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div class="accent-blue pad-tabbar" data-no-pull>
    <PageHeader title="Markdown 文件" back />
    <div class="p-4 space-y-3">
      <label class="flex items-center justify-center h-12 rounded-xl bg-accent text-white font-bold" :class="busy ? 'opacity-40' : ''">
        開啟 .md 檔案
        <input type="file" accept=".md,.markdown,text/markdown,text/plain" class="hidden" aria-label="開啟 Markdown 檔案" :disabled="busy" @change="openFile" />
      </label>
      <p v-if="!opened" class="p-6 rounded-2xl bg-surface border border-hairline text-sm text-muted leading-relaxed">
        從手機選擇 Markdown 檔案，即可閱讀、編輯與匯出 PDF。檔案在手機本機處理，修改後請另存 .md。
      </p>
      <template v-else>
        <label class="block text-xs font-bold text-muted">檔名{{ dirty ? ' · 尚未另存' : '' }}
          <input v-model="name" :disabled="busy" class="mt-1 w-full h-11 px-3 rounded-xl bg-surface border border-hairline text-base text-fg font-normal" aria-label="檔名" />
        </label>
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="m in (['read', 'edit'] as const)" :key="m" @click="mode = m" class="h-10 rounded-lg" :class="mode === m ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ m === 'read' ? '閱讀模式' : '編輯模式' }}</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button @click="saveMarkdown" :disabled="busy" class="h-12 rounded-xl bg-surface border border-hairline font-bold disabled:opacity-40">另存 .md</button>
          <button @click="exportPdf" :disabled="busy || !source.trim()" class="h-12 rounded-xl bg-accent text-white font-bold disabled:opacity-40">{{ busy ? `產生第 ${page || 1} 頁…` : '匯出 PDF' }}</button>
        </div>
        <div v-if="pdf" class="p-3 rounded-2xl bg-surface border border-hairline space-y-2">
          <p class="text-sm break-all">{{ pdf.name }} · {{ Math.ceil(pdf.size / 1024) }} KB</p>
          <div class="flex gap-2">
            <button @click="download(pdf)" class="flex-1 h-11 rounded-xl bg-accent text-white font-bold">下載 PDF</button>
            <button v-if="canSharePdf" @click="sharePdf" class="flex-1 h-11 rounded-xl bg-sunken border border-hairline font-bold">分享 PDF</button>
          </div>
        </div>
        <textarea v-if="mode === 'edit'" v-model="source" :disabled="busy" aria-label="Markdown 內容" spellcheck="false"
          class="w-full min-h-[55vh] p-3 rounded-2xl bg-surface border border-hairline text-base font-mono leading-relaxed outline-none focus:border-accent" />
        <article v-else class="markdown-paper rounded-2xl bg-surface border border-hairline p-4 text-fg" v-html="rendered.html || '<p>這份文件沒有內容。</p>'" />
        <p class="text-xs text-muted leading-relaxed">離開頁面後不保留文件，請先另存。相對路徑圖片須改為完整網址；Mermaid 圖表以原始碼顯示。PDF 使用白底排版，文字以影像呈現。</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.markdown-paper { overflow-wrap: anywhere; line-height: 1.7; }
.markdown-paper :deep(p), .markdown-paper :deep(ul), .markdown-paper :deep(ol), .markdown-paper :deep(pre), .markdown-paper :deep(table), .markdown-paper :deep(blockquote) { margin: 0 0 0.8em; }
.markdown-paper :deep(h1), .markdown-paper :deep(h2), .markdown-paper :deep(h3), .markdown-paper :deep(h4), .markdown-paper :deep(h5), .markdown-paper :deep(h6) { font-weight: 800; margin: 1em 0 0.5em; line-height: 1.35; }
.markdown-paper :deep(h1) { font-size: 1.8em; } .markdown-paper :deep(h2) { font-size: 1.45em; } .markdown-paper :deep(h3) { font-size: 1.2em; }
.markdown-paper :deep(ul) { list-style: disc; padding-left: 1.5em; } .markdown-paper :deep(ol) { list-style: decimal; padding-left: 1.5em; }
.markdown-paper :deep(a) { color: var(--color-accent); text-decoration: underline; }
.markdown-paper :deep(blockquote) { border-left: 3px solid var(--color-hairline); padding-left: 0.8em; color: var(--color-fg-secondary); }
.markdown-paper :deep(pre) { background: var(--color-sunken); border-radius: 0.5rem; padding: 0.8em; overflow-x: auto; }
.markdown-paper :deep(code) { font-family: ui-monospace, monospace; font-size: 0.9em; }
.markdown-paper :deep(table) { border-collapse: collapse; display: block; overflow-x: auto; }
.markdown-paper :deep(th), .markdown-paper :deep(td) { border: 1px solid var(--color-hairline); padding: 0.3em 0.6em; }
.markdown-paper :deep(img) { max-width: 100%; }
.markdown-paper :deep(hr) { border-top: 1px solid var(--color-hairline); margin: 1em 0; }
.markdown-paper :deep(.md-math) { overflow-x: auto; text-align: center; }
.markdown-paper :deep(.md-toc a) { display: block; }
.markdown-paper :deep(.md-toc-2) { padding-left: 1em; }
.markdown-paper :deep(.md-pagebreak) { border-top: 1px dashed var(--color-hairline); margin: 1.5em 0; }
.markdown-paper :deep(.md-task) { list-style: none; }
.markdown-paper :deep(.md-img-missing) { color: var(--color-danger); }
.markdown-paper :deep(.footnotes) { font-size: 0.85em; }
</style>
