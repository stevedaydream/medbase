import TurndownService from "turndown";

/** 舊版 Tiptap（StarterKit）HTML 轉 Markdown：只在桌機開啟舊備忘時使用 */
const td = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  hr: "---",
});
td.addRule("strike", { filter: ["s", "del"], replacement: c => `~~${c}~~` });

export function htmlToMarkdown(html: string): string {
  return td.turndown(html).trim() + "\n";
}
