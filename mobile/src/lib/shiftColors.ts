import { ref } from 'vue'
import { gas, ApiError } from './api'
import { colorOf, type ShiftColorPrefs } from '@shared/sched/palette'
import type { ShiftDef } from '@shared/sched/types'

/**
 * 個人自選班表顏色：跟著帳號存雲端（GAS prefs），手機另存一份供離線顯示。
 * 有自選就用自選，否則用單位班別設定的顏色。
 */
const KEY = 'mb_shift_colors'

function read(): ShiftColorPrefs {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { return {} }
}

export const myColors = ref<ShiftColorPrefs>(read())

function persist() {
  localStorage.setItem(KEY, JSON.stringify(myColors.value))
}

/** 向雲端取得自己的顏色（離線沿用手機上的） */
export async function loadMyColors(): Promise<void> {
  try {
    const r = await gas<{ prefs: { colors?: ShiftColorPrefs } | null }>('mobileGetPrefs')
    myColors.value = r.prefs?.colors ?? {}
    persist()
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
  }
}

export async function saveMyColors(colors: ShiftColorPrefs): Promise<void> {
  const r = await gas<{ error?: string }>('mobileSetPrefs', { prefs: { colors } }) as { ok: boolean; error?: string }
  if (r.ok === false) throw new Error(r.error ?? '儲存失敗')
  myColors.value = colors
  persist()
}

/** 班別的顯示顏色；不是班別（例如勿休、勿值）回傳 null */
export function shiftColor(code: string | null | undefined, shifts: ShiftDef[]): { bg: string; text: string } | null {
  if (!code) return null
  const own = myColors.value[code]
  if (own) return own
  const s = shifts.find(x => x.code === code)
  return s ? colorOf(s.color) : null
}
