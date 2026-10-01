import { isNpWard, type NpDutyImportRow } from "./npDutyXlsx";

export interface DutyPerson {
  duty_date: string;
  ward: string;
  np_name: string;
  staff_code: string | null;
  extension: string | null;
}

export interface SavedDutyPerson {
  name: string;
  extension: string;
}

export type SavedDutyMap = Record<string, SavedDutyPerson>;

export function dutyCodeKey(row: Pick<NpDutyImportRow, "ward" | "staffCode">): string {
  const code = row.staffCode.trim().toLowerCase();
  return `${isNpWard(row.ward) ? "NP" : `VS:${row.ward}`}|${code}`;
}

function fromHistory(row: NpDutyImportRow, history: DutyPerson[]): SavedDutyPerson | null {
  const code = row.staffCode.trim().toLowerCase();
  const sameCode = history.filter(person => person.staff_code?.trim().toLowerCase() === code
    && person.np_name.trim() && (isNpWard(row.ward) === isNpWard(person.ward)));
  const scoped = isNpWard(row.ward) ? sameCode : sameCode.filter(person => person.ward === row.ward);
  // A VS number may belong to different specialties. Use other units only if the
  // latest month has exactly one name for that number.
  const candidates = scoped.length ? scoped : sameCode;
  if (!candidates.length) return null;
  const months = candidates.map(person => person.duty_date.slice(0, 7)).sort();
  const latestMonth = months[months.length - 1];
  const latest = candidates.filter(person => person.duty_date.startsWith(latestMonth ?? ""));
  const names = [...new Set(latest.map(person => person.np_name.trim()))];
  if (names.length !== 1) return null;
  const withExtension = latest.find(person => person.extension?.trim());
  return { name: names[0], extension: withExtension?.extension?.trim() ?? "" };
}

export function reconcileDutyRows(rows: NpDutyImportRow[], history: DutyPerson[], saved: SavedDutyMap,
  allowedNpNames?: Set<string>): NpDutyImportRow[] {
  return rows.map(row => {
    if (row.npName.trim() || !row.staffCode.trim()) return { ...row };
    const historical = fromHistory(row, history);
    const match = historical ?? saved[dutyCodeKey(row)];
    const allowed = !allowedNpNames || !isNpWard(row.ward) || allowedNpNames.has(match?.name ?? "");
    return match
      && allowed ? { ...row, npName: match.name, extension: match.extension, resolution: historical ? "history" : "saved" }
      : { ...row, resolution: "unresolved" };
  });
}

export function applyDutyCorrection(rows: NpDutyImportRow[], key: string, person: SavedDutyPerson): NpDutyImportRow[] {
  return rows.map(row => dutyCodeKey(row) === key && row.resolution !== "file"
    ? { ...row, npName: person.name.trim(), extension: person.extension.trim(), resolution: "manual" }
    : row);
}
