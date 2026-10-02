/**
 * SDM 範本（ADR-021）：對照 HIS「醫病共享決策紀錄」表單的欄位，查詢後逐欄複製貼上。
 * 共同欄位只寫一次；病人不同的決定（例如手術／保守治療）各自一組欄位。
 */

/** 手術、檢查、氣切、插管的勾選 */
export type SdmConsent = "" | "同意" | "不同意" | "考慮中";
export const SDM_CONSENTS: SdmConsent[] = ["同意", "不同意", "考慮中"];

/** 病家意向 */
export type SdmIntent = "" | "同意" | "不同意" | "考慮中" | "其他";
export const SDM_INTENTS: SdmIntent[] = ["同意", "不同意", "考慮中", "其他"];

/** 醫病共享決策進行方式（HIS 勾選項） */
export const SDM_METHODS = ["輔助工具", "衛教單張", "影音播放", "模具示範", "口頭溝通", "COVID-19陪病規範"] as const;

/** 自訂欄位（HIS 表單收合區塊或改版後的新欄位） */
export interface SdmField { label: string; value: string }

export interface SdmDecision {
  id: string;
  name: string;              // 例：手術、保守治療
  careDirection: string;     // 確認照護方向
  other: string;             // 其它
  intent: SdmIntent;         // 病家意向
  intentOther: string;
  surgery: SdmConsent;
  surgeryName: string;
  exam: SdmConsent;
  examName: string;
  trach: SdmConsent;         // 氣切
  intubation: SdmConsent;    // 插管
  extra: SdmField[];
}

export interface SdmSpec {
  dept: string;              // 科別（清單分組）
  purpose: string;           // HIS「住院／門診主要目的」要選的項目
  purposeNote: string;       // 主要目的下方的自由輸入
  explanation: string;       // 治療溝通及說明
  methods: string[];         // 進行方式要勾的項目
  methodsOther: string;
  extra: SdmField[];
  decisions: SdmDecision[];
  keywords: string[];
  updatedBy: string;         // 最後修改人（存檔時填寫，本機記住）
  updatedAt: string;
}

export interface SdmEntry { uid: string; name: string; spec: SdmSpec }

const newId = () => Math.random().toString(36).slice(2, 10);

export function emptyDecision(name = ""): SdmDecision {
  return {
    id: newId(), name, careDirection: "", other: "", intent: "", intentOther: "",
    surgery: "", surgeryName: "", exam: "", examName: "", trach: "", intubation: "", extra: [],
  };
}

export function emptySdmSpec(): SdmSpec {
  return {
    dept: "", purpose: "", purposeNote: "", explanation: "", methods: [], methodsOther: "",
    extra: [], decisions: [emptyDecision()], keywords: [], updatedBy: "", updatedAt: "",
  };
}

export function parseSdmSpec(json: string | null | undefined): SdmSpec {
  if (!json) return emptySdmSpec();
  try {
    const s = JSON.parse(json) as Partial<SdmSpec>;
    const out = { ...emptySdmSpec(), ...s };
    out.decisions = (s.decisions?.length ? s.decisions : [emptyDecision()]).map(d => ({ ...emptyDecision(), ...d }));
    return out;
  } catch {
    return emptySdmSpec();
  }
}

/** 搜尋：名稱、科別、主要目的、手術／檢查名稱、關鍵字與內文，空白分隔的每個字都要出現 */
export function searchSdm(list: SdmEntry[], q: string): SdmEntry[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter(e => {
    const s = e.spec;
    const t = [
      e.name, s.dept, s.purpose, s.purposeNote, s.explanation, ...s.keywords,
      ...s.extra.flatMap(f => [f.label, f.value]),
      ...s.decisions.flatMap(d => [d.name, d.careDirection, d.other, d.surgeryName, d.examName, ...d.extra.flatMap(f => [f.label, f.value])]),
    ].join(" ").toLowerCase();
    return words.every(w => t.includes(w));
  });
}

/** 依科別分組（未填科別歸「未分類」），組內依名稱排序 */
export function groupByDept(list: SdmEntry[]): { dept: string; items: SdmEntry[] }[] {
  const m = new Map<string, SdmEntry[]>();
  for (const e of list) {
    const k = e.spec.dept.trim() || "未分類";
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a === "未分類" ? 1 : b === "未分類" ? -1 : a.localeCompare(b, "zh-Hant")))
    .map(([dept, items]) => ({ dept, items: items.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")) }));
}

/** 這個決定在 HIS 要勾的大項（依有填的欄位判斷） */
export function decisionSections(d: SdmDecision, explanation: string): string[] {
  const out: string[] = [];
  if (explanation.trim() || d.careDirection.trim() || d.other.trim() || d.intent) out.push("重大病情討論");
  if (d.surgery || d.exam || d.trach || d.intubation || d.surgeryName.trim() || d.examName.trim()) out.push("手術、檢查或治療");
  return out;
}

/** 存檔前檢查 */
export function checkSdm(name: string, s: SdmSpec): string[] {
  const out: string[] = [];
  if (!name.trim()) out.push("請填範本名稱");
  if (!s.decisions.length) out.push("至少要有一個決定");
  if (s.decisions.length > 1 && s.decisions.some(d => !d.name.trim())) out.push("有多個決定時，每個決定都要命名");
  if ([...s.extra, ...s.decisions.flatMap(d => d.extra)].some(f => f.value.trim() && !f.label.trim())) out.push("自訂欄位要填標題");
  return out;
}

/** 存檔時整理：去掉空的自訂欄位與關鍵字 */
export function normalizeSdm(s: SdmSpec): SdmSpec {
  const clean = (fs: SdmField[]) => fs.filter(f => f.label.trim() || f.value.trim());
  return {
    ...s,
    extra: clean(s.extra),
    keywords: s.keywords.map(k => k.trim()).filter(Boolean),
    decisions: s.decisions.map(d => ({ ...d, extra: clean(d.extra) })),
  };
}
