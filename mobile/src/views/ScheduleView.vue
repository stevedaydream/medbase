<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Config } from '../api'
import { gasApi } from '../api'

const props = defineProps<{ config: Config }>()
const emit  = defineEmits<{ toast: [msg: string] }>()

const DOW = ['日','一','二','三','四','五','六']

// Month nav
const now = new Date()
const year  = ref(now.getFullYear())
const month = ref(now.getMonth() + 1)
const yyyyMM = computed(() => `${year.value}${String(month.value).padStart(2,'0')}`)

function prevMonth() { if (month.value === 1) { month.value = 12; year.value-- } else month.value-- }
function nextMonth() { if (month.value === 12) { month.value = 1; year.value++ } else month.value++ }

// Schedule data: rows = [name, d1, d2, ..., d31]
interface Row { name: string; days: (string|null)[] }
const rows    = ref<Row[]>([])
const loading = ref(false)
const errMsg  = ref('')

function cacheKey(mm: string) { return `mb_schedule_${mm}` }

function parseValues(data: (string|number)[][]): Row[] {
  return data.slice(1).map(row => ({
    name: String(row[0] ?? ''),
    days: Array.from({ length: 31 }, (_, i) => {
      const v = row[i + 1]
      return v != null && v !== '' ? String(v) : null
    }),
  }))
}

async function loadSchedule(forceRefresh = false) {
  errMsg.value = ''
  const mm = yyyyMM.value

  // Try cache first (unless forced)
  if (!forceRefresh) {
    const cached = sessionStorage.getItem(cacheKey(mm))
    if (cached) {
      try { rows.value = JSON.parse(cached); return } catch { /* ignore */ }
    }
  }

  loading.value = true
  const extra = props.config.schedule_spreadsheet_id
    ? { spreadsheetId: props.config.schedule_spreadsheet_id }
    : {}
  const r = await gasApi<(string|number)[][]>('getSchedule', { sheetName: `Schedule_${mm}`, ...extra })
  loading.value = false

  if (!r.ok || !r.data || r.data.length < 2) {
    if (!r.ok) errMsg.value = r.error ?? '載入失敗'
    rows.value = []
    return
  }
  rows.value = parseValues(r.data)
  sessionStorage.setItem(cacheKey(mm), JSON.stringify(rows.value))
}

watch(yyyyMM, () => loadSchedule(), { immediate: true })

// Days in month
const daysInMonth = computed(() => new Date(year.value, month.value, 0).getDate())

function dayClass(day: number) {
  const dow = new Date(year.value, month.value - 1, day).getDay()
  if (dow === 0) return 'text-red-400'
  if (dow === 6) return 'text-blue-400'
  return 'text-gray-400'
}

// Find current user's row index
const myName = ref<string|null>(null)
</script>

<template>
  <div class="p-4 pb-6">
    <!-- Month nav -->
    <div class="flex items-center justify-between mb-4">
      <button @click="prevMonth" class="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-800 text-gray-400 hover:text-gray-100 text-lg">‹</button>
      <span class="text-base font-semibold">{{ year }}年{{ month }}月</span>
      <div class="flex items-center gap-1">
        <button @click="loadSchedule(true)" :disabled="loading"
          class="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-800 text-gray-400 hover:text-gray-100 disabled:opacity-40 text-sm"
          title="重新載入">
          {{ loading ? '…' : '↻' }}
        </button>
        <button @click="nextMonth" class="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-800 text-gray-400 hover:text-gray-100 text-lg">›</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center text-gray-500 text-sm py-12">載入中…</div>

    <!-- Error -->
    <div v-else-if="errMsg" class="text-center text-red-400 text-sm py-12">
      {{ errMsg }}<br>
      <button @click="loadSchedule(true)" class="mt-2 text-xs text-gray-500 underline">重試</button>
    </div>

    <!-- Empty -->
    <div v-else-if="!rows.length" class="text-center text-gray-600 text-sm py-12">
      此月尚無已發布的班表
    </div>

    <!-- Table -->
    <div v-else class="overflow-x-auto -mx-4">
      <table class="text-xs border-collapse min-w-max">
        <thead>
          <tr class="bg-gray-900">
            <th class="sticky left-0 z-10 bg-gray-900 px-3 py-2 text-left text-gray-500 font-medium min-w-16">姓名</th>
            <th
              v-for="d in daysInMonth" :key="d"
              class="px-1.5 py-2 text-center w-9"
              :class="dayClass(d)"
            >
              <div>{{ d }}</div>
              <div class="text-gray-600">{{ DOW[new Date(year, month-1, d).getDay()] }}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.name"
            class="border-t border-gray-800/60 hover:bg-gray-800/30 transition-colors">
            <td class="sticky left-0 z-10 bg-gray-950 px-3 py-1.5 font-medium text-gray-300 whitespace-nowrap">{{ row.name }}</td>
            <td
              v-for="(cell, i) in row.days.slice(0, daysInMonth)" :key="i"
              class="px-1 py-1.5 text-center"
            >
              <span v-if="cell"
                class="inline-block min-w-[1.5rem] px-1 py-0.5 rounded text-xs font-semibold"
                :class="{
                  'bg-blue-900/60 text-blue-300':   cell === 'D',
                  'bg-indigo-900/60 text-indigo-300': cell === 'N',
                  'bg-amber-900/60 text-amber-300':  cell === 'AM',
                  'bg-gray-700/60 text-gray-400':    !['D','N','AM'].includes(cell),
                }">{{ cell }}</span>
              <span v-else class="text-gray-700">·</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
