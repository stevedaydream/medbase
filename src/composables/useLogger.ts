import { ref } from 'vue'
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'

export interface LogEntry {
  id: number
  time: string
  level: 'error' | 'warn' | 'info'
  message: string
  detail?: string
}

const logs = ref<LogEntry[]>([])
let counter = 0
let initialized = false

function addLog(level: LogEntry['level'], message: string, detail?: string) {
  const time = new Date().toTimeString().slice(0, 8)
  logs.value.unshift({ id: ++counter, time, level, message, detail })
  if (logs.value.length > 300) logs.value.pop()
}

function initLogger() {
  if (initialized) return
  initialized = true

  // window.onerror
  const prevOnError = window.onerror
  window.onerror = (msg, src, line, col, err) => {
    addLog('error', String(msg), err?.stack ?? `${src}:${line}:${col}`)
    if (typeof prevOnError === 'function') prevOnError(msg, src, line, col, err)
    return false
  }

  // unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
    const detail = e.reason instanceof Error ? e.reason.stack : undefined
    addLog('error', `Unhandled rejection: ${msg}`, detail)
  })

  // console.error
  const origError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    origError(...args)
    addLog('error', args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
  }

  // console.warn
  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    addLog('warn', args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
  }

  // fetch — 攔截失敗的請求
  const origFetch = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const input = args[0]
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    try {
      const res = await origFetch(...args)
      if (!res.ok) {
        addLog('warn', `fetch ${method} → ${res.status} ${res.statusText}`, url)
      }
      return res
    } catch (e) {
      addLog('error', `fetch failed: ${method}`, `${url}\n${String(e)}`)
      throw e
    }
  }
}

async function exportLogs(): Promise<string> {
  const date = new Date().toISOString().slice(0, 10)
  const filename = `medbase-debug-${date}.log`
  const lines = logs.value
    .slice()
    .reverse()
    .map(l => {
      const base = `[${l.time}][${l.level.toUpperCase()}] ${l.message}`
      return l.detail ? `${base}\n    ${l.detail.replace(/\n/g, '\n    ')}` : base
    })
  await writeTextFile(filename, lines.join('\n'), { baseDir: BaseDirectory.Desktop })
  return filename
}

function clearLogs() {
  logs.value = []
}

export function useLogger() {
  return { logs, addLog, initLogger, exportLogs, clearLogs }
}
