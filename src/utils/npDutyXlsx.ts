import * as XLSX from "xlsx";

export const NP_WARDS = ["9A", "9B", "8A"] as const;
export type NpWard = (typeof NP_WARDS)[number];
export const VS_UNITS = ["ICU", "總值", "GS", "CRS", "ORTHO", "NS", "PS", "URO", "CVS", "Chest", "Trauma"] as const;
export type VsDutyUnit = (typeof VS_UNITS)[number];
export const DUTY_UNITS = [...NP_WARDS, ...VS_UNITS] as const;
export type DutyUnit = (typeof DUTY_UNITS)[number];

export function isNpWard(unit: string): unit is NpWard {
  return (NP_WARDS as readonly string[]).includes(unit);
}

export function isVsDutyUnit(unit: string): unit is VsDutyUnit {
  return (VS_UNITS as readonly string[]).includes(unit);
}

export interface NpDutyImportRow {
  dutyDate: string;
  ward: DutyUnit;
  npName: string;
  staffCode: string;
  extension: string;
  shift: string;
  notes: string;
  sourceSheet: string;
}

export interface NpDutyParseResult {
  rows: NpDutyImportRow[];
  warnings: string[];
  errors: string[];
  sheetNames: string[];
}

type CellValue = string | number | boolean | Date | null | undefined;

const DATE_HEADERS = /^(日期|值班日期|date|day)$/i;
const WARD_HEADERS = /^(病房|病區|單位|ward|unit)$/i;
const NAME_HEADERS = /^(np|vs|姓名|人員|值班np|值班vs|值班人員|專科護理師|護理師|醫師|name)$/i;
const SHIFT_HEADERS = /^(班別|班次|時段|shift)$/i;
const NOTES_HEADERS = /^(備註|說明|notes?|remarks?)$/i;
const CODE_HEADERS = /^(代號|代碼|code)$/i;
const EXT_HEADERS = /^(分機|ext|extension)$/i;

function text(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u3000/g, " ").trim();
}

function normalizedHeader(value: CellValue): string {
  return text(value).replace(/[\s_\-()（）]/g, "").toLowerCase();
}

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDate(value: CellValue, fallbackMonth: string): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number") {
    if (value > 20000) {
      const parsed = XLSX.SSF.parse_date_code(value);
      return parsed ? isoDate(parsed.y, parsed.m, parsed.d) : null;
    }
    if (Number.isInteger(value) && value >= 1 && value <= 31 && /^\d{4}-\d{2}$/.test(fallbackMonth)) {
      const [year, month] = fallbackMonth.split("-").map(Number);
      return isoDate(year, month, value);
    }
  }

  const raw = text(value)
    .replace(/[（(][一二三四五六日天][）)]/g, "")
    .replace(/年/g, "/")
    .replace(/月/g, "/")
    .replace(/日/g, "")
    .trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{2,4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (match) {
    let year = Number(match[1]);
    if (year < 1911) year += 1911;
    return isoDate(year, Number(match[2]), Number(match[3]));
  }

  match = raw.match(/^(\d{1,2})[/.\-](\d{1,2})$/);
  if (match) {
    const fallbackYear = /^\d{4}-\d{2}$/.test(fallbackMonth)
      ? Number(fallbackMonth.slice(0, 4))
      : new Date().getFullYear();
    return isoDate(fallbackYear, Number(match[1]), Number(match[2]));
  }

  match = raw.match(/^(\d{1,2})$/);
  if (match && /^\d{4}-\d{2}$/.test(fallbackMonth)) {
    const [year, month] = fallbackMonth.split("-").map(Number);
    return isoDate(year, month, Number(match[1]));
  }
  return null;
}

function unitsFrom(value: CellValue): DutyUnit[] {
  const raw = text(value).replace(/\s/g, "");
  const upper = raw.toUpperCase();
  const aliases: Record<string, DutyUnit> = {
    WARD: "總值", "WARD/總值": "總值", "病房總值": "總值", CV: "CVS",
  };
  if (aliases[upper]) return [aliases[upper]];
  return DUTY_UNITS.filter(unit => upper === unit.toUpperCase());
}

function splitNames(value: CellValue): string[] {
  return text(value)
    .split(/[、,，;；\n\r]+/)
    .map(name => name.replace(/\s*(值班|NP)\s*$/i, "").trim())
    .filter(Boolean);
}

function findColumn(headers: CellValue[], matcher: RegExp): number {
  return headers.findIndex(cell => matcher.test(normalizedHeader(cell)));
}

function inferWardFromSheet(sheetName: string): DutyUnit | null {
  return unitsFrom(sheetName)[0] ?? null;
}

