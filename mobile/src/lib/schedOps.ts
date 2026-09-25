import { gas } from './api'
import { sched, doc, writeLocalDoc, syncSchedDocs } from './sched'
import {
  opStartMonth, opPublish, opRevert, opCreateSwap, opDeleteSwap, opSettleDebt, opEditCells, lockDecision,
  opAddPrefillSwap, opRemovePrefillSwap,
  type OpsState, type OpPatch, type CellEdit,
} from '@shared/sched/ops'
import {
  DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, clone,
  type MonthDoc, type PrebookDoc, type LockInfo, type NoticeItem, type LogDoc,
} from '@shared/sched/types'

/**
 * 排班者手機的流程操作（ADR-015）：以共用 ops 產生變更，寫進本機文件（dirty）後同步 SchDocs。
 * 開始排班、發布、退回、取鎖須連線；持鎖時改格可離線，恢復連線自動上傳。
 */
const DEVICE_KEY = 'mb_sched_device'

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) { id = `phone-${crypto.randomUUID()}`; localStorage.setItem(DEVICE_KEY, id) }
  return id
}

export class LockedError extends Error {
  constructor(public holder: LockInfo) { super(`${holder.name} 正在排班`) }
}

export function snapshot(): OpsState {
  const byPrefix = <T>(prefix: string) => Object.fromEntries(
    Object.keys(sched.docs).filter(k => k.startsWith(prefix)).map(k => [k.slice(prefix.length), clone(sched.docs[k] as T)]),
  )
  return {
    people: clone(doc('people') ?? []), shifts: clone(doc('shifts') ?? DEFAULT_SHIFTS),
    quotaItems: clone(doc('quotaItems') ?? DEFAULT_QUOTA_ITEMS), rules: clone(doc('rules') ?? DEFAULT_RULES),
    holidays: clone(doc('holidays') ?? { days: {}, workdays: [], cny: [] }), holidayDuty: clone(doc('holidayDuty') ?? {}),
    duty84: clone(doc('duty84') ?? { log: [], removedDates: [], addedDates: [] }), cny: clone(doc('cny') ?? { lastD: {}, log: [] }),
    debts: clone(doc('debts') ?? []),
    months: byPrefix<MonthDoc>('month:'), prebooks: byPrefix<PrebookDoc>('prebook:'),
  }
}

export async function applyPatch(p: OpPatch): Promise<void> {
  for (const m of p.months) await writeLocalDoc(`month:${m.ym}`, m)
  for (const pb of p.prebooks) await writeLocalDoc(`prebook:${pb.ym}`, pb)
  if (p.duty84) await writeLocalDoc('duty84', p.duty84)
  if (p.cny) await writeLocalDoc('cny', p.cny)
  if (p.debts) await writeLocalDoc('debts', p.debts)
  if (p.notices.length) await writeLocalDoc('notices', [...(doc<NoticeItem[]>('notices') ?? []), ...p.notices])
  for (const e of p.ests) await writeLocalDoc(`est:${e.ym}`, e)
  const byScope = new Map<string, LogDoc>()
  for (const l of p.logs) {
    const d = byScope.get(l.scope) ?? clone(doc<LogDoc>(`log:${l.scope}`) ?? { key: l.scope, entries: [] })
    d.entries.push({ at: new Date().toISOString(), actor: l.actor, action: l.action, detail: l.detail })
    if (d.entries.length > 2000) d.entries.splice(0, d.entries.length - 2000)
    byScope.set(l.scope, d)
  }
  for (const [scope, d] of byScope) await writeLocalDoc(`log:${scope}`, d)
}

const actor = () => `${sched.me?.name ?? '排班者'}（手機）`
const now = () => new Date().toISOString()
const requireOnline = () => { if (sched.offline) throw new Error('目前離線，這個操作需要連線') }

// ── 排班鎖 ────────────────────────────────────────────────────────────
export const lockOf = (ym: string) => doc<LockInfo | null>(`lock:${ym}`) ?? null
export const hasLock = (ym: string) => lockOf(ym)?.machine === deviceId()

