<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { session } from '../lib/session'
import { geminiKey, GEMINI_MODEL } from '../lib/gemini'
import { toast } from '../lib/ui'
import { DOCX_TEMPLATES, dayCount, type MetaValues, type BlockValues } from '@shared/docxTemplates'
import { readSourceFile, buildGeminiParts, generateBlocks, renderDocx, DOCX_MIME, type SourceFile, type TemplateKey } from '@shared/docxCompose'

/**
 * 病例討論／公假心得（ADR-013）：上傳 PDF／PPTX 或貼文字 → 以自己的 Gemini 金鑰整理 →
 * 產生 Word（與桌機共用模板與流程 shared/docxCompose）→ 手機分享選單寄出。
 * 內容不保存在手機上。
 */
const template = ref<TemplateKey>('case')
const tpl = computed(() => DOCX_TEMPLATES[template.value])
const meta = reactive<MetaValues>({})
const blocks = reactive<BlockValues>({})
const files = ref<SourceFile[]>([])
const manualText = ref('')
const deidentify = ref(true)
const busy = ref<'' | 'generate' | 'export'>('')

function reset() {
  for (const k of Object.keys(meta)) delete meta[k]
  for (const f of tpl.value.fields) meta[f.key] = f.default ?? ''
  // 公假心得：姓名、員編帶入登入者（HIS 帳號＝員工編號）
  if (template.value === 'leave' && session.user) { meta.name = session.user.name; meta.emp_id = session.user.his }
  if (template.value === 'case' && !meta.date) {
    const d = new Date(); meta.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  for (const k of Object.keys(blocks)) delete blocks[k]
  for (const b of tpl.value.blocks) blocks[b.key] = ''
  files.value = []
  manualText.value = ''
  deidentify.value = template.value === 'case'
}
watch(template, reset, { immediate: true })
watch(() => meta.date_from, v => { if (v && !meta.date_to) meta.date_to = v })
const leaveDays = computed(() => template.value === 'leave' ? dayCount(meta.date_from, meta.date_to) : null)

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  for (const file of Array.from(input.files ?? [])) {
    if (file.size > 15 * 1024 * 1024) { toast(`「${file.name}」超過 15 MB`); continue }
    const src = readSourceFile(file.name, new Uint8Array(await file.arrayBuffer()))
    if (!src) { toast(`不支援的格式：${file.name}`); continue }
    if (src.kind === 'pptx' && !src.text?.trim()) { toast(`「${file.name}」未抽取到文字`); continue }
    files.value.push(src)
  }
  input.value = ''
}

const hasSource = computed(() => files.value.length > 0 || manualText.value.trim().length > 0)
async function generate() {
  if (!geminiKey.value) { toast('請先到「設定」填入 Gemini 金鑰'); return }
  busy.value = 'generate'
  try {
    const parts = buildGeminiParts(template.value, files.value, manualText.value, deidentify.value)
    Object.assign(blocks, await generateBlocks(template.value, geminiKey.value, GEMINI_MODEL, parts))
    toast('AI 整理完成，可再修改後匯出')
  } catch (e) {
    toast(`整理失敗：${(e as Error).message}`, 4000)
  } finally { busy.value = '' }
}

async function exportAndShare() {
  busy.value = 'export'
  try {
    const bytes = renderDocx(template.value, { ...meta }, { ...blocks })
    const name = tpl.value.fileName(meta)
    const file = new File([bytes], name, { type: DOCX_MIME })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') throw e
      }
    } else {
      // 不支援分享檔案的瀏覽器：直接下載
      const url = URL.createObjectURL(file)
      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast('此瀏覽器不支援分享檔案，已改為下載')
    }
  } catch (e) {
    toast(`匯出失敗：${(e as Error).message}`)
  } finally { busy.value = '' }
}

const inputCls = 'w-full h-11 px-3 rounded-xl bg-sunken border border-hairline text-base text-fg outline-none focus:border-accent/60'
</script>

