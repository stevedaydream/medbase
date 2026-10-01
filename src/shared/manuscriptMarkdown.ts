/**
 * 論文稿件的 Markdown 處理（桌機、手機共用）。
 * - 舊段落是純文字（format = text）：其中的 * # - 等符號是文字本身，不能直接當 Markdown 解讀
 * - plainToMarkdown 把純文字轉成「顯示結果與原文相同」的 Markdown（跳脫符號、保留換行）
 * - 稿件圖片以 ms-asset:<id> 引用，實際內容在 research_manuscript_assets
 */

export type SectionFormat = "text" | "md";
export interface MsSection { title: string; body: string; format?: SectionFormat | string | null }

export const ASSET_SCHEME = "ms-asset:";
export const assetSrc = (id: string) => `${ASSET_SCHEME}${id}`;
export const assetIdOf = (src: string) => (src.startsWith(ASSET_SCHEME) ? src.slice(ASSET_SCHEME.length) : null);

const TITLE_NAMES = ["title", "標題", "題目"];
export const isTitleSection = (title: string) => TITLE_NAMES.includes(title.trim().toLowerCase());
export const isMd = (s: MsSection) => s.format === "md";

/** 行內會被解讀成語法的字元 */
const INLINE_SPECIAL = /([\\`*_[\]<>~$|!])/g;

/**
 * 純文字 → Markdown：每一行跳脫特殊字元與行首語法（# - + > 數字. 等），
 * 單一換行改成硬換行（行尾反斜線），空行仍是段落分隔。
 */
export function plainToMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const esc = lines.map(l => {
    let s = l.replace(INLINE_SPECIAL, "\\$1");
    // 行首：標題、引用、清單、編號、分隔線、表格、縮排程式碼
    s = s.replace(/^(\s*)([#>+=-])/, "$1\\$2").replace(/^(\s*\d+)([.)])/, "$1\\$2");
    // 四個空白以上開頭會變成程式碼區塊：改用全形空白保留縮排外觀
    s = s.replace(/^( {4,}|\t+)/, m => "　".repeat(Math.ceil(m.replace(/\t/g, "    ").length / 2)));
    // 連續空白在 Markdown 會合併：保留成 &nbsp; 不可行（html 關閉），改用不換行空白字元
    s = s.replace(/ {2,}/g, m => " " + " ".repeat(m.length - 1));
    return s;
  });
  // 段落內的換行：上一行不是空行、下一行也不是空行 → 行尾加反斜線（硬換行）
  return esc.map((l, i) => (l.trim() && esc[i + 1]?.trim() ? `${l}\\` : l)).join("\n");
}

/** ATX 標題整體往下移 by 級（段落標題用 ##，段落內的 # 變 ###），程式碼區塊內不動 */
export function shiftHeadings(md: string, by: number): string {
  let fence: string | null = null;
  return md.split("\n").map(l => {
    const f = /^\s*(```+|~~~+)/.exec(l);
    if (f) { fence = fence ? (l.trim().startsWith(fence[0]) ? null : fence) : f[1]; return l; }
    if (fence) return l;
    const m = /^(#{1,6})(\s.*|)$/.exec(l);
    return m ? `${"#".repeat(Math.min(6, m[1].length + by))}${m[2]}` : l;
  }).join("\n");
}

export const sectionMarkdown = (s: MsSection) => (isMd(s) ? s.body : plainToMarkdown(s.body));

/** 全部段落組成一份 Markdown：Title 段落成為 # 標題，其他段落 ## 段落名稱 */
export function sectionsToMarkdown(sections: MsSection[]): string {
  return sections.map(s => {
    const body = sectionMarkdown(s).trim();
    if (isTitleSection(s.title)) return body ? `# ${body.split("\n").map(l => l.replace(/\\$/, "")).join(" ")}` : "";
    const heading = isMd(s) ? s.title : plainToMarkdown(s.title);
    return `## ${heading}\n\n${isMd(s) ? shiftHeadings(body, 2) : body}`;
  }).filter(Boolean).join("\n\n") + "\n";
}

/** 文件標題（Title 段落第一行，沒有時用備用名稱） */
export function manuscriptTitle(sections: MsSection[], fallback: string): string {
  const t = sections.find(s => isTitleSection(s.title));
  return t?.body.trim().split("\n")[0]?.replace(/^#+\s*/, "") || fallback;
}
