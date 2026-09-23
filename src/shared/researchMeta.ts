/** 論文專案的階段與研究類型，桌機與手機共用（ADR-013） */

export type Stage =
  | "idea" | "irb" | "drafting" | "submitted"
  | "under_review" | "revision" | "accepted" | "published" | "rejected";

/** 語意色只有三種（規格 §4）：中性＝進行中、警示＝需行動、成功＝已完成 */
export type StageTone = "neutral" | "warn" | "success";

export interface StageMeta { key: Stage; label: string; tone: StageTone }

/** 主線階段，UI 進度條依此順序繪製 */
export const STAGE_FLOW: StageMeta[] = [
  { key: "idea",         label: "構想",   tone: "neutral" },
  { key: "irb",          label: "IRB",    tone: "neutral" },
  { key: "drafting",     label: "撰稿",   tone: "neutral" },
  { key: "submitted",    label: "已投稿", tone: "neutral" },
  { key: "under_review", label: "審稿中", tone: "neutral" },
  { key: "revision",     label: "修改中", tone: "warn"    },
  { key: "accepted",     label: "已接受", tone: "success" },
  { key: "published",    label: "已刊登", tone: "success" },
];

/** rejected 是分支不是終點：拒稿後可回到 submitted 換期刊（規格 §2.2） */
export const STAGE_REJECTED: StageMeta = { key: "rejected", label: "被拒", tone: "warn" };

export const ALL_STAGES: StageMeta[] = [...STAGE_FLOW, STAGE_REJECTED];

export function stageMeta(stage: string): StageMeta {
  return ALL_STAGES.find(s => s.key === stage) ?? { key: "idea", label: stage, tone: "neutral" };
}

export function stageIndex(stage: string): number {
  return STAGE_FLOW.findIndex(s => s.key === stage);
}

export const STUDY_TYPES = [
  { key: "case_report",   label: "個案報告" },
  { key: "case_series",   label: "系列個案" },
  { key: "retrospective", label: "回溯性研究" },
  { key: "prospective",   label: "前瞻性研究" },
  { key: "review",        label: "文獻回顧" },
  { key: "other",         label: "其他" },
];

export function studyTypeLabel(key: string | null): string {
  return STUDY_TYPES.find(t => t.key === key)?.label ?? "—";
}

/** IRB 表格的角色分類（規格 §2.4） */
