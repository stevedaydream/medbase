// 病例討論活動記錄 / 公假心得 — 模板定義與 docxtemplater 佔位符資料映射
// 實際 .docx 模板（含 {placeholder}）見 docxTemplateAssets.ts，匯出時由 DocxComposer 用 docxtemplater 填充
import { CASE_TEMPLATE_B64, LEAVE_TEMPLATE_B64 } from "./docxTemplateAssets";

// ── 型別 ──────────────────────────────────────────────────────────────
export type FieldType = "text" | "date" | "time" | "toggle" | "staff";

export interface MetaField {
  key: string;
  label: string;
  type: FieldType;
  default?: string;
  placeholder?: string;
  toggleOptions?: [string, string]; // type=toggle 用，如 ["國內","國外"]
  autofillKey?: string;             // type=staff 用：選人後自動帶入的目標欄位（如 emp_id）
}

export interface AiBlock {
  key: string;
  label: string;
  instruction: string; // 給 AI 的整理準則
}

export type MetaValues = Record<string, string>;
export type BlockValues = Record<string, string>;

export interface DocxTemplate {
  key: "case" | "leave";
  label: string;
  heading: string;       // 表單抬頭
  templateB64: string;   // 含 {placeholder} 的 .docx 模板 (base64)
  fields: MetaField[];
  blocks: AiBlock[];
  buildData: (meta: MetaValues, blocks: BlockValues) => Record<string, string>; // 佔位符值
  fileName: (meta: MetaValues) => string;
}

// ── 日期 / 天數工具 ────────────────────────────────────────────────────
export function dayCount(from: string, to: string): number | null {
  if (!from || !to) return null;
  const a = new Date(from), b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1; // 含頭尾
  return diff > 0 ? diff : null;
}

function ymd(date: string): { y: string; m: string; d: string } {
  const [y = "", m = "", d = ""] = (date || "").split("-");
  return { y, m, d };
}

function fmtSlash(date: string): string {
  return (date || "").replaceAll("-", "/");
}

// ════════════════════════════════════════════════════════════════════════
// 模板一：病例討論活動記錄
// ════════════════════════════════════════════════════════════════════════
const CASE_TEMPLATE: DocxTemplate = {
  key: "case",
  label: "病例討論",
  heading: "病例討論活動記錄",
  templateB64: CASE_TEMPLATE_B64,
  fields: [
    { key: "date",      label: "日期",     type: "date" },
    { key: "time_from", label: "起",       type: "time", default: "07:40" },
    { key: "time_to",   label: "迄",       type: "time", default: "08:00" },
    { key: "unit",      label: "單位",     type: "text", default: "9A" },
    { key: "location",  label: "地點",     type: "text", default: "第一會議室" },
    { key: "host",      label: "主持人",   type: "text" },
    { key: "recorder",  label: "記錄",     type: "text" },
    { key: "topic",     label: "課程主題", type: "text", default: "PAD case conference" },
    { key: "reporter",  label: "報告人",   type: "text" },
  ],
  blocks: [
    { key: "patient",    label: "患者基本資料", instruction: "患者基本資料（年齡、性別、主訴、相關重要病史摘要）" },
    { key: "history",    label: "病史展演",     instruction: "病史展演（現病史、理學檢查、檢驗與影像重點，依時序整理）" },
    { key: "ddx",        label: "鑑別診斷",     instruction: "鑑別診斷（列出可能診斷與支持/排除理由）" },
    { key: "discussion", label: "討論",         instruction: "討論（治療處置、臨床決策重點、學習要點與結論）" },
  ],
  buildData(meta, blocks) {
    const { y, m, d } = ymd(meta.date);
    const [fh = "", fm = ""] = (meta.time_from || "").split(":");
    const [th = "", tmin = ""] = (meta.time_to || "").split(":");
    return {
      ty: y, tm: m, td: d, tfh: fh, tfm: fm, tth: th, ttm: tmin,
      unit: meta.unit || "", location: meta.location || "",
      host: meta.host || "", recorder: meta.recorder || "",
      topic: meta.topic || "", reporter: meta.reporter || "",
      // 內容前置換行，使其落在標籤下一行（linebreaks: true 會轉成換行）
      patient:    blocks.patient    ? "\n" + blocks.patient    : "",
      history:    blocks.history    ? "\n" + blocks.history    : "",
      ddx:        blocks.ddx        ? "\n" + blocks.ddx        : "",
      discussion: blocks.discussion ? "\n" + blocks.discussion : "",
    };
  },
  fileName(meta) {
    return `病例討論活動記錄_${(meta.date || "").replaceAll("-", "")}.docx`;
  },
};

// ════════════════════════════════════════════════════════════════════════
// 模板二：公假心得
// ════════════════════════════════════════════════════════════════════════
const LEAVE_TEMPLATE: DocxTemplate = {
  key: "leave",
  label: "公假心得",
  heading: "員工參加國內外進修、研習及會議心得報告",
  templateB64: LEAVE_TEMPLATE_B64,
  fields: [
    { key: "unit",        label: "單位",     type: "text", default: "9A" },
    { key: "name",        label: "姓名",     type: "staff", autofillKey: "emp_id" },
    { key: "emp_id",      label: "員編",     type: "text" },
    { key: "scope",       label: "類別",     type: "toggle", default: "國內", toggleOptions: ["國內", "國外"] },
    { key: "course_name", label: "課程（會議）名稱", type: "text" },
    { key: "purpose",     label: "研習目的", type: "text" },
    { key: "date_from",   label: "起日",     type: "date" },
    { key: "date_to",     label: "迄日",     type: "date" },
    { key: "location",    label: "國家\\地點", type: "text", default: "台灣/汐止國泰第一會議室" },
  ],
  blocks: [
    { key: "summary", label: "內容摘要/心得及臨床應用", instruction: "內容摘要、個人心得與臨床應用（約 200 字，需具體描述學習內容與如何應用於臨床）" },
    { key: "benefit", label: "對本院服務品質提升之助益", instruction: "對本院服務品質提升之助益（說明此進修對科部/醫院照護品質的具體幫助）" },
  ],
  buildData(meta, blocks) {
    const days = dayCount(meta.date_from, meta.date_to);
    const date_range = `${fmtSlash(meta.date_from)}~${fmtSlash(meta.date_to)}，共 ${days ?? "  "} 日`;
    const dom  = meta.scope === "國外" ? "□國內" : "■國內";
    const intl = meta.scope === "國外" ? "■國外" : "□國外";
    return {
      unit: meta.unit || "", name: meta.name || "", emp_id: meta.emp_id || "",
      scope_dom: dom, scope_int: intl,
      course_name: meta.course_name || "", purpose: meta.purpose || "",
      date_range, location: meta.location || "",
      summary: blocks.summary || "", benefit: blocks.benefit || "",
      // 單位主管 / 心得繳交者簽名格不填，列印後手寫簽名（nullGetter 自動留空）
    };
  },
  fileName(meta) {
    return `公假心得_${meta.name || ""}_${(meta.date_from || "").replaceAll("-", "")}.docx`;
  },
};

export const DOCX_TEMPLATES: Record<"case" | "leave", DocxTemplate> = {
  case: CASE_TEMPLATE,
  leave: LEAVE_TEMPLATE,
};
