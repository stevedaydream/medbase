/**
 * 全域搜尋（ADR-024）：每個功能在 src/search/providers/ 放一個檔案，預設匯出 SearchProvider。
 * OmniSearch 以 import.meta.glob 自動讀取整個資料夾，新增功能不必改搜尋元件。
 */
export interface SearchHit {
  type: string;          // 類型標籤（例：處方、SDM）
  label: string;         // 標題（名稱比對）
  sub: string;           // 副標
  keywords?: string;     // 只用來比對、不顯示的關鍵字與摘要
  route: string;         // 點擊後前往（含 ?focus= 直接選中）
  copy?: { text: string; label: string };
}

export interface SearchProvider {
  key: string;
  /** 這個來源負責的資料表（防漏測試用；不在資料庫的來源給空陣列） */
  tables: string[];
  load(): Promise<SearchHit[]>;
}

/** 前往並選中某一筆：/path?focus=<key>:<id>（可帶其他 query） */
export function focusRoute(path: string, key: string, id: string | number, query: Record<string, string> = {}): string {
  const qs = new URLSearchParams({ ...query, focus: `${key}:${id}` });
  return `${path}?${qs.toString()}`;
}

/** 排序：名稱開頭符合 0、名稱包含 1、各字都在名稱 2、其他欄位符合 3；不符合回傳 -1 */
export function scoreHit(h: SearchHit, q: string): number {
  const query = q.trim().toLowerCase();
  if (!query) return 3;
  const words = query.split(/\s+/).filter(Boolean);
  const label = h.label.toLowerCase();
  const all = `${label} ${h.sub} ${h.keywords ?? ""} ${h.type}`.toLowerCase();
  if (!words.every(w => all.includes(w))) return -1;
  if (label.startsWith(query)) return 0;
  if (label.includes(query)) return 1;
  if (words.every(w => label.includes(w))) return 2;
  return 3;
}

/** 搜尋並排序；每種類型最多 perType 筆，避免某一類洗版 */
export function searchHits(hits: SearchHit[], q: string, perType = 6, max = 40): SearchHit[] {
  const scored = hits.map(h => ({ h, s: scoreHit(h, q) })).filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.h.label.length - b.h.label.length);
  const count = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const { h } of scored) {
    const n = count.get(h.type) ?? 0;
    if (n >= perType) continue;
    count.set(h.type, n + 1);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** 備份群組裡不需要全域搜尋的表（附屬表、設定、含病人資料或個人資料的表） */
export const SEARCH_EXCLUDED = [
  "item_depts", "set_items", "surgery_types", "surgery_type_items",
  "scheduler_users", "sched_docs", "np_duty_months", "np_duty_assignments",
  "acp_items", "acp_records", "ahk_groups", "ahk_group_scripts",
  "note_templates", "note_records", "app_settings",
  "research_users", "research_authors", "research_journals",
  "research_checklist_templates", "research_checklist_template_items",
  "research_project_authors", "research_project_journals",
  "research_project_checklists", "research_project_checklist_items",
  "research_submissions", "research_submission_events", "research_review_rounds", "research_review_comments",
  "research_refs", "research_manuscript_sections", "research_manuscript_assets",
];
