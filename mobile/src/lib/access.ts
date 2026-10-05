import { session, updateUser } from './session'
import { gas, ApiError } from './api'
import { purgeForbidden } from './data'
import { sched, myGroup } from './sched'
import type { FeatureKey, MobileAccess, AccessMatrix } from '@shared/mobileAccess'

/**
 * 手機依身分區分功能（ADR-026）：權限由伺服器依通訊錄職稱與管理者欄決定，
 * 這裡只決定畫面上顯示哪些入口；資料由 GAS 擋。
 * 尚未取得權限（舊版登入）時先全部顯示，取得後再收。
 */
export function can(f: FeatureKey): boolean {
  const a = session.user?.access
  return !a || a.features.includes(f)
}

export const isAdmin = () => !!session.user?.access?.admin

/** 班表分頁：看排班名單（不在權限表裡，ADR-025） */
export function canSchedule(): boolean {
  return sched.me ? !!myGroup() : !!session.user?.personId
}

/** 路徑 → 權限單位；不在表內的頁面（首頁、班表、更多、設定）不需權限 */
const ROUTE_FEATURE: [string, FeatureKey][] = [
  ['/sets', 'sets'], ['/contacts', 'contacts'], ['/items', 'items'], ['/memos', 'memos'],
  ['/care', 'care'], ['/tool', 'care'], ['/emergency', 'care'], ['/handbook', 'care'],
  ['/docs', 'aiDocs'], ['/research', 'research'],
]
export function routeAllowed(path: string): boolean {
  const f = ROUTE_FEATURE.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1]
  return !f || can(f)
}

/** 向伺服器取得最新權限（每次開 App、下拉更新）；離線沿用上次的。管理者另外拿到權限表 */
export async function refreshAccess(): Promise<AccessMatrix | null> {
  if (!session.user) return null
  try {
    const r = await gas<MobileAccess & { matrix?: AccessMatrix }>('mobileMe')
    const access: MobileAccess = { identity: r.identity, admin: r.admin, features: r.features }
    const before = session.user.access
    updateUser({ access })
    await purgeForbidden(access.features, before?.features ?? null)
    return r.matrix ?? null
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'OFFLINE' || e.code === 'AUTH')) return null
    throw e
  }
}

/** 管理者儲存權限表，回傳伺服器清理後的結果 */
export async function saveMatrix(matrix: AccessMatrix): Promise<AccessMatrix> {
  return (await gas<{ matrix: AccessMatrix }>('setMobileAccess', { matrix })).matrix
}
