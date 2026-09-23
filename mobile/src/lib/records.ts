import { computed } from 'vue'
import { data, type Row } from './data'
import { NO_DOCTOR, type ItemRec, type SetRec, type SurgeryTypeRec, type Key } from '@shared/itemsSearch'
import { normName } from '@shared/duty'

/** 把快取的原始列轉成畫面用的格式（同步表的值都是字串） */

export function steps(v: string | undefined): string[] {
  if (!v) return []
  try {
    const arr = JSON.parse(v)
    return Array.isArray(arr) ? arr.map(String).filter(s => s.trim()) : []
  } catch {
    return v.split('\n').map(s => s.trim()).filter(Boolean)
  }
}

export const items = computed<ItemRec[]>(() => data.tables.items.map(r => ({
  hospital_code: r.hospital_code,
  name_zh: r.name_zh || null,
  name_en: r.name_en || null,
  purpose: r.purpose || null,
  unit: r.unit || null,
  price: r.price !== '' && r.price != null && !isNaN(Number(r.price)) ? Number(r.price) : null,
  supplier: r.supplier || null,
  notes: r.notes || null,
  depts: (r.depts || '').split(',').map(s => s.trim()).filter(Boolean),
})).sort((a, b) => (a.name_zh ?? '').localeCompare(b.name_zh ?? '', 'zh-TW')))

export const itemByCode = computed(() => new Map(items.value.map(i => [i.hospital_code, i])))

export interface SetItemRow { hospital_code: string; quantity: number; is_optional: number; sort_order: number; price: number | null; notes: string | null }

export function setItemsOf(r: Row): SetItemRow[] {
  try {
    const arr = JSON.parse(r.items || '[]') as SetItemRow[]
    return Array.isArray(arr) ? arr.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : []
  } catch { return [] }
}

export const setRecs = computed<SetRec[]>(() => data.tables.sets.map(r => ({
  setId: r.uid,
  setName: r.name,
  doctorName: r.physician_name || NO_DOCTOR,
  codes: new Set(setItemsOf(r).map(i => i.hospital_code).filter(Boolean)),
})).sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'zh-TW') || a.setName.localeCompare(b.setName, 'zh-TW')))

export const surgeryTypes = computed<SurgeryTypeRec[]>(() => data.tables.surgeryTypes
  .map(r => ({ id: r.uid, name: r.name, dept: r.dept || null }))
  .sort((a, b) => (a.dept ?? '').localeCompare(b.dept ?? '', 'zh-TW') || a.name.localeCompare(b.name, 'zh-TW')))

export const surgeryItems = computed(() => new Map<Key, Set<string>>(data.tables.surgeryTypes.map(r => [
  r.uid, new Set((r.items || '').split(',').map(s => s.trim()).filter(Boolean)),
])))

/** 值班姓名 → 通訊錄 HIS 帳號（姓名去空白比對） */
export const hisByName = computed(() => new Map(
  data.tables.physicians.filter(p => p.his_account).map(p => [normName(p.name), p.his_account.trim()]),
))

/** 最近查看（首頁用，最多 8 筆，存本機） */
export interface Recent { to: string; title: string; type: string }
const RECENT_KEY = 'mb_recent'
export function recentList(): Recent[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}
export function pushRecent(r: Recent) {
  const list = [r, ...recentList().filter(x => x.to !== r.to)].slice(0, 8)
  localStorage.setItem(RECENT_KEY, JSON.stringify(list))
}
