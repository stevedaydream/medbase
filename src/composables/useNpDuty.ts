import { getDb, dbWrite } from "@/db";
import type { DutyUnit } from "@/utils/npDutyXlsx";

export interface NpDutyAssignment {
  id: number;
  duty_date: string;
  ward: DutyUnit;
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
     ORDER BY CASE ward
                WHEN '9A' THEN 1 WHEN '9B' THEN 2 WHEN '8A' THEN 3
                WHEN 'ICU' THEN 4 WHEN '總值' THEN 5 WHEN 'GS' THEN 6 WHEN 'CRS' THEN 7
                WHEN 'ORTHO' THEN 8 WHEN 'NS' THEN 9 WHEN 'PS' THEN 10 WHEN 'URO' THEN 11
                WHEN 'CVS' THEN 12 WHEN 'Chest' THEN 13 WHEN 'Trauma' THEN 14 ELSE 99 END,
              CASE shift WHEN '白八' THEN 1 WHEN '夜八' THEN 2 ELSE 3 END,
              np_name`,
    [date],
  );
}

export const NP_DUTY_UPDATED_EVENT = "medbase:np-duty-updated";

// ── 雲端同步（以月為單位，見 GAS saveNpDutyMonth）──────────────────

export type NpDutyRowInput = Pick<NpDutyAssignment, "duty_date" | "ward" | "np_name" | "staff_code" | "extension" | "shift" | "notes" | "source_file">;

const NP_FIELDS = ["duty_date", "ward", "np_name", "staff_code", "extension", "shift", "notes", "source_file"] as const;

/** 與 SQLite datetime('now','localtime') 同格式，版本以字串比大小 */
function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function gasPost<T>(gasUrl: string, body: object): Promise<T> {
  const res = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function localVersions(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.select<{ month: string; version: string }[]>("SELECT month, version FROM np_duty_months");
  return Object.fromEntries(rows.map(r => [r.month, r.version]));
}

async function setLocalVersion(month: string, version: string): Promise<void> {
  await dbWrite("INSERT OR REPLACE INTO np_duty_months (month, version) VALUES (?, ?)", [month, version]);
}

/** 以整月取代本地資料（匯入、雲端下載共用） */
export async function replaceNpDutyMonth(month: string, rows: NpDutyRowInput[]): Promise<void> {
  await dbWrite("DELETE FROM np_duty_assignments WHERE substr(duty_date,1,7)=?", [month]);
  for (const r of rows) {
    await dbWrite(
      `INSERT OR IGNORE INTO np_duty_assignments
       (duty_date,ward,np_name,staff_code,extension,shift,notes,source_file,imported_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`,
      [r.duty_date, r.ward, r.np_name, r.staff_code || null, r.extension || null,
        r.shift || "值班", r.notes || null, r.source_file || null],
    );
  }
}

/**
 * 本地修改了某個月（匯入、新增、編輯、刪除）後呼叫：更新版本並整月上傳。
 * 雲端已有較新版本時回傳 false（別台電腦在這之間改過），呼叫方應提示並同步。
 */
export async function pushNpDutyMonth(gasUrl: string, month: string): Promise<boolean> {
  const version = nowLocal();
  const prev = (await localVersions())[month];
  await setLocalVersion(month, version);
  if (!gasUrl) return true;
  const db = await getDb();
  const rows = await db.select<NpDutyRowInput[]>(
    `SELECT ${NP_FIELDS.join(",")} FROM np_duty_assignments WHERE substr(duty_date,1,7)=?`, [month],
  );
  const json = await gasPost<{ ok: boolean; code?: string; error?: string }>(
    gasUrl, { action: "saveNpDutyMonth", month, version, rows },
  );
  if (!json.ok && json.code === "STALE") {
    // 還原版本，下次同步才會下載雲端較新的版本；否則會被誤判為本地較新而蓋掉別台的修改
    if (prev) await setLocalVersion(month, prev);
    else await dbWrite("DELETE FROM np_duty_months WHERE month=?", [month]);
    return false;
  }
  if (!json.ok) throw new Error(json.error ?? "GAS 錯誤");
  return true;
}

/**
 * 與雲端比對每月版本：雲端較新的整月下載、本地較新的整月上傳。
 * 同時更新共用的班表下載網址。
 */
export async function syncNpDuty(gasUrl: string): Promise<{ downloaded: string[]; uploaded: string[] }> {
  const remote = await gasPost<{ ok: boolean; error?: string; data?: Record<string, string> }>(
    gasUrl, { action: "getNpDutyVersions" },
  );
  if (!remote.ok) throw new Error(remote.error ?? "GAS 錯誤");
  const cloudV = remote.data ?? {};
  const localV = await localVersions();

  const toDownload = Object.keys(cloudV).filter(m => !localV[m] || cloudV[m] > localV[m]);
  const toUpload = Object.keys(localV).filter(m => !cloudV[m] || localV[m] > cloudV[m]);

  if (toDownload.length) {
    const res = await gasPost<{ ok: boolean; error?: string; data?: Record<string, { version: string; rows: NpDutyRowInput[] }> }>(
      gasUrl, { action: "getNpDutyMonths", months: toDownload },
    );
    if (!res.ok) throw new Error(res.error ?? "GAS 錯誤");
    for (const month of toDownload) {
      const m = res.data?.[month];
      if (!m) continue;
      await replaceNpDutyMonth(month, m.rows);
      await setLocalVersion(month, m.version);
    }
  }

  // 本地較新（例如離線時修改）→ 以本地版本上傳，不重新蓋時間
  const uploaded: string[] = [];
  const db = await getDb();
  for (const month of toUpload) {
    const rows = await db.select<NpDutyRowInput[]>(
      `SELECT ${NP_FIELDS.join(",")} FROM np_duty_assignments WHERE substr(duty_date,1,7)=?`, [month],
    );
    const json = await gasPost<{ ok: boolean; code?: string; error?: string }>(
      gasUrl, { action: "saveNpDutyMonth", month, version: localV[month], rows },
    );
    if (json.ok) uploaded.push(month);
  }

  await refreshNpDutyUrl(gasUrl);
  if (toDownload.length) window.dispatchEvent(new Event(NP_DUTY_UPDATED_EVENT));
  return { downloaded: toDownload, uploaded };
}

// ── 班表下載網址（GAS Config 共用，本地 app_settings 快取）──────────

const NP_URL_KEY = "np_duty_url";

export async function getNpDutyUrl(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", [NP_URL_KEY]);
  return rows[0]?.value ?? "";
}

export async function saveNpDutyUrl(gasUrl: string, url: string): Promise<void> {
  await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [NP_URL_KEY, url]);
  window.dispatchEvent(new Event(NP_DUTY_UPDATED_EVENT));
  if (gasUrl) await gasPost(gasUrl, { action: "saveConfig", key: NP_URL_KEY, value: url });
}

async function refreshNpDutyUrl(gasUrl: string): Promise<void> {
  const res = await gasPost<{ ok: boolean; data?: Record<string, string> }>(gasUrl, { action: "getConfig" });
  const url = res.ok ? res.data?.[NP_URL_KEY] : undefined;
  if (url != null && url !== await getNpDutyUrl()) {
    await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [NP_URL_KEY, url]);
    window.dispatchEvent(new Event(NP_DUTY_UPDATED_EVENT));
  }
}
