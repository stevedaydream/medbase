import { ref } from 'vue'
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'

export interface LogEntry {
  id: number
  session: string
  time: string       // HH:MM:SS（畫面顯示用）
  ts: string         // ISO 完整時間戳（排序/匯出用）
  level: 'error' | 'warn' | 'info' | 'action'
  route?: string
  message: string
  detail?: string
}

// ── 工作階段 ID（啟動時產生，格式 MMDD_HHmm） ─────────────────────
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
export const SESSION_ID =
  `${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`

const logs   = ref<LogEntry[]>([])
let counter  = 0
let initialized = false

// ── 寫入核心 ─────────────────────────────────────────────────────
function addLog(
  level: LogEntry['level'],
  message: string,
  detail?: string,
  route?: string,
) {
  const d    = new Date()
  const time = d.toTimeString().slice(0, 8)
  const ts   = d.toISOString()
  const entry: LogEntry = { id: ++counter, session: SESSION_ID, time, ts, level, route, message, detail }
  logs.value.unshift(entry)
  if (logs.value.length > 500) logs.value.pop()
  _persistToDb(entry)
}

// ── SQLite 持久化（fire-and-forget，DB 未就緒時靜默跳過）─────────
async function _persistToDb(entry: LogEntry) {
  try {
    const { getDb } = await import('@/db')
    const db = await getDb()
    await db.execute(
      `INSERT INTO debug_logs (session, ts, level, route, message, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.session, entry.ts, entry.level, entry.route ?? null, entry.message, entry.detail ?? null]
    )
  } catch { /* DB 未就緒或 schema 未建立時靜默跳過 */ }
}

// ── 初始化：攔截全域錯誤 + fetch ─────────────────────────────────
function initLogger() {
  if (initialized) return
  initialized = true

  const prevOnError = window.onerror
  window.onerror = (msg, src, line, col, err) => {
    addLog('error', String(msg), err?.stack ?? `${src}:${line}:${col}`)
    if (typeof prevOnError === 'function') prevOnError(msg, src, line, col, err)
    return false
  }

  window.addEventListener('unhandledrejection', (e) => {
    const msg    = e.reason instanceof Error ? e.reason.message : String(e.reason)
    const detail = e.reason instanceof Error ? e.reason.stack  : undefined
    addLog('error', `Unhandled: ${msg}`, detail)
  })

  const origError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    origError(...args)
    addLog('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  }

  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    addLog('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  }

  const origFetch = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const input  = args[0]
    const url    = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    try {
      const res = await origFetch(...args)
      if (!res.ok && res.type !== 'opaque') {
        addLog('warn', `fetch ${method} ${res.status} ${res.statusText}`, url)
      }
      return res
    } catch (e) {
      addLog('error', `fetch failed: ${method}`, `${url}\n${String(e)}`)
      throw e
    }
  }
}

// ── 點擊追蹤（App 掛載後呼叫，傳入 route getter）────────────────
function initClickTracking(getRoute: () => string) {
  document.addEventListener('click', (e) => {
    // 忽略 DebugPanel 內部的點擊
    if ((e.target as HTMLElement).closest('[data-debug-panel]')) return

    const el = (e.target as HTMLElement).closest(
      'button, a, [role="button"], [data-log]'
    ) as HTMLElement | null
    if (!el) return

    const label = (
      el.getAttribute('data-log') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80)
    )?.trim()

    // 跳過無意義的短標籤（×、▼、數字等）
    if (!label || label.length < 2) return

    addLog('action', label, undefined, getRoute())
  }, true)
}

// ── 從 DB 載入歷史記錄 ────────────────────────────────────────────
async function loadHistoricalLogs(limit = 1000): Promise<LogEntry[]> {
  const { getDb } = await import('@/db')
  const db = await getDb()
  const rows = await db.select<any[]>(
    `SELECT * FROM debug_logs ORDER BY id DESC LIMIT ?`, [limit]
  )
  return rows.map((r, i) => ({
    id: -(i + 1),           // 負 ID 避免與 in-memory 衝突
    session: r.session,
    time: String(r.ts).slice(11, 19),
    ts: r.ts,
    level: r.level as LogEntry['level'],
    route: r.route ?? undefined,
    message: r.message,
    detail: r.detail ?? undefined,
  }))
}

// ── 清除 DB 歷史 ──────────────────────────────────────────────────
async function clearHistoricalLogs() {
  const { getDb } = await import('@/db')
  const db = await getDb()
  await db.execute('DELETE FROM debug_logs')
}

// ── 匯出（含 DB 全量）────────────────────────────────────────────
async function exportLogs(): Promise<string> {
  // 先補齊 DB 裡比 in-memory 更早的記錄
  let allLogs: LogEntry[]
  try {
    const dbLogs = await loadHistoricalLogs(5000)
    // DB 記錄在前（舊的），memory 在後（新的），去重後合併
    const memIds = new Set(logs.value.map(l => l.ts + l.message))
    const dbOnly = dbLogs.filter(l => !memIds.has(l.ts + l.message))
    allLogs = [...logs.value].reverse().concat(dbOnly.reverse())
  } catch {
    allLogs = [...logs.value].reverse()
  }

  const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
  const filename = `medbase-debug-${date}.log`
  const lines = allLogs.map(l => {
    const prefix = `[${l.ts.slice(0,19)}][${l.session}][${l.level.toUpperCase()}]${l.route ? `[${l.route}]` : ''} ${l.message}`
    return l.detail ? `${prefix}\n    ${l.detail.replace(/\n/g, '\n    ')}` : prefix
  })
  await writeTextFile(filename, lines.join('\n'), { baseDir: BaseDirectory.Desktop })
  return filename
}

function clearLogs() { logs.value = [] }

export function useLogger() {
  return {
    logs, SESSION_ID,
    addLog, initLogger, initClickTracking,
    loadHistoricalLogs, clearHistoricalLogs,
    exportLogs, clearLogs,
  }
}
