import content from "./content.json";

export type LearningKind = "original" | "reading" | "document";
export interface LearningEntry {
  id: string;
  title: string;
  kind: LearningKind;
  documentId: string;
  complaints: string[];
  markdown: string;
  excerpt: string;
}
export const LEARNING_DOCUMENTS = content.documents;
export const LEARNING_ASSETS: Record<string, string> = content.assets;
export const headingId = (title: string) => title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "");
export const COMPLAINTS = ["胸痛", "腹痛", "心悸", "呼吸喘", "頭痛", "頭暈／眩暈", "下背痛", "發燒"]
  .map(label => ({ id: headingId(label), label }));

const original = LEARNING_DOCUMENTS.find(d => d.id === "original")!;
const reading = LEARNING_DOCUMENTS.find(d => d.id === "reading")!;
const brief = (text: string) => text.replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[#*`|]/g, "").replace(/\s+/g, " ").trim();
const cells = (line: string) => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(s => s.trim().replace(/\\\|/g, "|"));

function originalEntries(): LearningEntry[] {
  const sections = [...original.markdown.matchAll(/^## (.+)\r?$/gm)];
  return sections.flatMap((section, index) => {
    const complaint = COMPLAINTS.find(c => c.label === section[1].trim());
    if (!complaint) return [];
    const body = original.markdown.slice(section.index! + section[0].length, sections[index + 1]?.index);
    const table = body.split(/\r?\n/).filter(line => line.trim().startsWith("|"));
    const headers = cells(table[0]);
    return table.slice(2).map((line, rowIndex) => {
      const values = cells(line);
      return { id: `original-${complaint.id}-${rowIndex + 1}`, title: values[1], kind: "original" as const,
        documentId: "original", complaints: [complaint.id], excerpt: brief(values[2]).slice(0, 100),
        markdown: headers.map((header, i) => `### ${header}\n\n${values[i]}`).join("\n\n") };
    });
  });
}

function readingEntries(): LearningEntry[] {
  const sections = [...reading.markdown.matchAll(/^### (.+)\r?$/gm)];
  const index = reading.markdown.split(/^## 原表對照/m)[0];
  return sections.map((section, i) => {
    const title = section[1].trim();
    const anchor = headingId(title);
    const markdown = reading.markdown.slice(section.index! + section[0].length, sections[i + 1]?.index).trim();
    const complaints = COMPLAINTS.filter(c => {
      const line = index.split(/\r?\n/).find(line => line.startsWith(`- ${c.label}：`)) ?? "";
      return [...line.matchAll(/\]\(#([^)]+)\)/g)].some(m => m[1] === anchor);
    }).map(c => c.id);
    return { id: `reading-${anchor}`, title, kind: "reading" as const, documentId: "reading", complaints,
      markdown, excerpt: brief(markdown.split(/\r?\n/).find(line => line.trim()) ?? "").slice(0, 100) };
  });
}

export const LEARNING_ENTRIES: LearningEntry[] = [
  ...originalEntries(), ...readingEntries(),
  ...LEARNING_DOCUMENTS.map(d => ({ id: `document-${d.id}`, title: d.title, kind: "document" as const,
    documentId: d.id, complaints: [], markdown: d.markdown, excerpt: `完整文件 · ${d.sourceFile}` })),
];
export function learningNotice(documentId: string): string {
  return (LEARNING_DOCUMENTS.find(d => d.id === documentId)?.markdown ?? "")
    .split(/^## /m)[0].split(/\r?\n/).filter(line => line.startsWith(">"))
    .map(line => line.replace(/^>\s*/, "")).join("\n\n");
}
export function learningAsset(path: string, base = "/"): string {
  try { return LEARNING_ASSETS[decodeURIComponent(path)] ? `${base}${LEARNING_ASSETS[decodeURIComponent(path)]}` : ""; }
  catch { return ""; }
}
export function learningEntryForAnchor(anchor: string, documentId: string): LearningEntry | undefined {
  const decoded = decodeURIComponent(anchor.replace(/^#/, ""));
  return documentId === "reading" ? LEARNING_ENTRIES.find(e => e.id === `reading-${decoded}`) : undefined;
}
export function filterLearningEntries(query: string, complaint = "", kind = "all"): LearningEntry[] {
  const normalized = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const terms = query.trim().split(/\s+/).filter(Boolean).map(normalized);
  return LEARNING_ENTRIES.filter(entry => (kind === "all" ? entry.kind !== "document" : entry.kind === kind)
    && (!complaint || entry.kind === "document" || entry.complaints.includes(complaint))
    && terms.every(term => normalized(`${entry.title} ${entry.markdown}`).includes(term)));
}
