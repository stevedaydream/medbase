import { getDb } from "@/db";

export interface NpDutyAssignment {
  id: number;
  duty_date: string;
  ward: "9A" | "9B" | "8A";
  np_name: string;
  staff_code: string | null;
  extension: string | null;
  shift: string;
  notes: string | null;
  source_file: string | null;
  imported_at: string;
}

export function localDateKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function loadNpDuty(date: string): Promise<NpDutyAssignment[]> {
  const db = await getDb();
  return db.select<NpDutyAssignment[]>(
    `SELECT * FROM np_duty_assignments
     WHERE duty_date=?
     ORDER BY CASE ward WHEN '9A' THEN 1 WHEN '9B' THEN 2 ELSE 3 END,
              CASE shift WHEN '白八' THEN 1 WHEN '夜八' THEN 2 ELSE 3 END,
              np_name`,
    [date],
  );
}

export const NP_DUTY_UPDATED_EVENT = "medbase:np-duty-updated";
