import { unzipSync, strFromU8 } from "fflate";
import { DUTY_UNITS, type DutyUnit, type NpDutyImportRow, type NpDutyParseResult } from "./npDutyXlsx";

interface Person { name: string; extension: string }
const SPECIALTIES = ["GS", "CRS", "ORTHO", "NS", "URO", "PS", "CVS", "Chest", "Trauma"] as const;
const CALENDAR_UNITS = ["9A", "9B", "8A", "OR", "SICU", "ICU", "總值",
  "GS", "CRS", "ORTHO", "NS", "PS", "URO", "CVS", "Chest", "Trauma"] as const;

function monthFromTitle(text: string, fallback: string): string {
  const match = text.match(/(\d{2,3})\s*年\s*(\d{1,2})\s*月份?\s*外科值班表/);
  return match ? `${Number(match[1]) + 1911}-${String(Number(match[2])).padStart(2, "0")}` : fallback;
}

function parseList(block: string): Map<string, Person> {
  const people = new Map<string, Person>();
  for (const line of block.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d{1,2})\s*[.．]?\s*([\u3400-\u9fff]{2,4})\s*(\d{5})?/);
    if (match) people.set(match[1], { name: match[2], extension: match[3] ?? "" });
  }
  return people;
}

function specialtyMappings(text: string): Map<string, Map<string, Person>> {
  const result = new Map<string, Map<string, Person>>();
  const start = text.search(/(?:^|\n)GS\s*\nORTHO\s*\nNS\s*\nURO/);
  const end = start < 0 ? -1 : text.indexOf("\nVS\n", start);
  if (start < 0 || end < 0) return result;
  const body = text.slice(start, end).split(/\r?\n/);
  const firstNumbered = body.findIndex(line => /^\s*\d{1,2}\s*[.．]/.test(line));
  if (firstNumbered < 0) return result;
  const blocks: string[][] = [];
  let current: string[] = [];
  let previousNumber = 0;
  for (const line of body.slice(firstNumbered)) {
    const match = line.match(/^\s*(\d{1,2})\s*[.．]?\s*[\u3400-\u9fff]/);
    if (!match) continue;
    const number = Number(match[1]);
    if (current.length && number <= previousNumber) { blocks.push(current); current = []; }
    current.push(line);
    previousNumber = number;
  }
  if (current.length) blocks.push(current);
  SPECIALTIES.forEach((unit, index) => result.set(unit, parseList((blocks[index] ?? []).join("\n"))));
  return result;
}

function globalVs(text: string): Map<string, Person> {
  const start = text.indexOf("\nVS\n");
  if (start < 0) return new Map();
  const end = text.indexOf("\nSA(OR)", start);
  return parseList(text.slice(start, end < 0 ? undefined : end));
}

function npRoster(text: string): Map<string, Person> {
  const match = text.match(/(?:^|\n)NP\s*\n([\s\S]*?)(?=\nNP\(SICU\)|\n◎|$)/);
  const people = new Map<string, Person>();
  if (!match) return people;
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.trim().match(/^(?:([a-z])\s*[.．]?|[.．])\s*([\u3400-\u9fff]{2,4})\s*(\d{5})/i);
    if (entry) people.set(entry[1]?.toLowerCase() ?? `?${entry[2]}`, { name: entry[2], extension: entry[3] });
  }
  return people;
}

function calendarRows(text: string): string[][] {
  // The legacy Word extractor preserves cells as tabs but flattens the entire
  // calendar into one paragraph. The first two cells in each day are empty.
  const matches = [...text.matchAll(/\t\t(\d{1,2})\t[一二三四五六日]\t/g)];
  return matches.map((match, index) => {
    const after = text.slice(match.index, matches[index + 1]?.index ?? text.length);
    return after.split("\t").slice(2, 21).map(cell => cell.trim());
  });
}

