import type { SearchHit, SearchProvider } from "./types";

/** 自動讀取 providers 資料夾：新增功能只要放一個檔案 */
const modules = import.meta.glob<{ default: SearchProvider }>("./providers/*.ts", { eager: true });
export const PROVIDERS: SearchProvider[] = Object.values(modules).map(m => m.default);

/** 載入所有來源；單一來源失敗不影響其他來源 */
export async function loadAllHits(): Promise<SearchHit[]> {
  const parts = await Promise.all(PROVIDERS.map(p => p.load().catch(() => [] as SearchHit[])));
  return parts.flat();
}