export async function acquireLock(ym: string, force = false): Promise<void> {
  requireOnline()
  await syncSchedDocs()
  const cur = lockOf(ym)
  const d = lockDecision(cur, deviceId(), Date.now(), force)
  if (!d.ok) throw new LockedError(cur!)
  await writeLocalDoc(`lock:${ym}`, { his: '', name: sched.me?.name ?? '', machine: deviceId(), at: now() } satisfies LockInfo)
  if (d.takeover) await applyPatch({ months: [], prebooks: [], notices: [], ests: [], warnings: [], logs: [{ scope: ym, action: '接手排班鎖', detail: `由 ${cur!.name} 手上${d.stale ? '（逾時）' : '強制'}接手`, actor: actor() }] })
  await syncSchedDocs()
  if (lockOf(ym)?.machine !== deviceId()) throw new LockedError(lockOf(ym)!)
}

export async function releaseLock(ym: string): Promise<void> {
  if (hasLock(ym)) await writeLocalDoc(`lock:${ym}`, null)
  await syncSchedDocs()
}

// ── 流程 ─────────────────────────────────────────────────────────────
export async function startMonth(ym: string, force = false): Promise<void> {
  requireOnline()
  await acquireLock(ym)
  await applyPatch(opStartMonth(snapshot(), ym, force, actor(), now()))
  await syncSchedDocs()
}

async function publishSheet(ym: string): Promise<boolean> {
  try { await gas('schPublish', { ym }); return true } catch { return false }
}

export async function publishMonth(ym: string, unresolved: number): Promise<boolean> {
  requireOnline()
  if (!hasLock(ym)) throw new Error('排班鎖不在這支手機，請先取得排班鎖')
  await applyPatch(opPublish(snapshot(), ym, unresolved, actor(), now()))
  await releaseLock(ym)
  return publishSheet(ym)
}

export async function revertMonth(ym: string): Promise<void> {
  requireOnline()
  const p = opRevert(snapshot(), ym, actor(), now())
  await acquireLock(ym)
  await applyPatch(p)
  await syncSchedDocs()
}

export async function editCells(ym: string, layer: 'pre' | 'sched', edits: CellEdit[], reason?: { text: string; approved: boolean }): Promise<number> {
  const s = snapshot()
  const p = opEditCells(s, ym, layer, edits, { actor: actor(), actorPersonId: sched.me?.id ?? null, actorHis: sched.me?.id ?? '', now: now(), reason })
  await applyPatch(p)
  const n = p.months.length + p.prebooks.length
  if (s.months[ym]?.status === 'published' && n) await syncSchedDocs().then(() => publishSheet(ym))
  else void syncSchedDocs()
  return n
}

export async function createSwap(ym: string, day: number, a: string, b: string, note: string): Promise<void> {
  await applyPatch(opCreateSwap(snapshot(), ym, day, a, b, note, actor(), now()))
  await syncSchedDocs()
  if (doc<MonthDoc>(`month:${ym}`)?.status === 'published') await publishSheet(ym)
}

export async function deleteSwap(ym: string, id: string): Promise<void> {
  await applyPatch(opDeleteSwap(snapshot(), ym, id, actor()))
  await syncSchedDocs()
  if (doc<MonthDoc>(`month:${ym}`)?.status === 'published') await publishSheet(ym)
}

/** 預填換人（開放預班）：與桌機共用 ops；需連線以免與他人同時改月份文件 */
export async function addPrefillSwap(ym: string, from: string, to: string, cells: { day: number; code: string }[], note: string): Promise<void> {
  requireOnline()
  await applyPatch(opAddPrefillSwap(snapshot(), ym, from, to, cells, note, actor(), now()))
  await syncSchedDocs()
}

export async function removePrefillSwap(ym: string, group: string): Promise<void> {
  requireOnline()
  await applyPatch(opRemovePrefillSwap(snapshot(), ym, group, actor(), now()))
  await syncSchedDocs()
}

export async function settleDebt(id: string, note: string): Promise<void> {
  await applyPatch(opSettleDebt(snapshot(), id, note, actor(), now()))
  await syncSchedDocs()
}
