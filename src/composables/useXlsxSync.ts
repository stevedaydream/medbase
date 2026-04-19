/**
 * 雙軌同步：本地 .xlsx ↔ SQLite ↔ GAS 雲端
 *
 * 支援現有通訊錄 xlsx 格式：
 *   Sheet "VS"     ：兩欄並排（A~E / F~J），欄位 VS / 公務機 / HIS帳號 / 密碼 / 科別
 *   Sheet "常用分機"：一般分機，欄位動態偵測
 */

import { ref } from "vue";
import * as XLSX from "xlsx";
import { readFile, writeFile, watch as watchFs } from "@tauri-apps/plugin-fs";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";

// ── 型別 ────────────────────────────────────────────────────────────

interface XlsxFormatInfo {
  sheets: string[];
  vsSheet: string | null;       // physicians sheet 名稱
  contactSheet: string | null;  // contacts sheet 名稱
  isDualColumn: boolean;        // VS sheet 是否為兩欄並排格式
  contactCols: string[];        // 常用分機欄位名稱
}

// ── 單例 module-level 狀態 ───────────────────────────────────────────

export const xlsxPath    = ref<string>("");
export const isSyncing   = ref(false);
export const lastSyncAt  = ref<string>("");
export const syncStatus  = ref<string>("");
export const formatInfo  = ref<XlsxFormatInfo | null>(null);

let _internalWrite = false;   // 防止 DB→xlsx 觸發 xlsx→DB 的回寫迴圈
let _unwatch: (() => Promise<void>) | null = null;

// ── 工具 ────────────────────────────────────────────────────────────

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cellStr(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val).trim();
}

// 讀取 sheet 第一列的欄位名稱
function sheetHeaders(ws: XLSX.WorkSheet): string[] {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(cell ? cellStr(cell.v) : "");
  }
  return headers;
}

// ── 格式偵測 ─────────────────────────────────────────────────────────

export async function parseXlsxFormat(path: string): Promise<XlsxFormatInfo> {
  const bytes = await readFile(path);
  const wb = XLSX.read(bytes, { type: "array" });

  const sheets = wb.SheetNames;

  // 找 physicians sheet（名稱含 VS / 醫師 / physician）
  const vsSheet = sheets.find(s =>
    /^VS$/i.test(s) || /醫師/.test(s) || /physician/i.test(s)
  ) ?? null;

  // 找 contacts sheet（名稱含 分機 / 常用 / contact）
  const contactSheet = sheets.find(s =>
    /分機/.test(s) || /常用/.test(s) || /contact/i.test(s)
  ) ?? null;

  // 判斷是否兩欄並排：header[0] === header[5] 且都不為空
  let isDualColumn = false;
  if (vsSheet) {
    const ws = wb.Sheets[vsSheet];
    const headers = sheetHeaders(ws);
    if (headers.length >= 6 && headers[0] && headers[0] === headers[5]) {
      isDualColumn = true;
    }
  }

  // 讀常用分機欄位
  let contactCols: string[] = [];
  if (contactSheet) {
    const ws = wb.Sheets[contactSheet];
    contactCols = sheetHeaders(ws).filter(Boolean);
  }

  return { sheets, vsSheet, contactSheet, isDualColumn, contactCols };
}

// ── XLSX → DB ────────────────────────────────────────────────────────

