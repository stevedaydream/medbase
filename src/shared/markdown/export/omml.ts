import katex from "katex";

/**
 * LaTeX → Word 原生方程式（OMML）：KaTeX 先轉 MathML，再對應到 OMML 元素。
 * 在 Word 裡可直接編輯。不認得的元素保留其子內容（不會整段消失）。
 */

interface XNode { tag: string; attrs: Record<string, string>; children: XNode[]; text?: string }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);

/** 極簡 XML 解析（KaTeX 輸出一定是格式正確的 XML） */
export function parseXml(xml: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
      const node: XNode = { tag: m[2], attrs, children: [] };
      top.children.push(node);
      if (!m[4]) stack.push(node);
      continue;
    }
    if (m[5] && m[5].trim()) top.children.push({ tag: "#text", attrs: {}, children: [], text: decode(m[5]) });
  }
  return root;
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textOf = (n: XNode): string => n.tag === "#text" ? n.text ?? "" : n.children.map(textOf).join("");
const elems = (n: XNode) => n.children.filter(c => c.tag !== "#text");

const FONT = `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>`;
function run(text: string, plain: boolean): string {
  if (!text) return "";
  return `<m:r>${plain ? `<m:rPr><m:sty m:val="p"/></m:rPr>` : ""}${FONT}<m:t xml:space="preserve">${xmlEsc(text)}</m:t></m:r>`;
}

const ACCENTS = new Set(["^", "ˆ", "~", "˜", "¯", "‾", "→", "←", "˙", "¨", "ˇ", "˘", "´", "`", "⃗", "̂", "̃", "̄", "‾"]);
const NARY = new Set(["∑", "∏", "∐", "∫", "∬", "∭", "∮", "⋃", "⋂", "⋁", "⋀", "⨁", "⨂"]);

function conv(n: XNode): string {
  const kids = elems(n);
  const c = (i: number) => (kids[i] ? conv(kids[i]) : "");
  switch (n.tag) {
    case "#text": return run(n.text ?? "", true);
    case "math": case "semantics": case "mrow": case "mstyle": case "mpadded": case "menclose":
      // semantics 只取第一個（略過 annotation）
      return n.tag === "semantics" ? c(0) : kids.map(conv).join("");
    case "annotation": case "annotation-xml": case "mspace": case "mphantom": return "";
    case "mi": {
      const t = textOf(n);
      const plain = n.attrs.mathvariant === "normal" || t.length > 1;
      return run(t, plain);
    }
    case "mn": case "mtext": case "ms": return run(textOf(n), true);
    case "mo": return run(textOf(n), true);
    case "msup": return `<m:sSup><m:e>${c(0)}</m:e><m:sup>${c(1)}</m:sup></m:sSup>`;
    case "msub": return `<m:sSub><m:e>${c(0)}</m:e><m:sub>${c(1)}</m:sub></m:sSub>`;
    case "msubsup": {
      const base = kids[0] ? textOf(kids[0]).trim() : "";
      if (NARY.has(base)) return `<m:nary><m:naryPr><m:chr m:val="${base}"/></m:naryPr><m:sub>${c(1)}</m:sub><m:sup>${c(2)}</m:sup><m:e></m:e></m:nary>`;
      return `<m:sSubSup><m:e>${c(0)}</m:e><m:sub>${c(1)}</m:sub><m:sup>${c(2)}</m:sup></m:sSubSup>`;
    }
    case "mfrac": {
      const noBar = n.attrs.linethickness === "0" || n.attrs.linethickness === "0px";
      return `<m:f>${noBar ? `<m:fPr><m:type m:val="noBar"/></m:fPr>` : ""}<m:num>${c(0)}</m:num><m:den>${c(1)}</m:den></m:f>`;
    }
    case "msqrt": return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${kids.map(conv).join("")}</m:e></m:rad>`;
    case "mroot": return `<m:rad><m:deg>${c(1)}</m:deg><m:e>${c(0)}</m:e></m:rad>`;
    case "mover": {
      const top = kids[1] ? textOf(kids[1]).trim() : "";
      if (n.attrs.accent === "true" || ACCENTS.has(top)) return `<m:acc><m:accPr><m:chr m:val="${xmlEsc(top || "^")}"/></m:accPr><m:e>${c(0)}</m:e></m:acc>`;
      return `<m:limUpp><m:e>${c(0)}</m:e><m:lim>${c(1)}</m:lim></m:limUpp>`;
    }
    case "munder": {
      const base = kids[0] ? textOf(kids[0]).trim() : "";
      if (NARY.has(base)) return `<m:nary><m:naryPr><m:chr m:val="${base}"/><m:supHide m:val="1"/></m:naryPr><m:sub>${c(1)}</m:sub><m:sup/><m:e></m:e></m:nary>`;
      return `<m:limLow><m:e>${c(0)}</m:e><m:lim>${c(1)}</m:lim></m:limLow>`;
    }
    case "munderover": {
      const base = kids[0] ? textOf(kids[0]).trim() : "";
      if (NARY.has(base)) return `<m:nary><m:naryPr><m:chr m:val="${base}"/></m:naryPr><m:sub>${c(1)}</m:sub><m:sup>${c(2)}</m:sup><m:e></m:e></m:nary>`;
      return `<m:limUpp><m:e><m:limLow><m:e>${c(0)}</m:e><m:lim>${c(1)}</m:lim></m:limLow></m:e><m:lim>${c(2)}</m:lim></m:limUpp>`;
    }
    case "mtable": {
      const rows = kids.filter(k => k.tag === "mtr" || k.tag === "mlabeledtr");
      return `<m:m>${rows.map(r => `<m:mr>${elems(r).filter(d => d.tag === "mtd").map(d => `<m:e>${elems(d).map(conv).join("")}</m:e>`).join("")}</m:mr>`).join("")}</m:m>`;
    }
    default: return kids.map(conv).join("") || run(textOf(n), true);
  }
}

/** LaTeX → OMML（inline：<m:oMath>；display：<m:oMathPara>）；轉換失敗回傳 null */
export function latexToOmml(tex: string, display: boolean): string | null {
  try {
    const mathml = katex.renderToString(tex, { output: "mathml", throwOnError: true, displayMode: display, strict: "ignore" });
    const root = parseXml(mathml);
    const find = (n: XNode): XNode | null => n.tag === "math" ? n : n.children.map(find).find(Boolean) ?? null;
    const math = find(root);
    if (!math) return null;
    const body = `<m:oMath>${conv(math)}</m:oMath>`;
    return display ? `<m:oMathPara>${body}</m:oMathPara>` : body;
  } catch {
    return null;
  }
}
