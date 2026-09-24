<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { gas, ApiError } from '../lib/api'
import { kvGet, kvSet } from '../lib/kv'
import { session } from '../lib/session'
import { toast } from '../lib/ui'
import { usePullRefresh } from '../lib/pull'

/** 班表（唯讀，快取可離線）。預班登記改用排班 v3（ADR-015）。 */
const DOW = ['日', '一', '二', '三', '四', '五', '六']
const me = computed(() => session.user)

// ── 共用：月份 ───────────────────────────────────────────────────
function ym(y: number, m: number) { return `${y}${String(m).padStart(2, '0')}` }
function shiftMonth(y: number, m: number, d: number) {
  const t = new Date(y, m - 1 + d, 1)
  return { y: t.getFullYear(), m: t.getMonth() + 1 }
}
const today = new Date()

// ── 班表 ─────────────────────────────────────────────────────────
const sy = ref(today.getFullYear()), sm = ref(today.getMonth() + 1)
const sYM = computed(() => ym(sy.value, sm.value))
interface Row { name: string; days: (string | null)[] }
const rows = ref<Row[]>([])
const sLoading = ref(false)
const sError = ref('')
const sCachedOnly = ref(false)
function moveS(d: number) { const t = shiftMonth(sy.value, sm.value, d); sy.value = t.y; sm.value = t.m }
const sDays = computed(() => new Date(sy.value, sm.value, 0).getDate())

function parse(values: (string | number)[][]): Row[] {
  return values.slice(1).filter(r => String(r[0] ?? '').trim()).map(r => ({
    name: String(r[0]),
    days: Array.from({ length: 31 }, (_, i) => { const v = r[i + 1]; return v != null && v !== '' ? String(v) : null }),
  }))
}

async function loadSchedule() {
  sError.value = ''
  const key = `schedule:${sYM.value}`
  const cached = await kvGet<Row[]>(key)
  rows.value = cached ?? []
  sCachedOnly.value = false
  sLoading.value = !cached
  try {
    const r = await gas<{ data: (string | number)[][] }>('getSchedule', { sheetName: `Schedule_${sYM.value}` })
    rows.value = parse(r.data ?? [])
    await kvSet(key, rows.value)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'OFFLINE') sCachedOnly.value = !!cached
    else if (!cached) sError.value = (e as Error).message.includes('不存在') ? '' : (e as Error).message
    if (!cached) rows.value = []
  } finally {
    sLoading.value = false
  }
}
watch(sYM, loadSchedule, { immediate: true })

// 開啟本月班表時，橫向捲到今天附近（姓名欄固定在左，約 5 欄寬）
const tableBox = ref<HTMLElement | null>(null)
watch([rows, tableBox], async () => {
  if (!tableBox.value || !rows.value.length || sy.value !== today.getFullYear() || sm.value !== today.getMonth() + 1) return
  await nextTick()
  tableBox.value.scrollLeft = Math.max(0, (today.getDate() - 3) * 36)
})

const isMine = (name: string) => !!me.value && me.value.name === name.trim()
const sortedRows = computed(() => [...rows.value].sort((a, b) => Number(isMine(b.name)) - Number(isMine(a.name))))
const isToday = (d: number) => sy.value === today.getFullYear() && sm.value === today.getMonth() + 1 && d === today.getDate()
function dowClass(y: number, m: number, d: number) {
  const w = new Date(y, m - 1, d).getDay()
  return w === 0 ? 'text-danger' : w === 6 ? 'text-accent' : 'text-muted'
}

// 下拉只更新目前月份班表
usePullRefresh(async () => {
  await loadSchedule()
  return sError.value || (sCachedOnly.value ? '目前離線，顯示手機裡的班表' : '已更新：班表')
})

</script>

<template>
  <div class="accent-blue pad-tabbar">
    <PageHeader title="班表">
    </PageHeader>

    <!-- ── 班表 ── -->
    <section class="py-3">
      <div class="flex items-center justify-between px-4 mb-3">
        <button @click="moveS(-1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">‹</button>
        <span class="font-bold">{{ sy }} 年 {{ sm }} 月</span>
        <button @click="moveS(1)" class="w-10 h-10 rounded-xl bg-surface border border-hairline text-lg">›</button>
      </div>
      <p v-if="sCachedOnly" class="mx-4 mb-2 text-xs text-warning">離線中，顯示手機上的班表</p>
      <p v-if="sLoading" class="py-12 text-center text-sm text-muted">載入中…</p>
      <p v-else-if="sError" class="py-12 text-center text-sm text-danger">{{ sError }}</p>
      <p v-else-if="!rows.length" class="py-12 text-center text-sm text-muted">此月尚無已發布的班表</p>
      <div v-else ref="tableBox" class="overflow-x-auto">
        <table class="text-sm border-collapse min-w-max">
          <thead>
            <tr>
              <th class="sticky left-0 z-10 bg-sunken px-3 py-2 text-left text-xs text-muted">姓名</th>
              <th v-for="d in sDays" :key="d" class="w-9 py-1 text-center text-xs" :class="[dowClass(sy, sm, d), isToday(d) ? 'bg-accent/15 rounded-t-lg' : '']">
                <div class="font-bold">{{ d }}</div>
                <div>{{ DOW[new Date(sy, sm - 1, d).getDay()] }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in sortedRows" :key="r.name" class="border-t border-hairline" :class="isMine(r.name) ? 'bg-accent/10' : ''">
              <td class="sticky left-0 z-10 px-3 py-2 font-bold whitespace-nowrap" :class="isMine(r.name) ? 'bg-accent/10 text-accent' : 'bg-sunken text-fg'">{{ r.name }}</td>
              <td v-for="(c, i) in r.days.slice(0, sDays)" :key="i" class="text-center py-1.5" :class="isToday(i + 1) ? 'bg-accent/10' : ''">
                <span v-if="c" class="inline-block min-w-7 px-1 py-0.5 rounded-md text-xs font-bold bg-surface border border-hairline text-fg">{{ c }}</span>
                <span v-else class="text-muted">·</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

  </div>
</template>
