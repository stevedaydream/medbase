<script setup lang="ts">
import { ref, computed } from 'vue'
import { useLogger, SESSION_ID } from '@/composables/useLogger'

const { logs, clearLogs, exportLogs, loadHistoricalLogs, clearHistoricalLogs } = useLogger()

// ── 篩選 ─────────────────────────────────────────────────────────
type Filter = 'all' | 'action' | 'error' | 'warn' | 'info'
const filter = ref<Filter>('all')

const filtered = computed(() => {
  const src = showHistory.value ? historicalLogs.value : logs.value
  if (filter.value === 'all')    return src
  if (filter.value === 'error')  return src.filter(l => l.level === 'error')
  return src.filter(l => l.level === filter.value)
})

const counts = computed(() => ({
  all:    logs.value.length,
  action: logs.value.filter(l => l.level === 'action').length,
  error:  logs.value.filter(l => l.level === 'error').length,
  warn:   logs.value.filter(l => l.level === 'warn').length,
  info:   logs.value.filter(l => l.level === 'info').length,
}))

// ── 歷史記錄 ─────────────────────────────────────────────────────
const showHistory     = ref(false)
const historicalLogs  = ref<Awaited<ReturnType<typeof loadHistoricalLogs>>>([])
const loadingHistory  = ref(false)

async function toggleHistory() {
  if (!showHistory.value) {
    loadingHistory.value = true
    try { historicalLogs.value = await loadHistoricalLogs(2000) }
    finally { loadingHistory.value = false }
  }
  showHistory.value = !showHistory.value
}

async function handleClearHistory() {
  await clearHistoricalLogs()
  historicalLogs.value = []
  clearLogs()
}

// ── 展開 / 複製 ───────────────────────────────────────────────────
const expanded = ref<Set<number>>(new Set())
function toggle(id: number) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}

const copied = ref<number | null>(null)
function copyEntry(entry: typeof logs.value[0]) {
  const text = entry.detail
    ? `[${entry.ts?.slice(0,19) ?? entry.time}][${entry.session}][${entry.level.toUpperCase()}]${entry.route ? `[${entry.route}]` : ''} ${entry.message}\n${entry.detail}`
    : `[${entry.ts?.slice(0,19) ?? entry.time}][${entry.session}][${entry.level.toUpperCase()}]${entry.route ? `[${entry.route}]` : ''} ${entry.message}`
  navigator.clipboard.writeText(text)
  copied.value = entry.id
  setTimeout(() => { copied.value = null }, 1500)
}

// ── 匯出 ─────────────────────────────────────────────────────────
const exporting  = ref(false)
const exportMsg  = ref('')
async function handleExport() {
  exporting.value = true
  exportMsg.value = ''
  try {
    const filename = await exportLogs()
    exportMsg.value = `已存至桌面：${filename}`
  } catch (e) {
    exportMsg.value = `匯出失敗：${String(e)}`
  } finally {
    exporting.value = false
    setTimeout(() => { exportMsg.value = '' }, 4000)
  }
}

// ── 樣式 ─────────────────────────────────────────────────────────
const levelClass: Record<string, string> = {
  error:  'bg-red-900   text-red-300',
  warn:   'bg-yellow-900 text-yellow-300',
  info:   'bg-blue-900  text-blue-300',
  action: 'bg-green-900 text-green-300',
}
const rowHover: Record<string, string> = {
  error:  'hover:bg-red-950/40',
  warn:   'hover:bg-yellow-950/30',
  info:   'hover:bg-gray-900',
  action: 'hover:bg-green-950/30',
}

// Session 分隔線：相鄰兩條記錄 session 不同時插入
function isDifferentSession(idx: number): boolean {
  const arr = filtered.value
  if (idx === arr.length - 1) return false
  return arr[idx].session !== arr[idx + 1].session
}
</script>

