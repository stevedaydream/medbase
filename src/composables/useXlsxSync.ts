/**
 * 雙軌同步 v2：本地 .xlsx ↔ SQLite ↔ GAS 雲端
 *
 * 改動：
 *   - 全欄位同步（含 title, phs_account, phs_password, notes）
 *   - 彈性 header 偵測（不依賴固定欄位順序）
 *   - export 改為單欄命名格式（舊雙欄仍可 import）
 *   - autoCloudSync 改 merge 模式，移除 no-cors
 *   - 新增 createAndBind（建立全新 xlsx）
 */

import { ref } from "vue";
import * as XLSX from "xlsx";
import { readFile, writeFile, watch as watchFs } from "@tauri-apps/plugin-fs";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";

// ── 型別 ─────────────────────────────────────────────────────────────

interface XlsxFormatInfo {
  sheets: string[];
  vsSheet: string | null;
  contactSheet: string | null;
  isDualColumn: boolean;
  contactCols: string[];
}

// ── 單例狀態 ──────────────────────────────────────────────────────────

export const xlsxPath    = ref<string>("");
export const isSyncing   = ref(false);
export const lastSyncAt  = ref<string>("");
export const syncStatus  = ref<string>("");
export const formatInfo  = ref<XlsxFormatInfo | null>(null);

let _internalWrite = false;
let _unwatch: (() => Promise<void>) | null = null;

// ── 工具 ──────────────────────────────────────────────────────────────

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function cellStr(val: unknown): string {
  if (val === undefined || val === null) return "";
  return String(val).trim();
}

function sheetHeaders(ws: XLSX.WorkSheet): string[] {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(cell ? cellStr(cell.v) : "");
  }
  return headers;
}

