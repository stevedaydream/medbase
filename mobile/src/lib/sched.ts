import { reactive } from 'vue'
import { gas, ApiError } from './api'
import { kvGet, kvSet } from './kv'
import { syncOnce, type LocalMeta, type PutResult } from '@shared/sched/sync'

/**
 * 排班 v3 文件快取（ADR-015）：IndexedDB 存每份文件，與 SchDocs 以共用的 syncOnce 同步。
 * 員工只讀（伺服器只給看得到的文件），寫入走 mobileSetPrebook；排班者本機修改標 dirty 後上傳。
 */
export interface SchedMe { id: string; name: string; role: 'super' | 'scheduler' | 'employee'; unit: string }

type Doc = LocalMeta

export const sched = reactive({
  me: null as SchedMe | null,
  docs: {} as Record<string, unknown>,       // 解析後的內容
  loaded: false,
  syncing: false,
  offline: false,
  lastSyncAt: '',
  error: '',
  conflicts: [] as string[],
})

const META_KEY = 'sched:meta'
let local: Record<string, Doc> = {}

export const isStaff = () => sched.me?.role === 'scheduler' || sched.me?.role === 'super'

async function persist() {
  await kvSet('sched:docs', local)
  await kvSet(META_KEY, { me: sched.me, lastSyncAt: sched.lastSyncAt })
}

function parse(key: string) {
  try { sched.docs[key] = JSON.parse(local[key].json) } catch { delete sched.docs[key] }
}

let loadPromise: Promise<void> | null = null
export function loadSchedCache(): Promise<void> {
  loadPromise ??= (async () => {
    local = (await kvGet<Record<string, Doc>>('sched:docs')) ?? {}
    const meta = await kvGet<{ me: SchedMe | null; lastSyncAt: string }>(META_KEY)
    sched.me = meta?.me ?? null
    sched.lastSyncAt = meta?.lastSyncAt ?? ''
    for (const k of Object.keys(local)) parse(k)
    sched.loaded = true
  })()
  return loadPromise
}

const remote = {
  list: async () => (await gas<{ docs: { key: string; version: string }[] }>('schList')).docs,
  get: async (keys: string[]) => {
    const out: { key: string; version: string; json: string }[] = []
    for (let i = 0; i < keys.length; i += 100) {
      out.push(...(await gas<{ docs: { key: string; version: string; json: string }[] }>('schGet', { keys: keys.slice(i, i + 100) })).docs)
    }
    return out
  },
  put: async (items: { key: string; json: string; base: string | null }[]) =>
    (await gas<{ results: PutResult[] }>('schPut', { items })).results,
}

const localApi = {
  list: async () => Object.values(local).map(d => ({ ...d })),
  apply: async (key: string, json: string, cloudVersion: string, expect?: string) => {
    if (expect && local[key] && local[key].version !== expect) return false
    local[key] = { key, json, version: cloudVersion, cloud_version: cloudVersion, dirty: 0 }
    parse(key)
    return true
  },
  synced: async (key: string, sent: string, cloudVersion: string) => {
    const d = local[key]
    if (!d) return
    d.cloud_version = cloudVersion
    if (d.version === sent) d.dirty = 0
  },
}

let running: Promise<void> | null = null
let rerun = false

/** 取得身分並同步文件；離線時保留快取並標示 */
export function syncSchedDocs(): Promise<void> {
  if (running) { rerun = true; return running }
  running = (async () => {
    await loadSchedCache()
    sched.syncing = true
    sched.error = ''
    try {
      sched.me = (await gas<{ person: SchedMe | null }>('schMe')).person
      const rep = await syncOnce(localApi, remote)
      sched.conflicts = rep.conflicts
      // 伺服器不再給看的文件（角色變更）從本機移除
      const visible = new Set((await remote.list()).map(d => d.key))
      for (const k of Object.keys(local)) if (!visible.has(k) && !local[k].dirty) { delete local[k]; delete sched.docs[k] }
      sched.offline = false
      sched.lastSyncAt = new Date().toISOString()
      await persist()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OFFLINE') sched.offline = true
      else if (!(e instanceof ApiError && e.code === 'AUTH')) sched.error = (e as Error).message
    } finally {
      sched.syncing = false
    }
  })().finally(() => {
    running = null
    if (rerun) { rerun = false; void syncSchedDocs() }
  })
  return running
}

/** 排班者本機修改（標 dirty，稍後同步上傳） */
export async function writeLocalDoc(key: string, value: unknown): Promise<void> {
  const prev = local[key]
  local[key] = { key, json: JSON.stringify(value), version: `L${Date.now()}`, cloud_version: prev?.cloud_version ?? null, dirty: 1 }
  parse(key)
  await persist()
}

export function doc<T>(key: string): T | undefined {
  return sched.docs[key] as T | undefined
}

export interface SetPrebookResult { ok: boolean; applied: { day: number; from: string; to: string }[]; rejected: { day: number; reason: string }[]; error?: string }

/** 員工登記自己的預班（須連線）；成功後重新同步該月預班 */
export async function setMyPrebook(ym: string, cells: { day: number; v: string | null }[]): Promise<SetPrebookResult> {
  const r = await gas<SetPrebookResult>('mobileSetPrebook', { ym, cells })
  await syncSchedDocs()
  return r
}

export async function markNoticesRead(ids: string[]): Promise<void> {
  if (!ids.length) return
  await gas('mobileMarkRead', { ids })
  await syncSchedDocs()
}
