/**
 * Gemini 模型清單：不寫死版本，用金鑰向 API 查詢可用模型（桌機病例潤飾、手機 AI 文件共用）。
 * 預設用 Google 的「最新 Flash」別名，新版推出時自動跟上。
 */
export const AUTO_MODEL = "gemini-flash-latest";
export const AUTO_LABEL = "自動（最新 Flash）";

export interface GeminiModel { id: string; label: string }

/** 快取 24 小時 */
export const MODEL_CACHE_MS = 24 * 60 * 60 * 1000;
export interface ModelCache { at: number; list: GeminiModel[] }

interface ApiModel { name?: string; displayName?: string; supportedGenerationMethods?: string[] }

/** 只留能生成文字的 gemini 模型，新的在前 */
export function parseModels(raw: { models?: ApiModel[] }): GeminiModel[] {
  return (raw.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
    .map(m => ({ id: String(m.name ?? "").replace(/^models\//, ""), label: m.displayName || String(m.name ?? "") }))
    .filter(m => m.id.startsWith("gemini-"))
    .sort((a, b) => b.id.localeCompare(a.id, "en", { numeric: true }));
}

/** 向 API 查詢可用模型（失敗丟出錯誤） */
export async function fetchModels(apiKey: string, fetchFn: typeof fetch = fetch): Promise<GeminiModel[]> {
  if (!apiKey) throw new Error("尚未設定 Gemini 金鑰");
  const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return parseModels(json);
}

/** 選單選項：自動放第一個；目前選的不在清單時也列出，避免選單變空白 */
export function modelOptions(list: GeminiModel[], selected: string): GeminiModel[] {
  const out = [{ id: AUTO_MODEL, label: AUTO_LABEL }, ...list.filter(m => m.id !== AUTO_MODEL)];
  if (selected && !out.some(m => m.id === selected)) out.push({ id: selected, label: selected });
  return out;
}

/** 清單有查到、但選的模型已不存在（例如下架的 preview）→ 改回自動 */
export function validModel(list: GeminiModel[], selected: string): string {
  if (!selected || selected === AUTO_MODEL) return AUTO_MODEL;
  return !list.length || list.some(m => m.id === selected) ? selected : AUTO_MODEL;
}

export function modelLabel(list: GeminiModel[], id: string): string {
  return id === AUTO_MODEL ? AUTO_LABEL : list.find(m => m.id === id)?.label ?? id;
}
