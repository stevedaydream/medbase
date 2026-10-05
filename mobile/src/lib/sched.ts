import { reactive } from 'vue'
import { gas, ApiError } from './api'
import { kvGet, kvSet } from './kv'
import { session } from './session'
import { syncOnce, type LocalMeta, type PutResult } from '@shared/sched/sync'
import { DEFAULT_GROUP, type SchedGroup } from '@shared/sched/groups'

/**
 * 排班 v3 文件快取（ADR-015）：IndexedDB 存每份文件，與 SchDocs 以共用的 syncOnce 同步。
 * 員工只讀（伺服器只給看得到的文件），寫入走 mobileSetPrebook；排班者本機修改標 dirty 後上傳。
 * 群組（ADR-025）：伺服器只給自己群組的文件（key 為群組內名稱）；super 的排班分頁可切換群組，每個群組各一份快取。
 */
export interface SchedMe { id: string; name: string; role: 'super' | 'scheduler' | 'employee'; unit: string; group: string }

type Doc = LocalMeta

export const sched = reactive({
  me: null as SchedMe | null,
  /** 目前同步的群組；''＝不在名單或未分組（看不到任何排班文件） */
  group: '',
  /** super 可切換的群組清單 */
  groups: [] as SchedGroup[],
  docs: {} as Record<string, unknown>,       // 解析後的內容
  loaded: false,
  syncing: false,
  offline: false,
  lastSyncAt: '',
  error: '',
  conflicts: [] as string[],
  /** 已發布班表分頁的版本（Schedule_YYYYMM → 時間戳，ADR-022）；null＝雲端尚未提供，班表一律重新下載 */
  sheetVersions: null as Record<string, string> | null,
})

const META_KEY = 'sched:meta'
let local: Record<string, Doc> = {}

export const isStaff = () => sched.me?.role === 'scheduler' || sched.me?.role === 'super'

/** 自己所屬的群組（super 未分組時用預設群組） */
export const myGroup = () => sched.me?.group || (sched.me?.role === 'super' ? DEFAULT_GROUP : '')

const docsKey = (group: string) => `sched:docs:${group}`

async function persist() {
  if (sched.group) await kvSet(docsKey(sched.group), local)
  await kvSet(META_KEY, { me: sched.me, meHis, group: sched.group, groups: sched.groups, lastSyncAt: sched.lastSyncAt, sheetVersions: sched.sheetVersions })
}

/** 換成另一個群組的本機快取 */
async function useGroupCache(group: string) {
  sched.group = group
  local = group ? (await kvGet<Record<string, Doc>>(docsKey(group))) ?? {} : {}
  sched.docs = {}
  for (const k of Object.keys(local)) parse(k)
}

function parse(key: string) {
  try { sched.docs[key] = JSON.parse(local[key].json) } catch { delete sched.docs[key] }
}

let loadPromise: Promise<void> | null = null
export function loadSchedCache(): Promise<void> {
  loadPromise ??= (async () => {
    const meta = await kvGet<{ me: SchedMe | null; meHis?: string; group?: string; groups?: SchedGroup[]; lastSyncAt: string; sheetVersions?: Record<string, string> | null }>(META_KEY)
    sched.me = meta?.me ?? null
    meHis = meta?.meHis ?? ''
    sched.groups = meta?.groups ?? []
    sched.lastSyncAt = meta?.lastSyncAt ?? ''
    sched.sheetVersions = meta?.sheetVersions ?? null
    // 舊版快取沒有群組資訊：等 schMe 確認身分後再重新下載
    await useGroupCache(meta?.group ?? '')
    sched.loaded = true
  })()
  return loadPromise
}

/** 這次 App 啟動後已向伺服器確認過身分的 HIS 帳號（換帳號或重新啟動才再查 schMe） */
let meHis = ''
let meChecked = ''

type ListResult = { docs: { key: string; version: string }[]; sheets?: Record<string, string> }

/** 每次同步一個 remote：版本清單只查一次，同步與清除看不到的文件共用 */
const makeRemote = () => {
  let listed: Promise<ListResult> | null = null
  const group = sched.group
  const listAll = () => (listed ??= gas<ListResult>('schList', { group }))
  return {
    listAll,
    list: async () => (await listAll()).docs,
    get: (keys: string[]) => remoteGet(keys, group),
    put: (items: { key: string; json: string; base: string | null }[]) => remotePut(items, group),
  }
}