export async function importFromXlsx(): Promise<void> {
  if (!xlsxPath.value || isSyncing.value) return;
  isSyncing.value = true;
  setGlobalSyncing("xlsxSync", true);
  syncStatus.value = "正在從 xlsx 匯入…";

  try {
    const bytes = await readFile(xlsxPath.value);
    const wb = XLSX.read(bytes, { type: "array" });
    const db = await getDb();
    const fmt = formatInfo.value;
    if (!fmt) return;

    // ① Physicians（VS sheet）
    if (fmt.vsSheet && wb.Sheets[fmt.vsSheet]) {
      const ws = wb.Sheets[fmt.vsSheet];
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

      // 讀取左半（col 0~4）和右半（col 5~9）
      type RawPhy = { name: string; ext: string; his_account: string; his_password: string; department: string; updated_at: string };
      const rawRows: RawPhy[] = [];

      const halfCols = fmt.isDualColumn ? 5 : range.e.c + 1;
      const sets = fmt.isDualColumn ? [0, halfCols] : [0];

      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        for (const offset of sets) {
          const name = cellStr(ws[XLSX.utils.encode_cell({ r, c: offset + 0 })]?.v);
          if (!name) continue;
          rawRows.push({
            name,
            ext:          cellStr(ws[XLSX.utils.encode_cell({ r, c: offset + 1 })]?.v),
            his_account:  cellStr(ws[XLSX.utils.encode_cell({ r, c: offset + 2 })]?.v),
            his_password: cellStr(ws[XLSX.utils.encode_cell({ r, c: offset + 3 })]?.v),
            department:   cellStr(ws[XLSX.utils.encode_cell({ r, c: offset + 4 })]?.v),
            updated_at:   cellStr(ws[XLSX.utils.encode_cell({ r, c: offset + 5 })]?.v) || "",
          });
        }
      }

      for (const row of rawRows) {
        const existing = await db.select<{ id: number; updated_at: string | null }[]>(
          "SELECT id, updated_at FROM physicians WHERE name = ? AND (department = ? OR (department IS NULL AND ? = ''))",
          [row.name, row.department, row.department]
        );
        const dbTs    = existing[0]?.updated_at ?? "1970-01-01 00:00:00";
        const xlsxTs  = row.updated_at || nowLocal();
        const isNewer = !row.updated_at || xlsxTs > dbTs;

        if (existing.length && isNewer) {
          await db.execute(
            `UPDATE physicians SET ext=?, his_account=?, his_password=?, department=?, updated_at=? WHERE id=?`,
            [row.ext || null, row.his_account || null, row.his_password || null, row.department || null, xlsxTs, existing[0].id]
          );
        } else if (!existing.length) {
          await db.execute(
            `INSERT INTO physicians (name, ext, his_account, his_password, department, updated_at) VALUES (?,?,?,?,?,?)`,
            [row.name, row.ext || null, row.his_account || null, row.his_password || null, row.department || null, xlsxTs]
          );
        }
      }
    }

    // ② Contacts（常用分機 sheet）
    if (fmt.contactSheet && wb.Sheets[fmt.contactSheet]) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[fmt.contactSheet]);
      // 動態找欄名：label 對應第一個非分機欄，ext 對應含「機」或「分機」或「ext」的欄
      const cols = fmt.contactCols;
      const labelCol   = cols.find(c => !/機|ext|分機|類/i.test(c)) ?? cols[0] ?? "";
      const extCol     = cols.find(c => /機|ext/i.test(c))            ?? cols[1] ?? "";
      const catCol     = cols.find(c => /類|類別|category/i.test(c))  ?? cols[2] ?? "";
      const notesCol   = cols.find(c => /備|note/i.test(c))           ?? "";
      const updatedCol = cols.find(c => /updated|時間|time/i.test(c)) ?? "";

      for (const row of rows) {
        const label = cellStr(row[labelCol]);
        const ext   = cellStr(row[extCol]);
        if (!label || !ext) continue;

        const category   = cellStr(row[catCol])     || "常用分機";
        const notes      = cellStr(row[notesCol])   || null;
        const xlsxTs     = cellStr(row[updatedCol]) || nowLocal();

        const existing = await db.select<{ id: number; updated_at: string | null }[]>(
          "SELECT id, updated_at FROM contacts WHERE label = ? AND ext = ?",
          [label, ext]
        );
        const dbTs    = existing[0]?.updated_at ?? "1970-01-01 00:00:00";
        const isNewer = !cellStr(row[updatedCol]) || xlsxTs > dbTs;

        if (existing.length && isNewer) {
          await db.execute(
            `UPDATE contacts SET category=?, notes=?, updated_at=? WHERE id=?`,
            [category, notes, xlsxTs, existing[0].id]
          );
        } else if (!existing.length) {
          await db.execute(
            `INSERT INTO contacts (label, ext, category, notes, updated_at) VALUES (?,?,?,?,?)`,
            [label, ext, category, notes, xlsxTs]
          );
        }
      }
    }

    lastSyncAt.value = nowLocal();
    syncStatus.value = `xlsx → DB 完成（${lastSyncAt.value}）`;
    autoCloudSync();
    const { autoUpdatePassAhk } = await import("@/composables/usePassAhk");
    autoUpdatePassAhk();
  } catch (e) {
    syncStatus.value = `匯入失敗：${(e as Error).message}`;
  } finally {
    isSyncing.value = false;
    setGlobalSyncing("xlsxSync", false);
  }
}

