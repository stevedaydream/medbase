<script setup lang="ts">
import { ref } from 'vue'
import { useLogger } from '@/composables/useLogger'

const { logs, clearLogs, exportLogs } = useLogger()

const expanded = ref<Set<number>>(new Set())
const exporting = ref(false)
const exportMsg = ref('')

function toggle(id: number) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}

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

const copied = ref<number | null>(null)

function copyEntry(entry: { id: number; time: string; level: string; message: string; detail?: string }) {
  const text = entry.detail
    ? `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}\n${entry.detail}`
    : `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}`
  navigator.clipboard.writeText(text)
  copied.value = entry.id
  setTimeout(() => { copied.value = null }, 1500)
}

const levelClass: Record<string, string> = {
  error: 'bg-red-900 text-red-300',
  warn:  'bg-yellow-900 text-yellow-300',
  info:  'bg-blue-900 text-blue-300',
}
</script>

<template>
  <div class="fixed bottom-0 right-0 z-[9999] w-[520px] max-h-[320px] flex flex-col bg-gray-950 border border-gray-700 shadow-2xl rounded-tl-lg font-mono text-xs">
    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-700 rounded-tl-lg shrink-0">
      <span class="text-gray-400 font-semibold">Debug Log</span>
      <span class="ml-1 bg-gray-700 text-gray-300 rounded px-1.5 py-0.5 text-[10px]">{{ logs.length }}</span>
      <span class="text-gray-600 text-[10px] ml-1">Ctrl+Shift+D 關閉</span>
      <div class="ml-auto flex items-center gap-2">
        <span v-if="exportMsg" class="text-green-400 text-[10px]">{{ exportMsg }}</span>
        <button
          class="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          @click="handleExport"
          :disabled="exporting"
        >{{ exporting ? '匯出中…' : '匯出' }}</button>
        <button
          class="px-2 py-0.5 rounded bg-gray-700 hover:bg-red-800 text-gray-300 transition-colors"
          @click="clearLogs"
        >清除</button>
      </div>
    </div>

    <!-- Log entries -->
    <div class="overflow-y-auto flex-1">
      <div v-if="logs.length === 0" class="text-gray-600 text-center py-6">
        目前無記錄
      </div>
      <div
        v-for="entry in logs"
        :key="entry.id"
        class="border-b border-gray-800 last:border-0"
      >
        <div
          class="flex items-start gap-2 px-3 py-1 hover:bg-gray-900 cursor-pointer select-text"
          @click="entry.detail ? toggle(entry.id) : copyEntry(entry)"
          @dblclick.stop="copyEntry(entry)"
          :title="copied === entry.id ? '已複製' : '點擊複製 / 展開堆疊'"
        >
          <span class="shrink-0 text-gray-500 mt-0.5">{{ entry.time }}</span>
          <span
            class="shrink-0 rounded px-1 py-0.5 text-[10px] leading-none mt-0.5"
            :class="levelClass[entry.level]"
          >{{ entry.level.toUpperCase() }}</span>
          <span class="break-all leading-relaxed transition-colors" :class="copied === entry.id ? 'text-green-400' : 'text-gray-200'">{{ copied === entry.id ? '✓ 已複製' : entry.message }}</span>
          <span v-if="entry.detail" class="ml-auto shrink-0 text-gray-600 mt-0.5">
            {{ expanded.has(entry.id) ? '▲' : '▼' }}
          </span>
        </div>
        <div
          v-if="entry.detail && expanded.has(entry.id)"
          class="px-3 pb-2 pt-0.5 text-gray-500 whitespace-pre-wrap break-all bg-gray-900 cursor-pointer hover:text-gray-400"
          @click.stop="copyEntry(entry)"
          :title="'點擊複製完整記錄'"
        >{{ entry.detail }}</div>
      </div>
    </div>
  </div>
</template>
