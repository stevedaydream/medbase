import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { unzipSync, strFromU8 } from "fflate";
import { DOCX_TEMPLATES, type MetaValues, type BlockValues } from "./docxTemplates";

/**
 * 病例討論／公假心得文件產生流程，桌機 DocxComposer 與手機共用（ADR-013）：
 * 上傳檔轉成 Gemini 可讀的內容 → 組提示 → 回填 AI 區塊 → docxtemplater 填原始 Word 模板。
 */

export type TemplateKey = "case" | "leave";

export interface SourceFile {
  name: string;
  kind: "pdf" | "pptx";
  base64?: string; // PDF
  text?: string;   // PPTX 抽取文字
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function extractPptxText(bytes: Uint8Array): string {
  const zip = unzipSync(bytes);
  const names = Object.keys(zip)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
  const out: string[] = [];
  for (const n of names) {
    const xml = strFromU8(zip[n]);
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeXml(m[1])).filter(Boolean);
    if (runs.length) out.push(`【投影片 ${n.match(/\d+/)![0]}】\n${runs.join("\n")}`);
  }
  return out.join("\n\n");
}

/** 讀入使用者選的檔案；不支援的格式回傳 null */
export function readSourceFile(name: string, bytes: Uint8Array): SourceFile | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return { name, kind: "pdf", base64: bytesToBase64(bytes) };
  if (lower.endsWith(".pptx")) return { name, kind: "pptx", text: extractPptxText(bytes) };
  return null;
}

/** Gemini generateContent 的 parts（第一段為指示） */
export function buildGeminiParts(template: TemplateKey, files: SourceFile[], manualText: string, deidentify: boolean) {
  const tpl = DOCX_TEMPLATES[template];
  const blockSpec = tpl.blocks.map(b => `- "${b.key}"：${b.instruction}`).join("\n");
  const promptLines = [
    `你是醫療文件整理助手。請根據提供的簡報、PDF 或文字資料，整理出「${tpl.heading}」所需的結構化內容。`,
    "輸出語言為繁體中文，內容須條理分明、用詞專業且忠於原始資料，不得杜撰。",
  ];
  if (deidentify) {
    promptLines.push("重要：輸出中不得包含可識別個人身份的資訊（真實姓名、病歷號、身分證字號、電話、地址等），一律以 [姓名]、[病歷號] 等標記代替。");
  }
  promptLines.push("", "請僅輸出一個 JSON 物件，鍵與值如下（值為整理後的繁體中文段落文字，可含換行）：", blockSpec, "", "不要輸出 JSON 以外的任何文字或 markdown 標記。");

  const parts: Record<string, unknown>[] = [{ text: promptLines.join("\n") }];
  for (const f of files) {
    if (f.kind === "pdf" && f.base64) parts.push({ inline_data: { mime_type: "application/pdf", data: f.base64 } });
    else if (f.kind === "pptx" && f.text) parts.push({ text: `【簡報檔：${f.name}】\n${f.text}` });
  }
  if (manualText.trim()) parts.push({ text: `【補充文字】\n${manualText.trim()}` });
  return parts;
}

/** 呼叫 Gemini 取得各 AI 區塊內容 */
export async function generateBlocks(template: TemplateKey, apiKey: string, model: string, parts: Record<string, unknown>[]): Promise<BlockValues> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    if (res.status === 429) throw new Error("請求頻率超限（429），請稍候約 1 分鐘後再試。");
    if (res.status === 400 && /API key/i.test(errBody?.error?.message ?? "")) throw new Error("Gemini 金鑰無效，請重新設定");
    throw new Error(errBody?.error?.message ?? `API 錯誤 HTTP ${res.status}`);
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("API 回傳空白結果");
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text); } catch { throw new Error("AI 回傳格式非預期 JSON，請重試"); }
  const out: BlockValues = {};
  for (const b of DOCX_TEMPLATES[template].blocks) if (typeof parsed[b.key] === "string") out[b.key] = parsed[b.key] as string;
  return out;
}

/** 以 docxtemplater 填原始 Word 模板（格式 100% 保留） */
export function renderDocx(template: TemplateKey, meta: MetaValues, blocks: BlockValues): Uint8Array {
  const t = DOCX_TEMPLATES[template];
  const zip = new PizZip(t.templateB64, { base64: true });
  const dt = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,     // 內容中的 \n 轉為換行
    nullGetter: () => "", // 缺值填空字串
  });
  dt.render(t.buildData({ ...meta }, { ...blocks }));
  return dt.getZip().generate({ type: "uint8array" }) as Uint8Array;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
