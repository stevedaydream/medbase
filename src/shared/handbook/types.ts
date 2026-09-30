/**
 * 隨身工作手冊（ADR-018）：值班常見狀況、外科照護、行政流程。桌機編輯、手機離線看。
 * 公式計算不存資料，寫在 formulas.ts。
 */
import type { EmStatus } from "../emergency/types";
export { STATUS_LABELS } from "../emergency/types";

export type HbSection = "oncall" | "surgical" | "admin";

export const SECTION_LABELS: Record<HbSection, string> = {
  oncall: "值班常見狀況",
  surgical: "外科照護",
  admin: "行政流程",
};

/** 值班狀況卡固定的段落順序 */
export const ONCALL_BLOCKS = ["電話中先問", "到床邊看", "不能漏掉的危險原因", "初步檢查", "初步處置", "何時通知上級"] as const;

export interface HbBlock { title: string; items: string[] }

export interface HbSpec {
  section: HbSection;
  category: string;
  keywords: string[];
  blocks: HbBlock[];
  /** 相關的危急處置卡（emergency uid） */
  emergency: string[];
  refs: { title: string; url: string }[];
  source: string;
  reviewer: string;
  effective: string;
  status: EmStatus;
  notes: string;
}

export interface HbEntry { uid: string; name: string; spec: HbSpec }

export function emptyHbSpec(section: HbSection = "oncall"): HbSpec {
  return {
    section, category: "", keywords: [],
    blocks: section === "oncall" ? ONCALL_BLOCKS.map(title => ({ title, items: [] })) : [{ title: "", items: [] }],
    emergency: [], refs: [], source: "", reviewer: "", effective: "", status: "draft", notes: "",
  };
}

export function parseHbSpec(json: string | null | undefined): HbSpec | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as Partial<HbSpec>;
    return { ...emptyHbSpec(s.section ?? "oncall"), ...s };
  } catch {
    return null;
  }
}

export function searchHandbook(list: HbEntry[], q: string): HbEntry[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter(e => {
    const t = [e.name, e.spec.category, ...e.spec.keywords].join(" ").toLowerCase();
    return words.every(w => t.includes(w));
  });
}

export const visibleEntries = (list: HbEntry[]) => list.filter(e => e.spec.status !== "draft");

/** 編輯檢查：回傳錯誤（非草稿時不可儲存） */
export function checkHbSpec(name: string, s: HbSpec): string[] {
  const out: string[] = [];
  if (!name.trim()) out.push("請填名稱");
  if (!s.blocks.some(b => b.items.length)) out.push("至少要有一段內容");
  if (s.status === "literature" && !s.refs.length) out.push("文獻版要附參考文獻");
  if (s.status === "published") {
    if (!s.source.trim()) out.push("院內審核版要填依據");
    if (!s.reviewer.trim()) out.push("院內審核版要填審核人");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.effective)) out.push("院內審核版要填生效日");
  }
  return out;
}