function xmlText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>/g)]
    .map(match => match[1] === undefined ? "\t" : match[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .join("");
}

export function readDutyDocx(data: ArrayBuffer): { text: string; calendar: string[][]; images: Uint8Array[] } {
  const files = unzipSync(new Uint8Array(data));
  const documentXml = files["word/document.xml"];
  if (!documentXml) throw new Error("不是有效的 .docx 檔案");
  const xml = strFromU8(documentXml);
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(match => xmlText(match[0]));
  const calendar = [...xml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)]
    .map(match => [...match[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(cell => xmlText(cell[0]).trim()))
    .filter(cells => /^\d{1,2}$/.test(cells[0]?.trim() ?? "") && /[一二三四五六日]/.test(cells[1] ?? ""));
  const images = Object.entries(files).filter(([name]) => /^word\/media\/.*\.(png|jpe?g|webp)$/i.test(name)).map(([, bytes]) => bytes);
  return { text: paragraphs.join("\n"), calendar, images };
}

export function parseDutyWordText(text: string, fallbackMonth: string, suppliedCalendar?: string[][]): NpDutyParseResult {
  const normalizedText = text.normalize("NFKC");
  const month = monthFromTitle(normalizedText, fallbackMonth);
  const calendar = suppliedCalendar?.length ? suppliedCalendar : calendarRows(normalizedText);
  const np = npRoster(normalizedText);
  const vs = globalVs(normalizedText);
  const specialty = specialtyMappings(normalizedText);
  const byName = new Map([...vs.values()].map(person => [person.name, person.extension]));
  const rows: NpDutyImportRow[] = [];
  const warnings: string[] = [];
  const sourcePeople: NonNullable<NpDutyParseResult["sourcePeople"]> = [];
  for (const [code, person] of np) sourcePeople.push({ ...person, staffCode: code.startsWith("?") ? "" : code, group: "NP" });
  for (const [code, person] of vs) sourcePeople.push({ ...person, staffCode: code, group: "VS" });
  for (const [unit, people] of specialty) for (const [code, person] of people) {
    const extension = byName.get(person.name) ?? person.extension;
    sourcePeople.push({ name: person.name, extension, staffCode: code, group: unit });
  }
  const uniquePeople = [...new Map(sourcePeople.map(person => [`${person.group}|${person.staffCode}|${person.name}`, person])).values()];

  for (const cells of calendar) {
    const day = Number(cells[0]);
    const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day);
    if (!day || date.getDate() !== day || date.getMonth() !== Number(month.slice(5, 7)) - 1) continue;
    const dutyDate = `${month}-${String(day).padStart(2, "0")}`;
    // Calendar columns: day, weekday, 9A, 9B, 8A, OR, SICU,
    // optional blank divider, ICU, 總值, then nine specialties.
    const offset = cells.length >= 19 ? 1 : 0;
    const values = [cells[2], cells[3], cells[4], cells[5], cells[6],
      ...cells.slice(7 + offset)];
    CALENDAR_UNITS.forEach((unit, index) => {
      if (!DUTY_UNITS.includes(unit as DutyUnit)) return; // OR/SICU are outside this app's NP/VS scope.
      const raw = (values[index] ?? "").trim();
      if (!raw) return;
      if (unit === "9B" && /PGY/i.test(raw)) {
        rows.push({ dutyDate, ward: unit as DutyUnit, npName: "PGY", staffCode: "PGY", extension: "", shift: "值班", notes: "", sourceSheet: "Word", resolution: "file" });
        return;
      }
      if (unit === "9B" && /^[\u3400-\u9fff]{2,4}$/.test(raw)) {
        rows.push({ dutyDate, ward: unit, npName: raw, staffCode: "", extension: "", shift: "值班", notes: "", sourceSheet: "Word", resolution: "file" });
        return;
      }
      const codes = raw.split("/").map(value => unit === "9A" || unit === "9B" || unit === "8A"
        ? value.replace(/[^a-z]/gi, "").toLowerCase() : value.replace(/\D/g, "")).filter(Boolean);
      codes.forEach((code, codeIndex) => {
        const person = unit === "9A" || unit === "9B" || unit === "8A"
          ? np.get(code) : (unit === "ICU" || unit === "總值" ? vs.get(code) : specialty.get(unit)?.get(code));
        rows.push({ dutyDate, ward: unit as DutyUnit, npName: person?.name ?? "", staffCode: code,
          extension: person ? byName.get(person.name) ?? person.extension : "",
          shift: unit === "9A" || unit === "8A" ? (codeIndex === 0 ? "白八" : "夜八") : "值班",
          notes: unit === "9A" || unit === "9B" || unit === "8A" ? "" : "VS",
          sourceSheet: "Word", resolution: person ? "file" : "unresolved" });
      });
    });
  }
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const parsedDays = new Set(calendar.map(cells => Number(cells[0])));
  const errors: string[] = [];
  if (parsedDays.size < daysInMonth) errors.push(`班表只辨識到 ${parsedDays.size}/${daysInMonth} 天，請確認 Word 檔案完整`);
  if (!rows.length) errors.push("Word 中未解析到 NP／VS 值班資料");
  if (!np.size) warnings.push("Word 的 NP 名冊沒有可讀取的代號；請核對下方自動比對結果與待校正代號");
  return { rows, warnings, errors, sheetNames: ["Word 值班表"], sourcePeople: uniquePeople };
}
