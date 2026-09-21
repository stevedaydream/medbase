import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { NpDutyImportRow, NpDutyParseResult, NpWard } from "@/utils/npDutyXlsx";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PositionedText {
  text: string;
  x: number;
  top: number;
}

interface StaffInfo {
  name: string;
  extension: string;
}

function localIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").replace(/[．。]/g, ".").trim();
}

async function pageTexts(page: PDFPageProxy): Promise<PositionedText[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return content.items
    .filter(item => "str" in item)
    .map(item => ({
      text: item.str,
      x: item.transform[4],
      top: viewport.height - item.transform[5],
    }));
}

function groupLines(items: PositionedText[], tolerance = 3): PositionedText[][] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const item of sorted) {
    const line = lines.find(candidate => Math.abs(candidate[0].top - item.top) <= tolerance);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.map(line => line.sort((a, b) => a.x - b.x));
}

function detectRocMonth(items: PositionedText[], fallbackMonth: string): { year: number; month: number } | null {
  const joined = normalize(items.map(item => item.text).join(""));
  const match = joined.match(/(\d{2,3})年(\d{1,2})月份?外科值班表/);
  if (match) return { year: Number(match[1]) + 1911, month: Number(match[2]) };
  if (/^\d{4}-\d{2}$/.test(fallbackMonth)) {
    return { year: Number(fallbackMonth.slice(0, 4)), month: Number(fallbackMonth.slice(5, 7)) };
  }
  return null;
}

function parseNpMapping(items: PositionedText[]): Map<string, StaffInfo> {
  const result = new Map<string, StaffInfo>();
  const npOnly = items.filter(item => item.x >= 285 && item.x < 405 && item.top >= 200 && item.top < 480);
  for (const line of groupLines(npOnly)) {
    const joined = normalize(line.map(item => item.text).join(""));
    const match = joined.match(/[○◯]?([a-z])[.]?([\u3400-\u9fff]{2,4})(\d{5})?/i);
    if (!match) continue;
    result.set(match[1].toLowerCase(), { name: match[2], extension: match[3] ?? "" });
  }
  return result;
}

function parsePgy(items: PositionedText[]): StaffInfo | null {
  const joined = items.map(item => item.text).join(" ");
  const match = joined.match(/PGY\s*([\u3400-\u9fff]{2,4})\s*(\d{5})/i);
  return match ? { name: match[1], extension: match[2] } : null;
}

function cellAt(line: PositionedText[], minX: number, maxX: number): string {
  return normalize(line.filter(item => item.x >= minX && item.x < maxX).map(item => item.text).join(""));
}

function addNpCell(
  rows: NpDutyImportRow[],
  dutyDate: string,
  ward: NpWard,
  cell: string,
  mapping: Map<string, StaffInfo>,
  sourceSheet: string,
  warnings: string[],
) {
  if (!cell) return;
  const codes = cell.split("/").map(code => code.replace(/[^a-z]/gi, "").toLowerCase()).filter(Boolean);
  const shifts = ["白八", "夜八"];
  codes.forEach((code, index) => {
    const person = mapping.get(code);
    if (!person) {
      warnings.push(`${dutyDate} ${ward}：找不到代號 ${code} 的 NP 對照`);
      return;
    }
    rows.push({
      dutyDate,
      ward,
      npName: person.name,
      staffCode: code,
      extension: person.extension,
      shift: shifts[index] ?? `班別 ${index + 1}`,
      notes: "",
      sourceSheet,
    });
  });
}

export async function parseNpDutyPdf(data: ArrayBuffer, fallbackMonth: string): Promise<NpDutyParseResult> {
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;
  if (pdf.numPages < 2) {
    return { rows: [], warnings: [], errors: ["PDF 缺少第二頁的 NP 代號對照表"], sheetNames: [] };
  }

  const [page1, page2] = await Promise.all([pdf.getPage(1), pdf.getPage(2)]);
  const [page1Items, page2Items] = await Promise.all([pageTexts(page1), pageTexts(page2)]);
  const month = detectRocMonth(page1Items, fallbackMonth);
  if (!month) {
    return { rows: [], warnings: [], errors: ["無法從 PDF 標題判斷班表年月，請選擇正確月份後重試"], sheetNames: ["PDF 第 1 頁", "PDF 第 2 頁"] };
  }

  const mapping = parseNpMapping(page2Items);
  const pgy = parsePgy(page2Items);
  const warnings: string[] = [];
  const rows: NpDutyImportRow[] = [];
  if (!mapping.size) warnings.push("未解析到第二頁的 NP 代號對照");

  for (const line of groupLines(page1Items)) {
    const dayText = cellAt(line, 25, 55);
    if (!/^\d{1,2}$/.test(dayText)) continue;
    const dutyDate = localIsoDate(month.year, month.month, Number(dayText));
    if (!dutyDate) continue;

    addNpCell(rows, dutyDate, "9A", cellAt(line, 70, 106), mapping, "PDF", warnings);
    const ward9b = cellAt(line, 106, 134);
    if (/PGY/i.test(ward9b)) {
      rows.push({
        dutyDate,
        ward: "9B",
        npName: pgy?.name ? `PGY ${pgy.name}` : "PGY",
        staffCode: "PGY",
        extension: pgy?.extension ?? "",
        shift: "值班",
        notes: "",
        sourceSheet: "PDF",
      });
    } else if (ward9b) {
      const directName = ward9b.replace(/[^\u3400-\u9fffA-Za-z]/g, "");
      if (directName) rows.push({ dutyDate, ward: "9B", npName: directName, staffCode: "", extension: "", shift: "值班", notes: "", sourceSheet: "PDF" });
    }
    addNpCell(rows, dutyDate, "8A", cellAt(line, 134, 162), mapping, "PDF", warnings);
  }

  const dedupedWarnings = [...new Set(warnings)];
  const errors: string[] = [];
  if (!rows.length) errors.push("PDF 中未解析到 9A、9B、8A 值班資料");
  for (const ward of ["9A", "9B", "8A"] as const) {
    if (!rows.some(row => row.ward === ward)) dedupedWarnings.push(`未解析到 ${ward} 病房資料`);
  }
  return {
    rows: rows.sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.ward.localeCompare(b.ward) || a.shift.localeCompare(b.shift)),
    warnings: dedupedWarnings,
    errors,
    sheetNames: ["PDF 第 1 頁", "PDF 第 2 頁"],
  };
}
