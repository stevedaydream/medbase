/// <reference types="vite/client" />
const GAS_URL = import.meta.env.VITE_GAS_URL as string

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export interface SessionUser {
  code: string
  name: string
  role: string
}

export interface Config {
  booking_open?: string
  booking_month?: string
  booking_from?: string
  booking_until?: string
  schedule_spreadsheet_id?: string
}

// POST without Content-Type header → text/plain → no CORS preflight
export async function gasApi<T = unknown>(
  action: string,
  data: Record<string, unknown> = {}
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
