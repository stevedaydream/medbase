import { ref } from 'vue'

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

export const GEMINI_MODEL = 'gemini-2.5-flash'

export interface GeminiPart { text?: string; inlineData?: { mimeType: string; data: string } }

/** 單次呼叫，要求 JSON 輸出 */
export async function geminiJson<T>(prompt: string, parts: GeminiPart[] = []): Promise<T> {
  if (!geminiKey.value) throw new Error('請先到「設定」填入 Gemini 金鑰')
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey.value)}`,
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