<template>
  <div
    data-debug-panel
    class="fixed bottom-0 right-0 z-[9999] w-[580px] max-h-[380px] flex flex-col bg-gray-950 border border-gray-700 shadow-2xl rounded-tl-xl font-mono text-xs"
  >
    <!-- ── Header ── -->
    <div class="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-700 rounded-tl-xl shrink-0 flex-wrap gap-y-1">
      <span class="text-gray-400 font-semibold">Debug</span>
      <span class="bg-gray-800 text-gray-500 rounded px-1.5 py-0.5 text-[10px]">{{ SESSION_ID }}</span>
      <span class="text-gray-600 text-[10px]">Ctrl+Shift+D</span>

      <!-- 篩選 tabs -->
      <div class="flex gap-0.5 ml-1">
        <button v-for="(label, key) in ({ all:'全部', action:'操作', error:'錯誤', warn:'警告', info:'Info' } as Record<Filter,string>)"
          :key="key"
          @click="filter = key as Filter"
          class="px-1.5 py-0.5 rounded text-[10px] transition-colors"
          :class="filter === key
            ? 'bg-gray-600 text-white'
            : 'text-gray-600 hover:text-gray-400'">
          {{ label }}<span v-if="key !== 'all' && counts[key as Filter]" class="ml-0.5 opacity-70">{{ counts[key as Filter] }}</span>
        </button>
      </div>

      <div class="ml-auto flex items-center gap-1.5 flex-wrap">
        <span v-if="exportMsg" class="text-green-400 text-[10px]">{{ exportMsg }}</span>
        <button @click="toggleHistory" :disabled="loadingHistory"
          class="px-2 py-0.5 rounded text-[10px] transition-colors"
          :class="showHistory ? 'bg-indigo-700 text-indigo-200' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'">
          {{ loadingHistory ? '載入中…' : showHistory ? '歷史 ▲' : '歷史 ▼' }}
        </button>
        <button @click="handleExport" :disabled="exporting"
          class="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
          {{ exporting ? '…' : '匯出' }}
        </button>
        <button @click="handleClearHistory"
          class="px-2 py-0.5 rounded bg-gray-700 hover:bg-red-800 text-gray-300 transition-colors">
          清除
        </button>
      </div>
    </div>

    <!-- ── Log list ── -->
    <div class="overflow-y-auto flex-1">
      <div v-if="filtered.length === 0" class="text-gray-600 text-center py-6">
        {{ showHistory ? '無歷史記錄' : '目前無記錄' }}
      </div>

      <template v-for="(entry, idx) in filtered" :key="entry.id">
        <div class="border-b border-gray-800/60 last:border-0">
          <!-- 主列 -->
          <div
            class="flex items-start gap-1.5 px-2 py-1 cursor-pointer select-text transition-colors"
            :class="rowHover[entry.level]"
            @click="entry.detail ? toggle(entry.id) : copyEntry(entry)"
            @dblclick.stop="copyEntry(entry)"
          >
            <!-- 時間 -->
            <span class="shrink-0 text-gray-600 mt-0.5 w-[62px]">{{ entry.time }}</span>
            <!-- Level badge -->
            <span class="shrink-0 rounded px-1 py-0.5 text-[9px] leading-none mt-0.5 w-[42px] text-center"
              :class="levelClass[entry.level]">
              {{ entry.level === 'action' ? 'CLICK' : entry.level.toUpperCase() }}
            </span>
            <!-- Route -->
            <span v-if="entry.route" class="shrink-0 text-gray-600 mt-0.5 truncate max-w-[80px]" :title="entry.route">
              {{ entry.route }}
            </span>
            <!-- Message -->
            <span class="flex-1 break-all leading-relaxed transition-colors min-w-0"
              :class="[
                copied === entry.id ? 'text-green-400' : '',
                entry.level === 'action' ? 'text-green-300/80' : 'text-gray-200',
              ]">
              {{ copied === entry.id ? '✓ 已複製' : entry.message }}
            </span>
            <span v-if="entry.detail" class="ml-auto shrink-0 text-gray-600 mt-0.5">
              {{ expanded.has(entry.id) ? '▲' : '▼' }}
            </span>
          </div>
          <!-- Detail 展開 -->
          <div v-if="entry.detail && expanded.has(entry.id)"
            class="px-3 pb-2 pt-0.5 text-gray-500 whitespace-pre-wrap break-all bg-gray-900 cursor-pointer hover:text-gray-400"
            @click.stop="copyEntry(entry)">
            {{ entry.detail }}
          </div>
        </div>

        <!-- Session 分隔線 -->
        <div v-if="isDifferentSession(idx)" class="flex items-center gap-2 px-3 py-1 bg-gray-900/60">
          <div class="flex-1 h-px bg-gray-800"></div>
          <span class="text-[9px] text-gray-700 shrink-0">session {{ filtered[idx+1]?.session }}</span>
          <div class="flex-1 h-px bg-gray-800"></div>
        </div>
      </template>
    </div>
  </div>
</template>
