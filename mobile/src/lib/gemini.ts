import { ref } from 'vue'
import { AUTO_MODEL, MODEL_CACHE_MS, fetchModels, validModel, type GeminiModel, type ModelCache } from '@shared/geminiModels'

/**
 * Gemini 金鑰：每人在自己手機填入，只存本機，登出時保留（ADR-013）。
 * 由手機直接呼叫 Gemini，內容不經過 MedBase 伺服器。
 */
const KEY = 'mb_gemini_key'
export const geminiKey = ref(localStorage.getItem(KEY) ?? '')

export function saveGeminiKey(v: string) {
  geminiKey.value = v
  if (v) localStorage.setItem(KEY, v)
  else localStorage.removeItem(KEY)
}

// ── 模型：不寫死，用金鑰向 Gemini 查詢可用模型（24 小時快取），預設自動（最新 Flash）──
const MODEL_KEY = 'mb_gemini_model'
const MODELS_KEY = 'mb_gemini_models'
export const geminiModel = ref(localStorage.getItem(MODEL_KEY) || AUTO_MODEL)
export const geminiModels = ref<GeminiModel[]>(readCache()?.list ?? [])

function readCache(): ModelCache | null {
  try { return JSON.parse(localStorage.getItem(MODELS_KEY) ?? 'null') } catch { return null }
}

export function saveGeminiModel(v: string) {
  geminiModel.value = v || AUTO_MODEL
  localStorage.setItem(MODEL_KEY, geminiModel.value)
}

/**
 * 更新模型清單；force＝不管快取。回傳是否把已下架的模型改回自動。
 * 查詢失敗時 force 才丟出錯誤，否則沿用快取。
 */
export async function loadGeminiModels(force = false): Promise<boolean> {
  const cache = readCache()
  if (force || !cache || Date.now() - cache.at >= MODEL_CACHE_MS) {
    try {
      geminiModels.value = await fetchModels(geminiKey.value)
      localStorage.setItem(MODELS_KEY, JSON.stringify({ at: Date.now(), list: geminiModels.value }))
    } catch (e) {
      if (force) throw e
    }
  }
  const v = validModel(geminiModels.value, geminiModel.value)
  if (v === geminiModel.value) return false
  saveGeminiModel(v)
  return true
}

export interface GeminiPart { text?: string; inlineData?: { mimeType: string; data: string } }

/** 單次呼叫，要求 JSON 輸出 */
export async function geminiJson<T>(prompt: string, parts: GeminiPart[] = []): Promise<T> {
  if (!geminiKey.value) throw new Error('請先到「設定」填入 Gemini 金鑰')
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel.value}:generateContent?key=${encodeURIComponent(geminiKey.value)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [...parts, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
      }),
    },
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('Gemini 金鑰無效，請到「設定」重新填入')
    if (res.status === 429) throw new Error('Gemini 用量已達上限，請稍後再試')
    throw new Error(`Gemini 錯誤：${msg}`)
  }
  const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  try { return JSON.parse(text) as T } catch { throw new Error('Gemini 回傳格式錯誤，請再試一次') }
}
