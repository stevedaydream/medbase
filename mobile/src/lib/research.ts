import { reactive, watch } from 'vue'
import { gas } from './api'
import { session } from './session'

/**
 * 論文專案（唯讀，ADR-012／013）：以論文 PIN 取得憑證後，讀取最新的個人雲端備份。
 * 論文屬個人私密資料，只放記憶體不寫入手機；手機上鎖或登出即清除。
 */
type Row = Record<string, unknown>
interface Snapshot { version: number; owner: string; exported_at: string; tables: Record<string, Row[]> }

export const research = reactive({
  token: '',
  snapshot: null as Snapshot | null,
  backupDay: '',
  backupAt: '',
})

export function clearResearch() {
  research.token = ''
  research.snapshot = null
  research.backupDay = ''
  research.backupAt = ''
}

watch(() => [session.locked, session.user], () => { if (session.locked || !session.user) clearResearch() })

export async function unlockResearch(pin: string): Promise<void> {
  const r = await gas<{ token?: string; latest?: { day: string; updated_at: string } | null; code?: string }>('researchLogin', { pin })
  research.token = String(r.token ?? '')
  if (!r.latest) { research.snapshot = { version: 1, owner: '', exported_at: '', tables: {} }; return }
  await loadDay(r.latest.day)
}

export async function listDays(): Promise<{ day: string; updated_at: string }[]> {
  const r = await gas<{ backups: { day: string; updated_at: string }[] }>('researchListBackups', { researchToken: research.token })
  return r.backups ?? []
}

export async function loadDay(day: string): Promise<void> {
  const r = await gas<{ data: string; updated_at: string }>('researchGetBackup', { researchToken: research.token, day })
  research.snapshot = JSON.parse(r.data) as Snapshot
  research.backupDay = day
  research.backupAt = r.updated_at
}

export function table(name: string): Row[] {
  return research.snapshot?.tables[name] ?? []
}
