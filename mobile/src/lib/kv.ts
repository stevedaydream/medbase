/**
 * 極簡 IndexedDB key-value：離線快取唯讀資料（ADR-013）。登出時整個清空。
 * 私密瀏覽等不支援 IndexedDB 的環境，退回記憶體（當次有效）。
 */
const DB_NAME = 'medbase-mobile'
const STORE = 'kv'
const memory = new Map<string, unknown>()
let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(db => new Promise(resolve => {
    if (!db) return resolve(undefined)
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  }))
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const v = await run<T>('readonly', s => s.get(key))
  return v === undefined ? memory.get(key) as T | undefined : v
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value)
  await run('readwrite', s => s.put(value, key))
}

export async function kvClear(): Promise<void> {
  memory.clear()
  await run('readwrite', s => s.clear())
}