// ── DB → XLSX ────────────────────────────────────────────────────────

export async function exportToXlsx(): Promise<void> {
  if (!xlsxPath.value) return;
  const fmt = formatInfo.value;
  if (!fmt) return;

  try {
    const db = await getDb();
    const wb = XLSX.utils.book_new();

    // ① VS sheet（physicians）：兩欄並排
    if (fmt.vsSheet) {
      const physicians = await db.select<{
        name: string; ext: string | null; his_account: string | null;
        his_password: string | null; department: string | null; updated_at: string | null;
      }[]>("SELECT name, ext, his_account, his_password, department, updated_at FROM physicians ORDER BY department, name");

      // 按科別分組
      const byDept = new Map<string, typeof physicians>();
      for (const p of physicians) {
        const dept = p.department ?? "";
        if (!byDept.has(dept)) byDept.set(dept, []);
        byDept.get(dept)!.push(p);
      }

      // 建立兩欄並排資料（每科空一列）
      type RowArr = (string | null)[];
      const aoa: RowArr[] = [];
      const header: RowArr = ["VS", "公務機", "HIS帳號", "密碼", "科別", "updated_at",
                               "VS", "公務機", "HIS帳號", "密碼", "科別", "updated_at"];
      aoa.push(header);

      for (const [, group] of byDept) {
        const half = Math.ceil(group.length / 2);
        const left  = group.slice(0, half);
        const right = group.slice(half);
        for (let i = 0; i < half; i++) {
          const l = left[i];
          const r = right[i];
          aoa.push([
            l.name,        l.ext ?? null,          l.his_account ?? null, l.his_password ?? null, l.department ?? null, l.updated_at ?? null,
            r?.name ?? "", r?.ext ?? null,          r?.his_account ?? null, r?.his_password ?? null, r?.department ?? null, r?.updated_at ?? null,
          ]);
        }
        aoa.push(new Array(12).fill(null)); // 科別分隔空列
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, fmt.vsSheet);
    }

    // ② 常用分機 sheet（contacts）
    if (fmt.contactSheet) {
      const contacts = await db.select<{
        label: string; ext: string; category: string | null; notes: string | null; updated_at: string | null;
      }[]>("SELECT label, ext, category, notes, updated_at FROM contacts ORDER BY category, label");

      // 用偵測到的欄名做對應（找 label / ext / category / notes 欄位的原始名稱）
      const cols = fmt.contactCols;
      const labelCol = cols.find(c => !/機|ext|分機|類/i.test(c)) ?? "label";
      const extCol   = cols.find(c => /機|ext/i.test(c))            ?? "ext";
      const catCol   = cols.find(c => /類|類別|category/i.test(c))  ?? "category";
      const notesCol = cols.find(c => /備|note/i.test(c))           ?? "notes";

      const rows = contacts.map(c => ({
        [labelCol]:  c.label,
        [extCol]:    c.ext,
        [catCol]:    c.category ?? "常用分機",
        [notesCol]:  c.notes ?? "",
        updated_at:  c.updated_at ?? "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), fmt.contactSheet);
    }

    // 若 formatInfo 缺 sheet，補一個預設 contacts sheet
    if (!fmt.vsSheet && !fmt.contactSheet) {
      const physicians = await db.select<Record<string, unknown>[]>(
        "SELECT name, ext, his_account, his_password, department, updated_at FROM physicians ORDER BY department, name"
      );
      const contacts = await db.select<Record<string, unknown>[]>(
        "SELECT label, ext, category, notes, updated_at FROM contacts ORDER BY category, label"
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(physicians), "VS");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contacts),   "常用分機");
    }

    _internalWrite = true;
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    await writeFile(xlsxPath.value, buf);
    setTimeout(() => { _internalWrite = false; }, 2500);

    lastSyncAt.value = nowLocal();
    syncStatus.value = `DB → xlsx 完成（${lastSyncAt.value}）`;
  } catch (e) {
    syncStatus.value = `匯出失敗：${(e as Error).message}`;
    _internalWrite = false;
  }
}

// ── 雲端同步 ─────────────────────────────────────────────────────────

export async function autoCloudSync(): Promise<void> {
  const cloud = useCloudSettings();
  await cloud.load();
  if (!cloud.gasUrl) return;

  try {
    const db = await getDb();
    const physicians = await db.select("SELECT * FROM physicians");
    const contacts   = await db.select("SELECT * FROM contacts");

    await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "savePhysicians", data: physicians }),
      mode: "no-cors",
    });
    await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveContacts", data: contacts }),
      mode: "no-cors",
    });
  } catch { /* 雲端同步失敗不阻斷主流程 */ }
}