// 依 header 名稱動態偵測欄位索引（相對 offset）
function detectPhysHmap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const matchers: [string, RegExp][] = [
    ["name",         /^(VS|姓名|name)$/i],
    ["ext",          /公務機|分機|ext/i],
    ["his_account",  /HIS帳號|his_account/i],
    ["his_password", /HIS密碼|his_password/i],
    ["phs_account",  /PHS帳號|phs_account/i],
    ["phs_password", /PHS密碼|phs_password/i],
    ["title",        /^職稱$|^title$/i],
    ["department",   /科別|部門|department/i],
    ["notes",        /^備註$|^notes$/i],
    ["updated_at",   /updated_at|更新時間/i],
  ];
  for (const [field, re] of matchers) {
    const idx = headers.findIndex(h => re.test(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

// ── 格式偵測 ──────────────────────────────────────────────────────────

export async function parseXlsxFormat(path: string): Promise<XlsxFormatInfo> {
  const bytes = await readFile(path);
  const wb = XLSX.read(bytes, { type: "array" });
  const sheets = wb.SheetNames;

  const vsSheet = sheets.find(s =>
    /^VS$/i.test(s) || /醫師/.test(s) || /physician/i.test(s)
  ) ?? null;

  const contactSheet = sheets.find(s =>
    /分機/.test(s) || /常用/.test(s) || /contact/i.test(s)
  ) ?? null;

  let isDualColumn = false;
  if (vsSheet) {
    const headers = sheetHeaders(wb.Sheets[vsSheet]);
    if (headers.length >= 6 && headers[0] && headers[0] === headers[5]) {
      isDualColumn = true;
    }
  }

  let contactCols: string[] = [];
  if (contactSheet) {
    contactCols = sheetHeaders(wb.Sheets[contactSheet]).filter(Boolean);
  }

  return { sheets, vsSheet, contactSheet, isDualColumn, contactCols };
}

// ── XLSX → DB ─────────────────────────────────────────────────────────

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
      const allHeaders = sheetHeaders(ws);
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

      // 從實際 header 重新偵測是否雙欄（不依賴儲存的 fmt.isDualColumn）
      const actualDual = allHeaders.length >= 6 && !!allHeaders[0] && allHeaders[0] === allHeaders[5];
      const halfCols   = actualDual ? Math.ceil(allHeaders.length / 2) : allHeaders.length;
      const offsets    = actualDual ? [0, halfCols] : [0];

      for (const offset of offsets) {
        const headers = allHeaders.slice(offset, offset + halfCols);
        const hmap = detectPhysHmap(headers);
        if (hmap.name === undefined) continue;

        const get = (ws: XLSX.WorkSheet, r: number, field: string) => {
          const col = hmap[field];
          return col !== undefined
            ? cellStr(ws[XLSX.utils.encode_cell({ r, c: offset + col })]?.v)
            : "";
        };

        for (let r = range.s.r + 1; r <= range.e.r; r++) {
          const name = get(ws, r, "name");
          if (!name) continue;

          const dept       = get(ws, r, "department") || null;
          const xlsxTs     = get(ws, r, "updated_at") || nowLocal();
          const row = {
            name,
            ext:          get(ws, r, "ext")          || null,
            his_account:  get(ws, r, "his_account")   || null,
            his_password: get(ws, r, "his_password")  || null,
            phs_account:  get(ws, r, "phs_account")   || null,
            phs_password: get(ws, r, "phs_password")  || null,
            title:        get(ws, r, "title")         || null,
            department:   dept,
            notes:        get(ws, r, "notes")         || null,
            updated_at:   xlsxTs,
          };

          const existing = await db.select<{ id: number; updated_at: string | null }[]>(
            `SELECT id, updated_at FROM physicians
             WHERE name=? AND (department=? OR (department IS NULL AND ?=''))`,
            [row.name, row.department ?? "", row.department ?? ""]
          );
          const dbTs    = existing[0]?.updated_at ?? "1970-01-01 00:00:00";
          const isNewer = !get(ws, r, "updated_at") || xlsxTs > dbTs;

          if (existing.length && isNewer) {
            await db.execute(
              `UPDATE physicians
               SET ext=?,his_account=?,his_password=?,phs_account=?,phs_password=?,
                   title=?,department=?,notes=?,updated_at=?
               WHERE id=?`,
              [row.ext, row.his_account, row.his_password, row.phs_account, row.phs_password,
               row.title, row.department, row.notes, row.updated_at, existing[0].id]
            );
          } else if (!existing.length) {
            await db.execute(
              `INSERT INTO physicians
               (name,ext,his_account,his_password,phs_account,phs_password,title,department,notes,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [row.name, row.ext, row.his_account, row.his_password, row.phs_account,
               row.phs_password, row.title, row.department, row.notes, row.updated_at]
            );
          }
        }
      }
    }

    // ② Contacts（常用分機 sheet）
    if (fmt.contactSheet && wb.Sheets[fmt.contactSheet]) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[fmt.contactSheet]);
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

        const category = cellStr(row[catCol])     || "常用分機";
        const notes    = cellStr(row[notesCol])   || null;
        const xlsxTs   = cellStr(row[updatedCol]) || nowLocal();

        const existing = await db.select<{ id: number; updated_at: string | null }[]>(
          "SELECT id, updated_at FROM contacts WHERE label=? AND ext=?",
          [label, ext]
        );
        const dbTs    = existing[0]?.updated_at ?? "1970-01-01 00:00:00";
        const isNewer = !cellStr(row[updatedCol]) || xlsxTs > dbTs;

        if (existing.length && isNewer) {
          await db.execute(
            `UPDATE contacts SET category=?,notes=?,updated_at=? WHERE id=?`,
            [category, notes, xlsxTs, existing[0].id]
          );
        } else if (!existing.length) {
          await db.execute(
            `INSERT INTO contacts (label,ext,category,notes,updated_at) VALUES (?,?,?,?,?)`,
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
    syncStatus.value = `匯入失敗：${String(e)}`;
  } finally {
    isSyncing.value = false;
    setGlobalSyncing("xlsxSync", false);
  }
}

// ── DB → XLSX ─────────────────────────────────────────────────────────
// 輸出格式：單欄命名 headers，包含全部欄位

export async function exportToXlsx(): Promise<void> {
  if (!xlsxPath.value) return;
  const fmt = formatInfo.value;
  if (!fmt) return;

  try {
    const db = await getDb();
    const wb = XLSX.utils.book_new();

    // ① VS sheet（physicians）
    const vsSheetName = fmt.vsSheet ?? "VS";
    {
      const rows = await db.select<{
        name: string; ext: string | null;
        his_account: string | null; his_password: string | null;
        phs_account: string | null; phs_password: string | null;
        title: string | null; department: string | null;
        notes: string | null; updated_at: string | null;
      }[]>(
        `SELECT name,ext,his_account,his_password,phs_account,phs_password,
                title,department,notes,updated_at
         FROM physicians ORDER BY department, name`
      );
      const headers = ["姓名","分機","HIS帳號","HIS密碼","PHS帳號","PHS密碼","職稱","科別","備註","updated_at"];
      const data = rows.map(p => [
        p.name,          p.ext ?? "",
        p.his_account ?? "", p.his_password ?? "",
        p.phs_account ?? "", p.phs_password ?? "",
        p.title ?? "",   p.department ?? "",
        p.notes ?? "",   p.updated_at ?? "",
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      // 帳密欄設純文字格式防前導零消失
      [3, 4, 5, 6].forEach(col => {
        for (let r = 1; r <= data.length; r++) {
          const addr = XLSX.utils.encode_cell({ r, c: col });
          if (ws[addr]) ws[addr].z = "@";
        }
      });
      XLSX.utils.book_append_sheet(wb, ws, vsSheetName);
    }

    // ② 常用分機 sheet（contacts）
    const contactSheetName = fmt.contactSheet ?? "常用分機";
    {
      const rows = await db.select<{
        label: string; ext: string;
        category: string | null; notes: string | null; updated_at: string | null;
      }[]>(
        "SELECT label,ext,category,notes,updated_at FROM contacts ORDER BY category, label"
      );
      const cols = fmt.contactCols;
      const labelCol = cols.find(c => !/機|ext|分機|類/i.test(c)) ?? "名稱";
      const extCol   = cols.find(c => /機|ext/i.test(c))            ?? "分機";
      const catCol   = cols.find(c => /類|類別|category/i.test(c))  ?? "類別";
      const notesCol = cols.find(c => /備|note/i.test(c))           ?? "備註";
      const data = rows.map(c => ({
        [labelCol]:  c.label,
        [extCol]:    c.ext,
        [catCol]:    c.category ?? "常用分機",
        [notesCol]:  c.notes ?? "",
        updated_at:  c.updated_at ?? "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), contactSheetName);
    }

    _internalWrite = true;
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    await writeFile(xlsxPath.value, buf);
    setTimeout(() => { _internalWrite = false; }, 2500);

    // 更新 formatInfo 為新的單欄格式
    formatInfo.value = {
      sheets: [vsSheetName, contactSheetName],
      vsSheet: vsSheetName,
      contactSheet: contactSheetName,
      isDualColumn: false,
      contactCols: formatInfo.value?.contactCols ?? ["名稱","分機","類別","備註"],
    };

    lastSyncAt.value = nowLocal();
    syncStatus.value = `DB → xlsx 完成（${lastSyncAt.value}）`;
  } catch (e) {
    syncStatus.value = `匯出失敗：${String(e)}`;
    _internalWrite = false;
  }
}

// ── 雲端同步（merge 模式，無 no-cors）─────────────────────────────────

export async function autoCloudSync(): Promise<void> {
  const cloud = useCloudSettings();
  await cloud.load();
  if (!cloud.gasUrl) return;

  const gasUrl = cloud.gasUrl;

  async function gasPost(body: object): Promise<any> {
    const res = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  const db = await getDb();

  // ① Physicians：merge（雲端為主，本地有雲端無的才補上）
  try {
    const localPhys = await db.select<any[]>("SELECT * FROM physicians");
    const pullJson  = await gasPost({ action: "getPhysicians" });
    const cloudPhys: any[] = pullJson.ok ? (pullJson.data ?? []) : [];
    const cloudAccounts = new Set(cloudPhys.map((r: any) => r.his_account).filter(Boolean));
    const cloudNames    = new Set(cloudPhys.map((r: any) => r.name).filter(Boolean));
    const newLocal = localPhys.filter(p =>
      !(p.his_account && cloudAccounts.has(p.his_account)) && !cloudNames.has(p.name)
    );
    if (newLocal.length > 0) {
      await gasPost({ action: "savePhysicians", data: [...cloudPhys, ...newLocal] });
    }
  } catch { /* 雲端失敗不阻斷 */ }

  // ② Contacts：merge（雲端為主，本地有雲端無的才補上，key = label）
  try {
    const localContacts = await db.select<any[]>("SELECT * FROM contacts");
    const pullJson      = await gasPost({ action: "getContacts" });
    const cloudContacts: any[] = pullJson.ok ? (pullJson.data ?? []) : [];
    const cloudLabels = new Set(cloudContacts.map((r: any) => r.label).filter(Boolean));
    const newLocal = localContacts.filter(c => !cloudLabels.has(c.label));
    if (newLocal.length > 0) {
      await gasPost({ action: "saveContacts", data: [...cloudContacts, ...newLocal] });
    }
  } catch { /* 雲端失敗不阻斷 */ }
}

// ── 監看控制 ──────────────────────────────────────────────────────────

export async function startWatch(path: string): Promise<void> {
  if (_unwatch) {
    try { await _unwatch(); } catch { /* ignore */ }
    _unwatch = null;
  }
  try {
    _unwatch = await watchFs(
      path,
      async () => {
        if (_internalWrite || isSyncing.value) return;
        await importFromXlsx();
      },
      { delayMs: 1500 }
    );
  } catch (e) {
    // watch 不可用時（features 未啟用或平台不支援），降級為僅手動同步
    console.warn("[xlsxSync] watch 不可用，降級為手動同步：", String(e));
    syncStatus.value += "（自動偵測不可用，請手動同步）";
  }
}

export async function stopWatch(): Promise<void> {
  if (_unwatch) {
    try { await _unwatch(); } catch { /* ignore */ }
    _unwatch = null;
  }
}

// ── 綁定現有檔案 ──────────────────────────────────────────────────────

export async function configureAndBind(path: string): Promise<XlsxFormatInfo> {
  const db = await getDb();
  const fmt = await parseXlsxFormat(path);

  xlsxPath.value   = path;
  formatInfo.value = fmt;

  await db.execute(
    `INSERT OR REPLACE INTO app_settings (key,value) VALUES ('xlsx_watch_path',?)`, [path]
  );
  await db.execute(
    `INSERT OR REPLACE INTO app_settings (key,value) VALUES ('xlsx_format',?)`,
    [JSON.stringify(fmt)]
  );

  await startWatch(path);
  await importFromXlsx();
  return fmt;
}

// ── 建立全新通訊錄 xlsx 並綁定 ────────────────────────────────────────

export async function createAndBind(path: string): Promise<void> {
  const wb = XLSX.utils.book_new();

  // VS sheet — 全欄位 header 空表
  const vsHeaders = ["姓名","分機","HIS帳號","HIS密碼","PHS帳號","PHS密碼","職稱","科別","備註","updated_at"];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([vsHeaders]), "VS");

  // 常用分機 sheet — 空表
  const ctHeaders = ["名稱","分機","類別","備註","updated_at"];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ctHeaders]), "常用分機");

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  await writeFile(path, buf);

  // 綁定並立即從 DB 匯出資料填入
  await configureAndBind(path);
  await exportToXlsx();
}

// ── 解除綁定 ──────────────────────────────────────────────────────────

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
    try { formatInfo.value = JSON.parse(formatRow.value); } catch { /* ignore */ }
  }
  if (!formatInfo.value) {
    try { formatInfo.value = await parseXlsxFormat(pathRow.value); } catch { return; }
  }
  await startWatch(pathRow.value);
}