<template>
  <div class="accent-cyan pad-tabbar">
    <PageHeader title="病例討論／公假心得" back>
      <div class="px-4 pb-2">
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm font-bold">
          <button v-for="k in (['case', 'leave'] as const)" :key="k" @click="template = k" class="h-9 rounded-lg"
            :class="template === k ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ DOCX_TEMPLATES[k].label }}</button>
        </div>
      </div>
    </PageHeader>

    <div class="p-4 space-y-4">
      <RouterLink v-if="!geminiKey" to="/settings" class="block p-3 rounded-2xl bg-warning/10 text-warning text-sm font-bold">
        尚未設定 Gemini 金鑰，AI 整理無法使用 → 到「設定」申請與填入
      </RouterLink>

      <!-- 基本欄位 -->
      <section class="rounded-2xl bg-surface border border-hairline p-4 space-y-3">
        <p class="font-bold text-fg">{{ tpl.heading }}</p>
        <div class="grid grid-cols-2 gap-3">
          <label v-for="f in tpl.fields" :key="f.key" class="text-xs font-bold text-muted"
            :class="['course_name', 'purpose', 'location', 'topic'].includes(f.key) ? 'col-span-2' : ''">
            {{ f.label }}
            <div v-if="f.type === 'toggle'" class="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
              <button v-for="o in f.toggleOptions" :key="o" type="button" @click="meta[f.key] = o" class="h-9 rounded-lg text-sm"
                :class="meta[f.key] === o ? 'bg-surface text-accent shadow-sm' : 'text-muted'">{{ o }}</button>
            </div>
            <input v-else v-model="meta[f.key]" :type="f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'"
              :placeholder="f.placeholder" :class="inputCls" class="mt-1 font-normal" />
          </label>
        </div>
        <p v-if="leaveDays" class="text-xs text-muted">共 {{ leaveDays }} 日</p>
      </section>

      <!-- 資料來源 -->
      <section class="rounded-2xl bg-surface border border-hairline p-4 space-y-3">
        <p class="font-bold text-fg">資料來源</p>
        <label class="flex items-center justify-center h-12 rounded-xl border-2 border-dashed border-hairline text-sm font-bold text-accent">
          ＋ 選擇 PDF／PPTX
          <input type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple class="hidden" @change="onFiles" />
        </label>
        <div v-for="(f, i) in files" :key="i" class="flex items-center gap-2 text-sm">
          <span class="text-xs font-bold rounded bg-accent/10 text-accent px-1.5 uppercase">{{ f.kind }}</span>
          <span class="flex-1 min-w-0 truncate">{{ f.name }}</span>
          <button @click="files.splice(i, 1)" class="w-8 h-8 text-muted text-lg">×</button>
        </div>
        <textarea v-model="manualText" rows="4" placeholder="或直接貼上／輸入文字…"
          class="w-full px-3 py-2 rounded-xl bg-sunken border border-hairline text-base text-fg outline-none focus:border-accent/60" />
        <label class="flex items-center gap-2 text-sm">
          <input v-model="deidentify" type="checkbox" class="w-5 h-5 accent-accent" />
          去識別化（姓名、病歷號、身分證等以標記取代）
        </label>
        <button @click="generate" :disabled="!hasSource || !!busy" class="w-full h-12 rounded-xl bg-accent text-white font-bold disabled:opacity-40">
          {{ busy === 'generate' ? 'AI 整理中…（約 10–30 秒）' : 'AI 整理內容' }}
        </button>
      </section>

      <!-- AI 區塊 -->
      <section v-for="b in tpl.blocks" :key="b.key" class="rounded-2xl bg-surface border border-hairline p-4">
        <p class="font-bold text-fg mb-2">{{ b.label }}</p>
        <textarea v-model="blocks[b.key]" rows="6" :placeholder="b.instruction"
          class="w-full px-3 py-2 rounded-xl bg-sunken border border-hairline text-base text-fg leading-relaxed outline-none focus:border-accent/60" />
      </section>

      <button @click="exportAndShare" :disabled="!!busy" class="w-full h-12 rounded-xl bg-success text-white font-bold disabled:opacity-40">
        {{ busy === 'export' ? '產生中…' : '匯出 Word 並分享（寄信）' }}
      </button>
      <p class="text-xs text-muted text-center">內容不會保存在手機上，離開此頁前請先匯出。</p>
    </div>
  </div>
</template>
