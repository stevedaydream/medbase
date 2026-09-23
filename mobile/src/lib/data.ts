import { reactive } from 'vue'
import { gas, ApiError } from './api'
import { kvGet, kvSet } from './kv'

/**
 * 唯讀資料的離線快取（ADR-013）。
 * 開啟時先從 IndexedDB 顯示，背景以 getVersions 比對雲端版本，只重新下載有變動的表。
 */
export type Row = Record<string, string>

export const TABLES = [
  'physicians', 'contacts', 'prescriptions', 'surgery', 'examination', 'disease',
  'shiftMemos', 'items', 'sets', 'surgeryTypes',
] as const
export type TableName = (typeof TABLES)[number]

export const TABLE_LABELS: Record<TableName | 'npDuty', string> = {
  physicians: '通訊錄', contacts: '單位分機', prescriptions: '處方套組', surgery: '手術處置',
  examination: '檢查處置', disease: '疾病常規', shiftMemos: '規則備忘錄', items: '自費品項',
  sets: '品項套組', surgeryTypes: '手術術式', npDuty: 'NP／VS 值班',
}

interface Meta { version: string; fetchedAt: string }
export interface DutyRow { month: string; duty_date: string; ward: string; np_name: string; extension: string; shift: string; staff_code?: string }

export const data = reactive({
  tables: Object.fromEntries(TABLES.map(t => [t, [] as Row[]])) as Record<TableName, Row[]>,
  duty: {} as Record<string, DutyRow[]>,
  meta: {} as Record<string, Meta>,
  loaded: false,
  refreshing: false,
  offline: false,
  error: '',
})

let loadPromise: Promise<void> | null = null

/** 從手機快取載入（App 啟動時呼叫一次） */
export function loadCache(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    data.meta = (await kvGet<Record<string, Meta>>('meta')) ?? {}
    for (const t of TABLES) data.tables[t] = (await kvGet<Row[]>(`table:${t}`)) ?? []
    data.duty = (await kvGet<Record<string, DutyRow[]>>('duty')) ?? {}
    data.loaded = true
  })()
  return loadPromise
}

function monthKey(offset: number) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function saveMeta() { await kvSet('meta', JSON.parse(JSON.stringify(data.meta))) }

/** 背景更新；force 時全部重新下載 */
export async function refresh(force = false): Promise<void> {
  if (data.refreshing) return
  await loadCache()
  data.refreshing = true
  data.error = ''
  try {
    const v = await gas<{ data: Record<string, string> }>('getVersions')
    const versions = v.data ?? {}
    // 逐表各自處理：單一張表逾時或失敗不能讓後面的表都不更新
    const failed: string[] = []
    for (const t of TABLES) {
      const remote = versions[`${t}_last_updated`] ?? ''
      const local = data.meta[t]
      if (!force && local && local.version === remote && data.tables[t].length) continue
      try {
        const r = await withRetry(() => gas<{ rows: Row[] }>('readTable', { table: t }))
        data.tables[t] = r.rows ?? []
        await kvSet(`table:${t}`, r.rows ?? [])
        data.meta[t] = { version: remote, fetchedAt: new Date().toISOString() }
        await saveMeta()
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'OFFLINE' || e.code === 'AUTH')) throw e
        failed.push(TABLE_LABELS[t])
      }
    }
    try {
      await withRetry(() => refreshDuty(force))
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'OFFLINE' || e.code === 'AUTH')) throw e
      failed.push(TABLE_LABELS.npDuty)
    }
    data.offline = false
    if (failed.length) data.error = `部分資料更新失敗：${failed.join('、')}，請稍後再試`
  } catch (e) {
    if (e instanceof ApiError && e.code === 'OFFLINE') data.offline = true
    else if (!(e instanceof ApiError && e.code === 'AUTH')) data.error = (e as Error).message
  } finally {
    data.refreshing = false
  }
}

/** 伺服器暫時失敗（GAS 冷啟動逾時等）重試一次 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'OFFLINE' || e.code === 'AUTH' || e.code === 'FORBIDDEN')) throw e
    return fn()
  }
}

/** 值班表：上個月（凌晨顯示「昨夜」會用到月初）、本月、下個月 */
async function refreshDuty(force: boolean) {
  const months = [monthKey(-1), monthKey(0), monthKey(1)]
  const v = await gas<{ data: Record<string, string> }>('getNpDutyVersions')
  const remote = v.data ?? {}
  const need = months.filter(m => remote[m] && (force || data.meta[`duty:${m}`]?.version !== remote[m] || !data.duty[m]))
  if (need.length) {
    const r = await gas<{ data: Record<string, { version: string; rows: DutyRow[] }> }>('getNpDutyMonths', { months: need })
    for (const m of need) {
      data.duty[m] = r.data?.[m]?.rows ?? []
      data.meta[`duty:${m}`] = { version: r.data?.[m]?.version ?? '', fetchedAt: new Date().toISOString() }
    }
  }
  // 只留這三個月
  for (const m of Object.keys(data.duty)) if (!months.includes(m)) delete data.duty[m]
  await kvSet('duty', JSON.parse(JSON.stringify(data.duty)))
  data.meta.npDuty = { version: '', fetchedAt: new Date().toISOString() }
  await saveMeta()
}

export function lastFetched(key: string): string {
  return data.meta[key]?.fetchedAt ?? ''
}
