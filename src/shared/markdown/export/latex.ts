import { parseMarkdown, type Token } from "../render";
import { paperMm, type PrintSettings } from "./settings";
import { startsWithTitle } from "./docx";
import { sanitizeHtml } from "../sanitize";

/**
 * Markdown → LaTeX（ctexart，XeLaTeX 編譯）。圖片保留原本的相對路徑，與 .tex 放在同一資料夾即可編譯。
 * mermaid 圖表無法直接轉換，以註解保留原始碼。
 */

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "$": "\\$", "&": "\\&", "#": "\\#", "%": "\\%",
  "_": "\\_", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
};
export const texEscape = (s: string) => s.replace(/[\\{}$&#%_^~]/g, c => SPECIAL[c]);

function inline(children: Token[] | null, notes: Map<string, string>): string {
  if (!children) return "";
  let out = "";
  for (const t of children) {
    switch (t.type) {
      case "text": out += texEscape(t.content); break;
      case "softbreak": out += "\n"; break;
      case "hardbreak": out += "\\\\\n"; break;
      case "strong_open": out += "\\textbf{"; break;
      case "em_open": out += "\\emph{"; break;
      case "s_open": out += "\\sout{"; break;
      case "strong_close": case "em_close": case "s_close": out += "}"; break;
      case "code_inline": out += `\\texttt{${texEscape(t.content)}}`; break;
      case "link_open": out += `\\href{${String(t.attrGet("href") ?? "").replace(/[%#]/g, m => "\\" + m)}}{`; break;
      case "link_close": out += "}"; break;
      case "image": out += `\\includegraphics[width=\\linewidth,height=0.4\\textheight,keepaspectratio]{${String(t.attrGet("src") ?? "")}}`; break;
      case "math_inline": out += `$${t.content}$`; break;
      case "footnote_ref": {
        const label = String((t.meta as { label?: string; id: number }).label ?? (t.meta as { id: number }).id);
        out += `\\footnote{${notes.get(label) ?? ""}}`;
        break;
      }
      case "html_inline":
        // 行內 HTML 標籤略過（內文保留）；只有待辦核取方塊轉成符號
        if ((t.meta as { trusted?: boolean } | null)?.trusted) out += /checked/.test(t.content) ? "$\\boxtimes$ " : "$\\square$ ";
        break;
      default: if (t.content) out += texEscape(t.content);
    }
  }
  return out;
}

const SECTIONS = ["section", "subsection", "subsubsection", "paragraph", "subparagraph", "subparagraph"];

export function buildLatex(md: string, settings: PrintSettings): string {
  const { tokens } = parseMarkdown(md);
  // 先收集註腳內容
  const notes = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "footnote_open") continue;
    const meta = tokens[i].meta as { id: number; label?: string };
    const parts: string[] = [];
    let j = i;
    while (j < tokens.length && tokens[j].type !== "footnote_close") {
      if (tokens[j].type === "inline") parts.push(inline((tokens[j].children ?? []).filter(c => c.type !== "footnote_anchor"), new Map()));
      j++;
    }
    notes.set(String(meta.label ?? meta.id), parts.join(" "));
  }

  const out: string[] = [];
  const lists: string[] = [];
  let skipFootnotes = false;
  let table: { aligns: string[]; rows: string[][]; cur: string[] } | null = null;
  let headerRows = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (skipFootnotes) { if (t.type === "footnote_block_close") skipFootnotes = false; continue; }
    if (table) {
      if (t.type === "th_open" || t.type === "td_open") {
        const a = /text-align:(\w+)/.exec(String(t.attrGet("style") ?? ""))?.[1];
        if (t.type === "th_open") table.aligns.push(a === "center" ? "c" : a === "right" ? "r" : "l");
        table.cur.push(inline(tokens[i + 1].children, notes));
      } else if (t.type === "tr_close") { table.rows.push(table.cur); table.cur = []; }
      else if (t.type === "thead_close") headerRows = table.rows.length;
      else if (t.type === "table_close") {
        const cols = table.aligns.length || 1;
        const rows = table.rows.map((r, k) => `${r.join(" & ")} \\\\${k === headerRows - 1 ? " \\midrule" : ""}`);
        out.push(`\\begin{center}\n\\begin{tabular}{${table.aligns.slice(0, cols).join("")}}\n\\toprule\n${rows.join("\n")}\n\\bottomrule\n\\end{tabular}\n\\end{center}\n`);
        table = null;
      }
      continue;
    }
    switch (t.type) {
      case "heading_open": {
        const level = Number(t.tag.slice(1));
        const brk = settings.headingBreak && level <= settings.headingBreak ? "\\clearpage\n" : "";
        out.push(`${brk}\\${SECTIONS[level - 1]}{${inline(tokens[i + 1].children, notes)}}\n`);
        i += 2;
        break;
      }
      case "paragraph_open": {
        const text = inline(tokens[i + 1].children, notes);
        out.push(lists.length ? `\\item ${text}\n` : `${text}\n\n`);
        i += 2;
        break;
      }
      case "bullet_list_open": lists.push("itemize"); out.push("\\begin{itemize}\n"); break;
      case "ordered_list_open": lists.push("enumerate"); out.push("\\begin{enumerate}\n"); break;
      case "bullet_list_close": case "ordered_list_close": out.push(`\\end{${lists.pop()}}\n`); break;
      case "blockquote_open": out.push("\\begin{quote}\n"); break;
      case "blockquote_close": out.push("\\end{quote}\n"); break;
      case "fence": case "code_block": {
        const info = t.info.trim().split(/\s+/)[0]?.toLowerCase();
        if (info === "mermaid") out.push(`% mermaid 圖表（LaTeX 無法直接轉換，原始碼如下）\n${t.content.split("\n").map(l => `% ${l}`).join("\n")}\n`);
        else out.push(`\\begin{verbatim}\n${t.content.replace(/\n$/, "")}\n\\end{verbatim}\n`);
        break;
      }
      case "math_block": out.push(`\\[\n${t.content}\n\\]\n`); break;
      case "html_block": {
        // 原文 HTML：標題轉章節，其餘只留文字
        const clean = sanitizeHtml(t.content);
        const h = /^<h([1-6])[^>]*>/.exec(clean.trim());
        const text = texEscape(clean.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim());
        if (text) out.push(h ? `\\${SECTIONS[Number(h[1]) - 1]}{${text.replace(/\n+/g, " ")}}\n` : `${text}\n\n`);
        break;
      }
      case "hr": out.push("\\noindent\\rule{\\linewidth}{0.4pt}\n\n"); break;
      case "page_break": out.push("\\clearpage\n"); break;
      case "toc": out.push("\\tableofcontents\n\\clearpage\n"); break;
      case "table_open": table = { aligns: [], rows: [], cur: [] }; headerRows = 0; break;
      case "footnote_block_open": skipFootnotes = true; break;
      default: break;
    }
  }

  const [w, h] = paperMm(settings);
  const m = settings.margin;
  // 文件已用同名 # 標題開頭時不再 \maketitle
  if (settings.title.trim() && startsWithTitle(tokens, settings.title)) settings = { ...settings, title: "" };
  return `% 由 MedBase 匯出；請用 XeLaTeX 編譯（xelatex 檔名.tex）
\\documentclass[${Math.round(settings.fontSize)}pt]{ctexart}
\\usepackage[paperwidth=${w}mm,paperheight=${h}mm,top=${m.top}mm,right=${m.right}mm,bottom=${m.bottom}mm,left=${m.left}mm]{geometry}
\\usepackage{amsmath,amssymb,graphicx,booktabs,hyperref,ulem,fancyhdr,lastpage}
\\normalem
\\linespread{${settings.lineHeight / 1.2}}
\\pagestyle{fancy}\\fancyhf{}
${settings.header.trim() ? `\\chead{${texEscape(settings.header.trim())}}` : "\\renewcommand{\\headrulewidth}{0pt}"}
\\cfoot{${texEscape(settings.footer.trim())}${settings.pageNumber === "page" ? " 第 \\thepage{} 頁" : settings.pageNumber === "page-total" ? " 第 \\thepage{} 頁，共 \\pageref{LastPage} 頁" : ""}}
${settings.title.trim() ? `\\title{${texEscape(settings.title.trim())}}\\date{}` : ""}
\\begin{document}
${settings.title.trim() ? "\\maketitle\n" : ""}${settings.toc ? "\\tableofcontents\n\\clearpage\n" : ""}
${out.join("")}
\\end{document}
`;
}
