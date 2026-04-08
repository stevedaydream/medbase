<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { SessionUser, Config } from '../api'
import { gasApi } from '../api'

const props = defineProps<{
  session: SessionUser
  config:  Config
  shifts:  string[]
}>()
const emit = defineEmits<{ toast: [msg: string] }>()

const DOW = ['日','一','二','三','四','五','六']

// ── Month / computed ──────────────────────────────────────────────────
const yyyyMM = computed(() => String(props.config.booking_month ?? formatNow()))
function formatNow() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`
}
const year        = computed(() => parseInt(yyyyMM.value.slice(0,4)))
const month       = computed(() => parseInt(yyyyMM.value.slice(4,6)))
const daysInMonth = computed(() => new Date(year.value, month.value, 0).getDate())
const isOpen      = computed(() => String(props.config.booking_open) === 'true')

const dayList = computed(() =>
  Array.from({ length: daysInMonth.value }, (_, i) => {
    const d   = i + 1
    const dow = new Date(year.value, month.value - 1, d).getDay()
    return { d, dow, isSat: dow === 6, isSun: dow === 0 }
  })
)

// ── Draft state ───────────────────────────────────────────────────────
interface DayVote { v1: string|null; v2: string|null; v3: string|null }
type Votes = Record<number, DayVote>  // key = 1-based day
interface RequestRow { code: string; name: string; days: DayVote[] }

const DRAFT_KEY = computed(() => `mb_draft_${yyyyMM.value}`)
const votes = ref<Votes>({})

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY.value)
    votes.value = raw ? JSON.parse(raw) : {}
  } catch { votes.value = {} }
}
function persistDraft() {
  localStorage.setItem(DRAFT_KEY.value, JSON.stringify(votes.value))
}
function saveDraft() {
  persistDraft()
  emit('toast', '草稿已儲存')
}

watch(yyyyMM, loadDraft, { immediate: true })

// ── Other submitted requests (read-only) ─────────────────────────────
const otherRequests   = ref<RequestRow[]>([])
const loadingRequests = ref(false)

async function loadRequests() {
  loadingRequests.value = true
  const r = await gasApi<RequestRow[]>('getRequests', { yyyyMM: yyyyMM.value })
  loadingRequests.value = false
  if (r.ok && r.data) {
    otherRequests.value = r.data.filter(row => row.code !== props.session.code)
  }
}

watch(yyyyMM, loadRequests, { immediate: true })

// ── Bottom sheet picker ───────────────────────────────────────────────
const pickerOpen = ref(false)
const pickerDay  = ref(0)

function openPicker(d: number) {
  if (!isOpen.value) return
  pickerDay.value = d
  if (!votes.value[d]) votes.value[d] = { v1: null, v2: null, v3: null }
  pickerOpen.value = true
}
function closePicker() { pickerOpen.value = false; persistDraft() }

function setVote(key: 'v1'|'v2'|'v3', code: string|null) {
  const d = pickerDay.value
  if (!votes.value[d]) votes.value[d] = { v1: null, v2: null, v3: null }
  votes.value[d][key] = code
  // If v1 cleared, cascade
  if (key === 'v1' && !code) { votes.value[d].v2 = null; votes.value[d].v3 = null }
}

function clearDay() {
  votes.value[pickerDay.value] = { v1: null, v2: null, v3: null }
}

// ── Submit ────────────────────────────────────────────────────────────
const submitting = ref(false)
async function submitVotes() {
  if (!isOpen.value) return
  submitting.value = true
  const days = Array.from({ length: 31 }, (_, i) =>
    votes.value[i+1] ?? { v1: null, v2: null, v3: null }
  )
  const r = await gasApi('saveRequest', {
    code:   props.session.code,
    name:   props.session.name,
    yyyyMM: yyyyMM.value,
    days,
  })
  submitting.value = false
  if (r.ok) {
    emit('toast', '✓ 預約已送出')
    localStorage.removeItem(DRAFT_KEY.value)
    votes.value = {}
  } else {
    emit('toast', '送出失敗：' + (r.error ?? '未知錯誤'))
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
const filledCount = computed(() =>
  Object.values(votes.value).filter(v => v.v1 || v.v2 || v.v3).length
)

function getCellVote(d: number): DayVote {
  return votes.value[d] ?? { v1: null, v2: null, v3: null }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">

    <!-- ── Header info ──────────────────────────────────────────────── -->
    <div class="flex-shrink-0 px-4 pt-3 pb-2">
      <div class="flex items-center justify-between mb-2">
        <p class="text-sm font-semibold text-gray-200">
          {{ year }}年{{ month }}月 預約
        </p>
        <span class="text-xs px-2 py-0.5 rounded-full border font-medium"
          :class="isOpen
            ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300'
            : 'bg-gray-800 border-gray-700 text-gray-600'">
          {{ isOpen ? '● 開放中' : '○ 已關閉' }}
        </span>
      </div>
      <p class="text-xs text-gray-500">
        點格子設定當日志願。
        <span class="inline-block w-2 h-2 rounded-full bg-violet-500 align-middle"></span>紫=第2志願
        <span class="inline-block w-2 h-2 rounded-full bg-amber-500 align-middle ml-1"></span>橘=第3志願
      </p>
      <p v-if="!isOpen" class="text-xs text-red-500 mt-1">預約視窗已關閉，暫時無法修改</p>
    </div>

    <!-- ── Grid ────────────────────────────────────────────────────── -->
    <div class="flex-1 overflow-auto">
      <table class="border-collapse text-xs" style="min-width: max-content">
        <thead>
          <!-- Date row -->
          <tr class="sticky top-0 z-10">
            <th class="sticky left-0 z-20 bg-gray-950 border-b border-r border-gray-800 px-3 py-2 text-left text-gray-400 font-semibold min-w-[4.5rem]">
              姓名
            </th>
            <th v-for="day in dayList" :key="day.d"
              class="border-b border-gray-800 text-center font-semibold w-10 py-2"
              :class="day.isSat ? 'bg-blue-950 text-blue-300'
                    : day.isSun ? 'bg-red-950 text-red-300'
                    :             'bg-gray-950 text-gray-400'">
              {{ day.d }}
            </th>
          </tr>
          <!-- DOW row -->
          <tr class="sticky top-[37px] z-10">
            <th class="sticky left-0 z-20 bg-gray-950 border-b border-r border-gray-800 px-3 py-1 text-gray-600 font-normal text-xs text-left">
              星期
            </th>
            <th v-for="day in dayList" :key="day.d"
              class="border-b border-gray-800 text-center py-1 font-normal"
              :class="day.isSat ? 'bg-blue-950/60 text-blue-400'
                    : day.isSun ? 'bg-red-950/60 text-red-400'
                    :             'bg-gray-950 text-gray-600'">
              {{ DOW[day.dow] }}
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- ── Other users' submitted requests (read-only) ── -->
          <tr v-if="loadingRequests && otherRequests.length === 0">
            <td :colspan="dayList.length + 1" class="text-center text-gray-600 text-xs py-2">載入中…</td>
          </tr>
          <tr v-for="req in otherRequests" :key="req.code">
            <td class="sticky left-0 z-10 bg-gray-950 border-b border-r border-gray-800 px-3 py-2 font-medium text-gray-400 whitespace-nowrap min-w-[4.5rem]">
              {{ req.name }}
            </td>
            <td v-for="day in dayList" :key="day.d"
              class="border-b border-gray-800/60 text-center py-2 relative cursor-default"
              :class="day.isSat ? 'bg-blue-950/5' : day.isSun ? 'bg-red-950/5' : ''">
              <span v-if="req.days[day.d - 1]?.v1"
                class="inline-block px-1 py-0.5 rounded text-xs font-bold leading-tight min-w-[1.75rem] text-center bg-blue-900/50 text-blue-300 border border-blue-800">
                {{ req.days[day.d - 1].v1 }}
              </span>
              <span v-else class="inline-block min-w-[1.75rem] text-gray-800 text-center">·</span>
              <span v-if="req.days[day.d - 1]?.v2"
                class="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-500/60"></span>
              <span v-if="req.days[day.d - 1]?.v3"
                class="absolute bottom-1 left-1 w-1.5 h-1.5 rounded-full bg-amber-500/60"></span>
            </td>
          </tr>

          <!-- ── Current user's draft (interactive) ── -->
          <tr>
            <td class="sticky left-0 z-10 bg-gray-950 border-b border-t-2 border-r border-t-blue-900 border-gray-800 px-3 py-2 font-semibold text-blue-300 whitespace-nowrap min-w-[4.5rem]">
              {{ session.name }}
            </td>
            <td v-for="day in dayList" :key="day.d"
              class="border-b border-t-2 border-t-blue-900/40 border-gray-800/60 text-center py-2 relative"
              :class="[
                isOpen ? 'cursor-pointer active:bg-gray-800' : 'cursor-default opacity-70',
                day.isSat ? 'bg-blue-950/5' : day.isSun ? 'bg-red-950/5' : '',
              ]"
              @click="openPicker(day.d)">
              <span v-if="getCellVote(day.d).v1"
                class="inline-block px-1 py-0.5 rounded text-xs font-bold leading-tight min-w-[1.75rem] text-center bg-blue-900/80 text-blue-200 border border-blue-700">
                {{ getCellVote(day.d).v1 }}
              </span>
              <span v-else class="inline-block min-w-[1.75rem] text-gray-800 text-center">·</span>
              <span v-if="getCellVote(day.d).v2"
                class="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-500"
                :title="`v2: ${getCellVote(day.d).v2}`"></span>
              <span v-if="getCellVote(day.d).v3"
                class="absolute bottom-1 left-1 w-1.5 h-1.5 rounded-full bg-amber-500"
                :title="`v3: ${getCellVote(day.d).v3}`"></span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Bottom action bar ─────────────────────────────────────────── -->
    <div class="flex-shrink-0 px-4 py-3 bg-gray-900 border-t border-gray-800 flex items-center gap-3">
      <p class="flex-1 text-xs text-gray-500">已填 {{ filledCount }} 天</p>
      <button @click="loadRequests" :disabled="loadingRequests"
        class="px-2 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 text-sm rounded-lg transition-colors"
        title="重新整理他人預約">
        {{ loadingRequests ? '…' : '↺' }}
      </button>
      <button @click="saveDraft" :disabled="!isOpen"
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 text-sm rounded-lg transition-colors">
        儲存草稿
      </button>
      <button @click="submitVotes" :disabled="!isOpen || submitting || filledCount === 0"
        class="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
        {{ submitting ? '送出中…' : '確認送出' }}
      </button>
    </div>

    <!-- ── Bottom sheet: day picker ──────────────────────────────────── -->
    <Transition name="sheet">
      <div v-if="pickerOpen"
        class="fixed inset-0 z-50 flex flex-col justify-end"
        @click.self="closePicker">
        <div class="absolute inset-0 bg-black/60" @click="closePicker"></div>
        <div class="relative bg-gray-900 rounded-t-2xl px-5 pt-5 pb-10 z-10">
          <!-- Header -->
          <div class="flex items-center justify-between mb-4">
            <div>
              <p class="text-xs text-gray-500">
                {{ year }}年{{ month }}月{{ pickerDay }}日
                （{{ DOW[new Date(year, month-1, pickerDay).getDay()] }}）
              </p>
              <p class="text-base font-semibold text-white mt-0.5">設定志願</p>
            </div>
            <button @click="clearDay"
              class="text-xs px-2 py-1 bg-red-900/40 hover:bg-red-900/70 text-red-400 rounded-lg transition-colors">
              清除本日
            </button>
          </div>

          <!-- v1 / v2 / v3 rows -->
          <div v-for="(key, ki) in (['v1','v2','v3'] as const)" :key="key" class="mb-4">
            <p class="text-xs mb-2"
              :class="ki === 0 ? 'text-blue-400' : ki === 1 ? 'text-violet-400' : 'text-amber-400'">
              {{ ki === 0 ? '第1志願（優先）' : ki === 1 ? '第2志願' : '第3志願（備選）' }}
            </p>
            <div class="flex flex-wrap gap-2">
              <button v-for="code in shifts" :key="code"
                @click="setVote(key, code)"
                class="px-4 py-2 rounded-xl text-sm font-semibold border transition-colors"
                :class="votes[pickerDay]?.[key] === code
                  ? ki === 0 ? 'bg-blue-700 border-blue-500 text-white'
                  : ki === 1 ? 'bg-violet-700 border-violet-500 text-white'
                  :            'bg-amber-700 border-amber-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-200 hover:border-gray-500'">
                {{ code }}
              </button>
              <button @click="setVote(key, null)"
                class="px-4 py-2 rounded-xl text-sm border bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500 transition-colors">
                ✕ 清除
              </button>
            </div>
          </div>

          <!-- Confirm -->
          <button @click="closePicker"
            class="w-full py-3 bg-blue-700 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors">
            確認
          </button>
        </div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.sheet-enter-active, .sheet-leave-active { transition: opacity .2s; }
.sheet-enter-active > div:last-child, .sheet-leave-active > div:last-child {
  transition: transform .25s cubic-bezier(.32,0,.67,0);
}
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from > div:last-child, .sheet-leave-to > div:last-child { transform: translateY(100%); }
</style>
