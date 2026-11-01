import { normalizeDutySymbols } from "./dutySymbols";
import { VS_UNITS, type NpDutyImportRow, type NpDutyParseResult, type NpWard, type VsDutyUnit } from "@/utils/npDutyXlsx";

export interface PositionedText {
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
  return normalizeDutySymbols(value).replace(/\s+/g, "").trim();
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

interface RosterHeader { text: string; x: number; top: number }
function parsePgy(items: PositionedText[]): StaffInfo | null {
  const match = items.map(item => item.text).join(" ").match(/PGY\s*([\u3400-\u9fff]{2,4})\s*(\d{5})/i);
  return match ? { name: match[1], extension: match[2] } : null;
}
const SPECIALTY_NAMES = new Set(["GS", "CRS", "ORTHO", "NS", "URO", "PS", "CV", "CVS", "Chest", "Trauma"]);
const MAIN_ROSTERS = new Set(["VS", "NP", "SA(OR)", "NP(SICU)"]);

function rosterMappings(pages: PositionedText[][]) {
  const np = new Map<string, StaffInfo>();
  const vs = new Map<string, StaffInfo>();
  const specialties = new Map<VsDutyUnit, Map<string, StaffInfo>>();
  for (const items of pages) {
    const headers: RosterHeader[] = items.map(item => ({ ...item, text: normalize(item.text) }))
      .filter(item => MAIN_ROSTERS.has(item.text) || SPECIALTY_NAMES.has(item.text));
    for (const header of headers) {
      if (header.text !== "NP" && header.text !== "VS" && !SPECIALTY_NAMES.has(header.text)) continue;
      const main = MAIN_ROSTERS.has(header.text);
      const peers = headers.filter(h => h !== header && Math.abs(h.top - header.top) < (main ? 20 : 4)
        && (main ? MAIN_ROSTERS.has(h.text) : SPECIALTY_NAMES.has(h.text)));
      const left = peers.filter(h => h.x < header.x).sort((a, b) => b.x - a.x)[0];
      const right = peers.filter(h => h.x > header.x).sort((a, b) => a.x - b.x)[0];
      const minX = main ? header.x - 10 : left ? (left.x + header.x) / 2 : 15;
      const maxX = main ? right ? right.x - 10 : 580 : right ? (right.x + header.x) / 2 : 580;
      const next = headers.filter(h => h.top > header.top + 4 && h.x >= minX && h.x < maxX)
        .sort((a, b) => a.top - b.top)[0];
      const scoped = items.filter(i => i.x >= minX && i.x < maxX && i.top > header.top + 4
        && i.top < (next?.top ?? Infinity));
      const group = header.text === "CV" ? "CVS" : header.text;
      const target = group === "NP" ? np : group === "VS" ? vs
        : specialties.get(group as VsDutyUnit) ?? new Map<string, StaffInfo>();
      for (const line of groupLines(scoped)) {
        const text = normalize(line.map(i => i.text).join(""));
        // Trauma's roster may use two columns on the same baseline.
        const entries = text.matchAll(group === "NP"
          ? /[([]?([a-z])[.)\]:]?([\u3400-\u9fff]{2,4})(\d{5})/gi
          : /[([]?(\d{1,2})[.)\]:]?([\u3400-\u9fff]{2,4})(\d{5})?/g);
        for (const match of entries) {
          if (group === "VS" && !match[3]) continue;
          target.set(match[1].toLowerCase(), { name: match[2], extension: match[3] ?? "" });
        }
      }
      if (!main) specialties.set(group as VsDutyUnit, target);
    }
  }
  const byName = new Map([...vs.values()].map(p => [p.name, p.extension]));
  for (const people of specialties.values()) for (const person of people.values()) {
    person.extension ||= byName.get(person.name) ?? "";
  }
  return { np, vs, specialties };
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
  const codes = cell.split("/").map(code => code.replace(/[^a-z]/gi, "").toLowerCase() || code.trim());
  const shifts = ["白八", "夜八"];
  codes.forEach((code, index) => {
    if (!code) return;
    const person = mapping.get(code);
    if (!person && !warnings.includes(`NP 代號 ${code} 需要確認人員`)) warnings.push(`NP 代號 ${code} 需要確認人員`);
    rows.push({
      dutyDate,
      ward,
      npName: person?.name ?? "",
      staffCode: code,
      extension: person?.extension ?? "",
      shift: shifts[index] ?? `班別 ${index + 1}`,
      notes: "",
      sourceSheet,
      resolution: person ? "file" : "unresolved",
    });
  });
}

function addVsCell(
  rows: NpDutyImportRow[],
  dutyDate: string,
  unit: VsDutyUnit,
  cell: string,
  mapping: Map<string, StaffInfo>,
  warnings: string[],
) {
  if (!cell) return;
  const codes = cell.split("/").map(code => code.replace(/\D/g, "")).filter(Boolean);
  for (const code of codes) {
    const person = mapping.get(code);
    if (!person && !warnings.includes(`${unit} VS 代號 ${code} 需要確認人員`)) warnings.push(`${unit} VS 代號 ${code} 需要確認人員`);
    rows.push({
      dutyDate,
      ward: unit,
      npName: person?.name ?? "",
      staffCode: code,
      extension: person?.extension ?? "",
      shift: "值班",
      notes: "VS",
      sourceSheet: "PDF",
      resolution: person ? "file" : "unresolved",
    });
  }
}

/** Parse all pages: the calendar may continue onto the roster page. */
export function parseDutyPdfPages(pages: PositionedText[][], fallbackMonth: string): NpDutyParseResult {
  const month = detectRocMonth(pages.flat(), fallbackMonth);
  const sheetNames = pages.map((_, i) => `PDF 第 ${i + 1} 頁`);
  if (!month) return { rows: [], warnings: [], errors: ["無法判斷班表年月，請選擇正確月份後重試"], sheetNames };
  const { np: mapping, vs: vsMapping, specialties: specialtyVsMappings } = rosterMappings(pages);
  const pgy = pages.map(parsePgy).find(Boolean);
  const warnings: string[] = [];
  const errors: string[] = [];
  const rows: NpDutyImportRow[] = [];
  const parsedDays = new Set<string>();
  if (!mapping.size) warnings.push("未解析到 PDF 的 NP 代號對照，請確認待校正人員");
  if (!vsMapping.size) warnings.push("未解析到 PDF 的 VS 代號對照，請確認待校正人員");

  for (const items of pages) {
    const days = items.filter(i => i.x >= 25 && i.x < 55 && /^\d{1,2}$/.test(i.text.trim()))
      .filter(i => items.some(w => w.x >= 55 && w.x < 75 && Math.abs(w.top - i.top) < 4 && /^[一二三四五六日]$/.test(w.text.trim())))
      .sort((a, b) => a.top - b.top);
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const dutyDate = localIsoDate(month.year, month.month, Number(day.text));
      if (!dutyDate) continue;
      if (parsedDays.has(dutyDate)) { errors.push(`${dutyDate} 在 PDF 中重複，請確認班表版本`); continue; }
      parsedDays.add(dutyDate);
      const previousGap = i ? day.top - days[i - 1].top : days[1] ? days[1].top - day.top : 30;
      const nextGap = days[i + 1] ? days[i + 1].top - day.top : previousGap;
      const line = items.filter(item => item.top >= day.top - previousGap / 2 && item.top < day.top + nextGap / 2)
        .sort((a, b) => a.top - b.top || a.x - b.x);
      addNpCell(rows, dutyDate, "9A", cellAt(line, 70, 106), mapping, "PDF", warnings);
      const ward9b = cellAt(line, 106, 134);
      if (/PGY/i.test(ward9b)) {
        rows.push({ dutyDate, ward: "9B", npName: pgy?.name ? `PGY ${pgy.name}` : "PGY", staffCode: "PGY",
          extension: pgy?.extension ?? "", shift: "值班", notes: "", sourceSheet: "PDF", resolution: "file" });
      } else if (/^[\u3400-\u9fff]{2,4}$/.test(ward9b)) {
        rows.push({ dutyDate, ward: "9B", npName: ward9b, staffCode: "", extension: "", shift: "值班", notes: "", sourceSheet: "PDF", resolution: "file" });
      } else if (ward9b) {
        const before = rows.length;
        addNpCell(rows, dutyDate, "9B", ward9b, mapping, "PDF", warnings);
        for (const row of rows.slice(before)) row.shift = "值班";
      }
      addNpCell(rows, dutyDate, "8A", cellAt(line, 134, 162), mapping, "PDF", warnings);
      const columns: Array<[VsDutyUnit, number, number]> = [
        ["ICU", 220, 255], ["總值", 255, 300], ["GS", 300, 326], ["CRS", 326, 358],
        ["ORTHO", 358, 395], ["NS", 395, 421], ["PS", 421, 447], ["URO", 447, 475],
        ["CVS", 475, 500], ["Chest", 500, 531], ["Trauma", 531, 570],
      ];
      for (const [unit, left, right] of columns) {
        addVsCell(rows, dutyDate, unit, cellAt(line, left, right), unit === "ICU" || unit === "總值"
          ? vsMapping : specialtyVsMappings.get(unit) ?? new Map(), warnings);
      }
    }
  }
  const daysInMonth = new Date(month.year, month.month, 0).getDate();
  if (parsedDays.size !== daysInMonth) errors.push(`班表只辨識到 ${parsedDays.size}/${daysInMonth} 天，請確認 PDF 檔案完整`);
  if (!rows.length) errors.push("PDF 中未解析到 NP／VS 值班資料");
  for (const ward of ["9A", "9B", "8A", ...VS_UNITS]) {
    if (!rows.some(row => row.ward === ward)) warnings.push(`未解析到 ${ward} 值班資料`);
  }
  return { rows: rows.sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.ward.localeCompare(b.ward) || a.shift.localeCompare(b.shift)),
    warnings: [...new Set(warnings)], errors, sheetNames,
    sourcePeople: [
      ...[...mapping].map(([staffCode, person]) => ({ ...person, staffCode, group: "NP" })),
      ...[...vsMapping].map(([staffCode, person]) => ({ ...person, staffCode, group: "VS" })),
      ...[...specialtyVsMappings].flatMap(([group, people]) => [...people].map(([staffCode, person]) => ({ ...person, staffCode, group }))),
    ] };
}
