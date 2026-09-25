import { session, setToken, logout, type MobileUser } from './session'

/**
 * 手機只呼叫自己的 Vercel /api（ADR-013），GAS 網址與金鑰不在前端。
 * 伺服器每次成功回應都會在 x-token 換發新憑證（30 天滑動延長）。
 */
export class ApiError extends Error {
  constructor(public code: 'AUTH' | 'OFFLINE' | 'FORBIDDEN' | 'SERVER' | string, message: string, public data: Record<string, unknown> = {}) {
    super(message)
  }
}

export async function apiLogin(his: string, password: string): Promise<{ token: string; user: MobileUser }> {
  let res: Response
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ his, password }),
    })
  } catch {
    throw new ApiError('OFFLINE', '無法連線，請確認網路後再試')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) throw new ApiError(data.code ?? 'SERVER', data.error ?? '登入失敗')
  return { token: data.token, user: data.user }
}

/** 呼叫 GAS action（經 /api/gas），回傳 GAS 的原始回應物件 */
export function gas<T = Record<string, unknown>>(action: string, args: Record<string, unknown> = {}): Promise<T & { ok: true }> {
  return post<T>('/api/gas', action, args)
}

/** 員工換班（/api/swap，ADR-016） */
export function swapApi<T = Record<string, unknown>>(action: string, args: Record<string, unknown> = {}): Promise<T & { ok: true }> {
  return post<T>('/api/swap', action, args)
}

async function post<T>(path: string, action: string, args: Record<string, unknown>): Promise<T & { ok: true }> {
  if (!session.token) throw new ApiError('AUTH', '請先登入')
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ action, ...args }),
    })
  } catch {
    throw new ApiError('OFFLINE', '目前離線')
  }
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
  if (res.status === 401) {
    await logout(data.error ?? '登入已失效，請重新登入')
    throw new ApiError('AUTH', data.error ?? '登入已失效')
  }
  const renewed = res.headers.get('x-token')
  if (renewed) setToken(renewed)
  if (!res.ok || !data.ok) throw new ApiError(res.status === 403 ? 'FORBIDDEN' : data.code ?? 'SERVER', data.error ?? '伺服器錯誤', data)
  return data as T & { ok: true }
}
