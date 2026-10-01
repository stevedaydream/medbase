/**
 * 規則備忘錄內容格式：舊版 Tiptap 存 HTML，新版存 Markdown（不轉檔，開啟時判斷）。
 * Tiptap 輸出的 HTML 一定以區塊標籤開頭；Markdown 備忘不會以這些標籤開頭。
 */
const LEGACY_BLOCK = /^\s*<(p|h[1-6]|ul|ol|blockquote|pre|hr)[\s/>]/i;

export function isLegacyHtml(content: string | null | undefined): boolean {
  return !!content && LEGACY_BLOCK.test(content);
}