async function remoteGet(keys: string[], group: string) {
  const out: { key: string; version: string; json: string }[] = []
  for (let i = 0; i < keys.length; i += 100) {
    out.push(...(await gas<{ docs: { key: string; version: string; json: string }[] }>('schGet', { keys: keys.slice(i, i + 100), group })).docs)
  }
  return out
}

async function remotePut(items: { key: string; json: string; base: string | null }[], group: string) {
  return (await gas<{ results: PutResult[] }>('schPut', { items, group })).results
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
      // 身分每次啟動或換帳號才查一次（角色很少變，省一次往返）
      const his = session.user?.his ?? ''
      if (!sched.me || meChecked !== his || meHis !== his) {
        const r = await gas<{ person: SchedMe | null; groups?: SchedGroup[] }>('schMe')
        sched.me = r.person
        sched.groups = r.groups ?? []
        meChecked = meHis = his
      }
      // 非 super 固定在自己的群組；super 沒選過時用自己的群組
      const own = myGroup()
      if (sched.me?.role !== 'super' || !sched.group || !sched.groups.some(g => g.id === sched.group)) {
        if (sched.group !== own) { await persist(); await useGroupCache(own) }
      }
      if (!sched.group) {
        sched.sheetVersions = {}
        sched.offline = false
        sched.lastSyncAt = new Date().toISOString()
        await persist()
        return
      }
      const remote = makeRemote()
      const rep = await syncOnce(localApi, remote)
      sched.conflicts = rep.conflicts
      const listed = await remote.listAll()
      sched.sheetVersions = listed.sheets ?? null
      // 伺服器不再給看的文件（角色變更）從本機移除；清單是同步前查的，這次上傳成功的也算看得到
      const visible = new Set([...listed.docs.map(d => d.key), ...rep.uploaded, ...rep.merged, ...rep.conflicts])
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

/** super 切換排班分頁的群組（個人分頁一律切回自己的群組） */
export async function setActiveGroup(group: string): Promise<void> {
  if (!group || group === sched.group) return
  if (running) await running
  await persist()
  await useGroupCache(group)
  sched.lastSyncAt = ''
  await syncSchedDocs()
}

export function doc<T>(key: string): T | undefined {
  return sched.docs[key] as T | undefined
}

export interface SetPrebookResult {
  ok: boolean; applied: { day: number; from: string; to: string }[]; rejected: { day: number; reason: string }[]; error?: string
  /** 伺服器上最新的預班文件 */
  doc?: { key: string; version: string; json: string }
}

/** 畫面先套用（不標 dirty，員工不能上傳）；伺服器回來後以伺服器版本為準 */
function applyOptimistic(ym: string, cells: { day: number; v: string | null }[]) {
  const me = sched.me
  if (!me) return
  const key = `prebook:${ym}`
  const pb = JSON.parse(JSON.stringify(sched.docs[key] ?? { ym, cells: {} })) as { ym: string; cells: Record<string, unknown> }
  const at = new Date().toISOString()
  for (const c of cells) pb.cells[`${me.id}|${c.day}`] = { v: c.v, src: 'emp', by: me.id, at }
  sched.docs[key] = pb
}

let prebookQueue: Promise<unknown> = Promise.resolve()
let prebookPending = 0

/**
 * 員工登記自己的預班（須連線）。畫面立即反映，請求依序送出；
 * 伺服器回傳最新預班文件直接更新快取，最後一筆完成時才以伺服器版本覆蓋畫面（避免蓋掉之後按的格子）。
 * 失敗時重新同步，畫面回到伺服器的狀態。
 */
export function setMyPrebook(ym: string, cells: { day: number; v: string | null }[]): Promise<SetPrebookResult> {
  applyOptimistic(ym, cells)
  prebookPending++
  const run = prebookQueue.catch(() => {}).then(async () => {
    try {
      const r = await gas<SetPrebookResult>('mobileSetPrebook', { ym, cells })
      if (r.doc) {
        local[r.doc.key] = { key: r.doc.key, json: r.doc.json, version: r.doc.version, cloud_version: r.doc.version, dirty: 0 }
        if (prebookPending === 1) parse(r.doc.key)
        await persist()
      }
      return r
    } catch (e) {
      void syncSchedDocs()
      throw e
    } finally {
      prebookPending--
    }
  })
  prebookQueue = run
  return run
}

export async function markNoticesRead(ids: string[]): Promise<void> {
  if (!ids.length) return
  await gas('mobileMarkRead', { ids })
  await syncSchedDocs()
}
