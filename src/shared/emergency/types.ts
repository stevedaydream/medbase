/**
 * 危急處置卡（ADR-017）：桌機與手機共用的資料格式。
 * 分級卡：輸入一個數值、回答是非題 → 依級距顯示處置；一般卡：清單式處置。
 */

export interface EmMed {
  name: string;
  dose: string;          // 劑量、途徑、速度（原文照錄，不計算）
  alert?: boolean;       // 高警訊藥物
}

export interface EmRecheck { label: string; minutes: number }

export interface EmTier {
  id: string;
  min: number | null;    // 含；null＝不設下限
  max: number | null;    // 含；null＝不設上限
  /** 適用條件：是非題 id → 需要的答案；空物件＝不論答案 */
  when: Record<string, boolean>;
  title: string;
  actions: string[];
  meds: EmMed[];
  rechecks: EmRecheck[];
  notes: string;
  /** 這個級距依據的參考文獻（spec.refs 的索引）；未設定＝整張卡的全部文獻 */
  refs?: number[];
}

export interface EmCondition { id: string; question: string }

/** draft＝草稿（不顯示）；literature＝文獻版（顯示、標示未經院內審核）；published＝院內審核版 */
export type EmStatus = "draft" | "literature" | "published";

export interface EmSpec {
  kind: "graded" | "general";
  category: string;
  keywords: string[];
  measure: { label: string; unit: string; step: number } | null;
  conditions: EmCondition[];
  tiers: EmTier[];
  general: { actions: string[]; meds: EmMed[]; rechecks: EmRecheck[] };
  contacts: { label: string; ext: string }[];
  source: string;
  refs: { title: string; url: string }[];
  reviewer: string;
  effective: string;     // YYYY-MM-DD
  status: EmStatus;
  notes: string;
}

export interface EmCard { uid: string; name: string; spec: EmSpec }

export const EM_CATEGORIES = ["血糖", "電解質", "循環", "呼吸", "急救", "其他"] as const;

export const STATUS_LABELS: Record<EmStatus, string> = {
  draft: "草稿",
  literature: "文獻版（未經院內審核）",
  published: "院內審核版",
};

export const DISCLAIMER = "提醒用途，依醫囑與院內規範執行";

export function emptySpec(kind: EmSpec["kind"] = "graded"): EmSpec {
  return {
    kind, category: "其他", keywords: [], measure: kind === "graded" ? { label: "", unit: "", step: 1 } : null,
    conditions: [], tiers: [], general: { actions: [], meds: [], rechecks: [] }, contacts: [],
    source: "", refs: [], reviewer: "", effective: "", status: "draft", notes: "",
  };
}

export function parseSpec(json: string | null | undefined): EmSpec | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as Partial<EmSpec>;
    const base = emptySpec(s.kind ?? "graded");
    return { ...base, ...s, general: { ...base.general, ...(s.general ?? {}) } };
  } catch {
    return null;
  }
}

export const newEmId = () => Math.random().toString(36).slice(2, 10);