function parseTableSheet(
  values: CellValue[][],
  sheetName: string,
  fallbackMonth: string,
): NpDutyImportRow[] {
  const inferredWard = inferWardFromSheet(sheetName);

  for (let headerRow = 0; headerRow < Math.min(values.length, 20); headerRow++) {
    const headers = values[headerRow] ?? [];
    const dateCol = findColumn(headers, DATE_HEADERS);
    const wardCol = findColumn(headers, WARD_HEADERS);
    const nameCol = findColumn(headers, NAME_HEADERS);
    if (dateCol < 0 || nameCol < 0 || (wardCol < 0 && !inferredWard)) continue;

    const shiftCol = findColumn(headers, SHIFT_HEADERS);
    const notesCol = findColumn(headers, NOTES_HEADERS);
    const codeCol = findColumn(headers, CODE_HEADERS);
    const extCol = findColumn(headers, EXT_HEADERS);
    const parsed: NpDutyImportRow[] = [];

    for (let rowIndex = headerRow + 1; rowIndex < values.length; rowIndex++) {
      const row = values[rowIndex] ?? [];
      const dutyDate = parseDate(row[dateCol], fallbackMonth);
      const names = splitNames(row[nameCol]);
      const wards = wardCol >= 0 ? unitsFrom(row[wardCol]) : inferredWard ? [inferredWard] : [];
      if (!dutyDate || !names.length || !wards.length) continue;

      for (const ward of wards) {
        for (const npName of names) {
          parsed.push({
            dutyDate,
            ward,
            npName,
            staffCode: codeCol >= 0 ? text(row[codeCol]) : "",
            extension: extCol >= 0 ? text(row[extCol]) : "",
            shift: shiftCol >= 0 ? text(row[shiftCol]) || "值班" : "值班",
            notes: notesCol >= 0 ? text(row[notesCol]) : "",
            sourceSheet: sheetName,
          });
        }
      }
    }
    return parsed;
  }
  return [];
}

function parseCalendarSheet(
  values: CellValue[][],
  sheetName: string,
  fallbackMonth: string,
): NpDutyImportRow[] {
  const inferredWard = inferWardFromSheet(sheetName);

  for (let headerRow = 0; headerRow < Math.min(values.length, 20); headerRow++) {
    const header = values[headerRow] ?? [];
    const dateColumns = header
      .map((value, index) => ({ index, date: parseDate(value, fallbackMonth) }))
      .filter((entry): entry is { index: number; date: string } => Boolean(entry.date));
    if (dateColumns.length < 3) continue;

    const parsed: NpDutyImportRow[] = [];
    for (let rowIndex = headerRow + 1; rowIndex < values.length; rowIndex++) {
      const row = values[rowIndex] ?? [];
      const labelCells = row.slice(0, Math.max(1, dateColumns[0].index));
      const rowWard = labelCells.flatMap(unitsFrom)[0] ?? inferredWard;

      if (rowWard) {
        for (const { index, date } of dateColumns) {
          for (const npName of splitNames(row[index])) {
            parsed.push({ dutyDate: date, ward: rowWard, npName, staffCode: "", extension: "", shift: "值班", notes: "", sourceSheet: sheetName });
          }
        }
        continue;
      }

      const rowName = labelCells.map(text).find(value => value && !/姓名|人員|NP/i.test(value));
      if (!rowName) continue;
      for (const { index, date } of dateColumns) {
        for (const ward of unitsFrom(row[index])) {
          parsed.push({ dutyDate: date, ward, npName: rowName, staffCode: "", extension: "", shift: "值班", notes: "", sourceSheet: sheetName });
        }
      }
    }
    if (parsed.length) return parsed;
  }
  return [];
}

export function parseNpDutyWorkbook(data: ArrayBuffer, fallbackMonth: string): NpDutyParseResult {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const rows: NpDutyImportRow[] = [];
  const warnings: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const values = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }) as CellValue[][];
    const tableRows = parseTableSheet(values, sheetName, fallbackMonth);
    rows.push(...(tableRows.length ? tableRows : parseCalendarSheet(values, sheetName, fallbackMonth)));
  }

  const unique = new Map<string, NpDutyImportRow>();
  for (const row of rows) {
    const key = `${row.dutyDate}|${row.ward}|${row.npName}|${row.shift}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  const deduped = [...unique.values()].sort((a, b) =>
    a.dutyDate.localeCompare(b.dutyDate) || a.ward.localeCompare(b.ward) || a.npName.localeCompare(b.npName)
  );

  const coveredWards = new Set(deduped.map(row => row.ward));
  const missingWards = NP_WARDS.filter(ward => !coveredWards.has(ward));
  if (missingWards.length) warnings.push(`未解析到 ${missingWards.join("、")} 病房資料`);
  if (rows.length !== deduped.length) warnings.push(`已合併 ${rows.length - deduped.length} 筆重複班次`);

  const errors: string[] = [];
  if (!workbook.SheetNames.length) errors.push("活頁簿沒有工作表");
  if (!deduped.length) {
    errors.push("找不到可匯入的班表資料；請確認包含日期、病房與 NP 姓名，或使用下載範本");
  }

  return { rows: deduped, warnings, errors, sheetNames: workbook.SheetNames };
}