// ── 監看控制 ─────────────────────────────────────────────────────────

export async function startWatch(path: string): Promise<void> {
  if (_unwatch) {
    try { await _unwatch(); } catch { /* ignore */ }
    _unwatch = null;
  }

  _unwatch = await watchFs(
    path,
    async (_event) => {
      if (_internalWrite || isSyncing.value) return;
      await importFromXlsx();
    },
    { delayMs: 1500 }
  );
}

export async function stopWatch(): Promise<void> {
  if (_unwatch) {
    try { await _unwatch(); } catch { /* ignore */ }
    _unwatch = null;
  }
}

// ── 初次綁定 ─────────────────────────────────────────────────────────

export async function configureAndBind(path: string): Promise<XlsxFormatInfo> {
  const db = await getDb();
  const fmt = await parseXlsxFormat(path);

  xlsxPath.value   = path;
  formatInfo.value = fmt;

  await db.execute(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('xlsx_watch_path', ?)`,
    [path]
  );
  await db.execute(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('xlsx_format', ?)`,
    [JSON.stringify(fmt)]
  );

  await startWatch(path);
  await importFromXlsx();
  return fmt;
}

export async function unbind(): Promise<void> {
  await stopWatch();
  xlsxPath.value   = "";
  formatInfo.value = null;
  syncStatus.value  = "";
  const db = await getDb();
  await db.execute(`DELETE FROM app_settings WHERE key IN ('xlsx_watch_path','xlsx_format')`);
}

// ── App 啟動時恢復 ────────────────────────────────────────────────────

export async function startXlsxWatchFromSettings(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    `SELECT key, value FROM app_settings WHERE key IN ('xlsx_watch_path','xlsx_format')`
  );
  const pathRow   = rows.find(r => r.key === "xlsx_watch_path");
  const formatRow = rows.find(r => r.key === "xlsx_format");
  if (!pathRow?.value) return;

  xlsxPath.value = pathRow.value;
  if (formatRow?.value) {
    try { formatInfo.value = JSON.parse(formatRow.value); } catch { /* 忽略格式解析錯誤 */ }
  }
  if (!formatInfo.value) {
    try { formatInfo.value = await parseXlsxFormat(pathRow.value); } catch { return; }
  }
  await startWatch(pathRow.value);
}
