import { reactive } from 'vue'
import { kvClear } from './kv'

/**
 * 手機登入狀態（ADR-013）。
 * - 憑證（Vercel 簽發，30 天滑動延長）存 localStorage
 * - 另存 HIS 密碼的加鹽雜湊，供閒置上鎖後在本機解鎖（離線也可）
 * - 閒置 15 分鐘上鎖；App 在背景超過 15 分鐘回來也上鎖
 * - 登出清除所有快取；Gemini 金鑰與主題設定保留
 */
/** personId／role 為登入當下的排班身分；實際權限每次由 GAS 依 people 判斷（ADR-015） */
export interface MobileUser { his: string; name: string; personId?: string; role?: string }

const K = { token: 'mb_token', user: 'mb_user', pin: 'mb_unlock', active: 'mb_last_active' }
const KEEP_ON_LOGOUT = ['mb_gemini_key', 'mb_theme']
const LOCK_AFTER_MS = 15 * 60 * 1000

function readJson<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}

export const session = reactive({
  user: readJson<MobileUser>(K.user),
  token: localStorage.getItem(K.token) ?? '',
  locked: false,
  /** 被伺服器判定失效時的提示（顯示在登入頁） */
  notice: '',
})

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function setLoggedIn(token: string, user: MobileUser, password: string) {
  const salt = crypto.randomUUID()
  localStorage.setItem(K.pin, JSON.stringify({ salt, hash: await sha256(`${salt}:${password}`) }))
  localStorage.setItem(K.token, token)
  localStorage.setItem(K.user, JSON.stringify(user))
  session.user = user
  session.token = token
  session.locked = false
  session.notice = ''
  touch()
}

export function setToken(token: string) {
  session.token = token
  localStorage.setItem(K.token, token)
}

export async function unlock(password: string): Promise<boolean> {
  const saved = readJson<{ salt: string; hash: string }>(K.pin)
  if (!saved || (await sha256(`${saved.salt}:${password}`)) !== saved.hash) return false
  session.locked = false
  touch()
  return true
}

export async function logout(notice = '') {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('mb_') && !KEEP_ON_LOGOUT.includes(key)) localStorage.removeItem(key)
  }
  sessionStorage.clear()
  await kvClear()
  session.user = null
  session.token = ''
  session.locked = false
  session.notice = notice
}

// ── 閒置上鎖 ─────────────────────────────────────────────────────
let lastWrite = 0
function touch() {
  const now = Date.now()
  // 每 15 秒最多寫一次，避免每次觸控都寫 localStorage
  if (now - lastWrite > 15_000) { localStorage.setItem(K.active, String(now)); lastWrite = now }
}

function checkIdle() {
  if (!session.user || session.locked) return
  const last = Number(localStorage.getItem(K.active) ?? 0)
  if (Date.now() - last > LOCK_AFTER_MS) session.locked = true
}

export function startIdleWatch() {
  checkIdle()
  for (const ev of ['pointerdown', 'keydown', 'scroll'] as const) {
    window.addEventListener(ev, () => { if (!session.locked) touch() }, { passive: true, capture: true })
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIdle() })
  setInterval(checkIdle, 30_000)
}
