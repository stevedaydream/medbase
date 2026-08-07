<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getDb, closeDb, dbWrite } from "@/db";
import * as XLSX from "xlsx";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeFile, copyFile, readTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCloudSettings } from "@/stores/cloudSettings";
import {
  xlsxPath as xlsxSyncPathRef,
  isSyncing as xlsxSyncingRef,
  syncStatus as xlsxSyncStatusRef,
  formatInfo as xlsxFormatInfoRef,
  configureAndBind,
  createAndBind,
  exportToXlsx,
  importFromXlsx,
  unbind as xlsxUnbind,
  autoCloudSync,
} from "@/composables/useXlsxSync";
import { autoUpdatePassAhk } from "@/composables/usePassAhk";
import { markLocalModified, pushTableToCloud } from "@/composables/useSyncMonitor";

// ── 型別定義 ────────────────────────────────────────────────────
interface Item {
  hospital_code: string; name_en: string | null; name_zh: string | null;
  purpose: string | null; depts: string[]; unit: string | null;
  price: number | null; supplier: string | null; notes: string | null;
}
interface Physician {
  id: number; name: string; department: string | null; title: string | null;
  ext: string | null; his_account: string | null; his_password: string | null;
  phs_account: string | null; phs_password: string | null; notes: string | null;
}
interface Protocol {
  id: number; name: string; triggers: string; immediate_actions: string;
  critical_meds: string; timers: string; contacts: string; notes: string;
}
interface ProtocolForm {
  id?: number; name: string;
  triggers: string[];
  immediate_actions: string[];
  critical_meds: { name: string; dose: string; color: string }[];
  timers: { label: string; seconds: number }[];
  contacts: { label: string; ext: string }[];
  notes: string;
}
type Tab = "items" | "physicians" | "emergency" | "backup";

// ── 狀態 ────────────────────────────────────────────────────────
const activeTab   = ref<Tab>("items");
const search      = ref("");
const route       = useRoute();
const router      = useRouter();

// ── 雙軌同步 UI（橋接 useXlsxSync 單例狀態）────────────────────────
const xlsxSyncPath   = xlsxSyncPathRef;
const xlsxSyncing    = xlsxSyncingRef;
const xlsxSyncStatus = xlsxSyncStatusRef;

const xlsxFormatSummary = computed(() => {
  const fmt = xlsxFormatInfoRef.value;
  if (!fmt) return "";
  const parts: string[] = [];
  if (fmt.vsSheet)      parts.push(`醫師 sheet: "${fmt.vsSheet}"${fmt.isDualColumn ? "（兩欄並排）" : ""}`);
  if (fmt.contactSheet) parts.push(`分機 sheet: "${fmt.contactSheet}"`);
  if (fmt.contactCols.length) parts.push(`分機欄位: ${fmt.contactCols.join(", ")}`);
  return parts.join("　·　");
});

async function bindXlsxFile() {
  const path = await openDialog({
    title: "選擇通訊錄 xlsx 檔案",
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
    multiple: false,
    directory: false,
  }) as string | null;
  if (!path) return;
  await configureAndBind(path);
}

async function createXlsxFile() {
  const path = await saveDialog({
    title: "建立新通訊錄 xlsx",
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
    defaultPath: "通訊錄.xlsx",
  }) as string | null;
  if (!path) return;
  await createAndBind(path);
}

async function doXlsxExport() { await exportToXlsx(); }
async function doXlsxImport() { await importFromXlsx(); }
async function doXlsxUnbind() { await xlsxUnbind(); }

// 資料
const items       = ref<Item[]>([]);
const physicians  = ref<Physician[]>([]);
const protocols   = ref<Protocol[]>([]);

// Emergency editing state
const selectedProtocolId  = ref<number | null>(null);
const protocolEditorOpen  = ref(false);
const protocolForm = ref<ProtocolForm>({
  name: "", triggers: [], immediate_actions: [],
  critical_meds: [], timers: [], contacts: [], notes: ""
});

// Modal
const showModal   = ref(false);
const modalMode   = ref<"add" | "edit">("add");
const deleteTarget = ref<Item | Physician | null>(null);
const showConfirm  = ref(false);

// 表單暫存
const itemForm   = ref<Partial<Item>>({});
const physForm      = ref<Partial<Physician>>({});
const editingPhysId = ref<number | null>(null);
const editBuf       = ref<Partial<Physician>>({});

function startEditPhys(p: Physician) {
  editingPhysId.value = p.id;
  editBuf.value = { ...p };
}
function cancelEditPhys() {
  editingPhysId.value = null;
  editBuf.value = {};
}

// ── 批次新增品項 ─────────────────────────────────────────────────
interface BatchItemRow {
  hospital_code: string; name_zh: string; purpose: string;
  deptsStr: string; price: string; supplier: string;
}
const showBatchAdd = ref(false);
const batchRows    = ref<BatchItemRow[]>([]);
const batchSaving  = ref(false);

function emptyBatchRow(): BatchItemRow {
  return { hospital_code: "", name_zh: "", purpose: "", deptsStr: "", price: "", supplier: "" };
}
function openBatchAdd() {
  batchRows.value = [emptyBatchRow()];
  showBatchAdd.value = true;
}
function addBatchRow() { batchRows.value.push(emptyBatchRow()); }
function removeBatchRow(i: number) { batchRows.value.splice(i, 1); }
async function saveBatchItems() {
  const valid = batchRows.value.filter(r => r.hospital_code.trim());
  if (!valid.length) return;
  batchSaving.value = true;
  try {
    for (const r of valid) {
      const code = r.hospital_code.trim();
      await dbWrite(
        `INSERT OR IGNORE INTO items (hospital_code,name_zh,purpose,unit,price,supplier,notes) VALUES (?,?,?,?,?,?,?)`,
        [code, r.name_zh||null, r.purpose||null, null,
         r.price !== "" ? Number(r.price) : null, r.supplier||null, null]
      );
      const depts = r.deptsStr.split(";").map(s => s.trim()).filter(Boolean);
      for (const d of depts) {
        await dbWrite("INSERT OR IGNORE INTO item_depts (hospital_code,dept) VALUES (?,?)", [code, d]);
      }
    }
    showBatchAdd.value = false;
    await loadAll();
    showToast("success", `已新增 ${valid.length} 筆品項`);
  } catch (e) { showToast("error", `儲存失敗：${(e as Error).message}`); }
  finally { batchSaving.value = false; }
}

// ── Toast ────────────────────────────────────────────────────────
interface Toast { type: "success" | "error"; msg: string; }
const toast = ref<Toast | null>(null);
function showToast(type: Toast["type"], msg: string) {
  toast.value = { type, msg };
  setTimeout(() => { toast.value = null; }, 3500);
}

// ── 匯入 XLSX ────────────────────────────────────────────────────
interface ImportResult { sheet: string; upserted: number; skipped: number; }
const importing        = ref(false);
const importProgress   = ref(0);
const importResults    = ref<ImportResult[] | null>(null);
const xlsxInput        = ref<HTMLInputElement | null>(null);

function n(v: any): any { return (v === undefined || v === "" || v === null) ? null : v; }
function isNum(v: any): v is number { return typeof v === "number" && isFinite(v); }

async function handleXlsx(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  importing.value = true;
  importProgress.value = 0;
  importResults.value = null;

  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: "array" });
    const results: ImportResult[] = [];

    function rows(sheet: string): Record<string, any>[] {
      const ws = wb.Sheets[sheet];
      return ws ? XLSX.utils.sheet_to_json<Record<string, any>>(ws) : [];
    }

    const sheetNames = ["departments", "doctors", "items", "sets", "set_items", "physicians"];
    const totalRows = sheetNames.reduce((sum, s) => sum + rows(s).length, 0);
    let doneRows = 0;
    function tick(n = 1) {
      doneRows += n;
      importProgress.value = totalRows > 0 ? Math.round((doneRows / totalRows) * 100) : 100;
    }

    // ① departments
    {
      let ok = 0, skip = 0;
      for (const r of rows("departments")) {
        if (!r.name || typeof r.name !== "string" || r.name.startsWith("★")) { skip++; tick(); continue; }
        if (isNum(r.id)) {
          await dbWrite("INSERT OR REPLACE INTO departments (id, name) VALUES (?,?)", [r.id, r.name]);
        } else {
          await dbWrite("INSERT OR IGNORE INTO departments (name) VALUES (?)", [r.name]);
        }
        ok++; tick();
      }
      results.push({ sheet: "科別", upserted: ok, skipped: skip });
    }

    // ② doctors（FK → departments）
    {
      let ok = 0, skip = 0;
      for (const r of rows("doctors")) {
        if (!r.name || typeof r.name !== "string" || r.name.startsWith("★")) { skip++; tick(); continue; }
        if (isNum(r.id)) {
          await dbWrite(
            "INSERT OR REPLACE INTO doctors (id, name, department_id) VALUES (?,?,?)",
            [r.id, r.name, n(r.department_id)]);
        } else {
          await dbWrite(
            "INSERT OR IGNORE INTO doctors (name, department_id) VALUES (?,?)",
            [r.name, n(r.department_id)]);
        }
        ok++; tick();
      }
      results.push({ sheet: "醫師(VS)", upserted: ok, skipped: skip });
    }

    // ③ items
    {
      let ok = 0, skip = 0;
      for (const r of rows("items")) {
        const code = r.hospital_code;
        if (!code || typeof code !== "string" || code.startsWith("★")) { skip++; tick(); continue; }
        await dbWrite(
          `INSERT OR REPLACE INTO items
           (hospital_code,name_en,name_zh,purpose,unit,price,supplier,notes)
           VALUES (?,?,?,?,?,?,?,?)`,
          [code, n(r.name_en), n(r.name_zh), n(r.purpose ?? r.category),
           n(r.unit), n(r.price), n(r.supplier), n(r.notes)]);
        if (r.depts && typeof r.depts === "string") {
          await dbWrite("DELETE FROM item_depts WHERE hospital_code=?", [code]);
          for (const dept of r.depts.split(";").map((d:string)=>d.trim()).filter(Boolean)) {
            await dbWrite(
              "INSERT OR IGNORE INTO item_depts (hospital_code, dept) VALUES (?,?)",
              [code, dept]);
          }
        }
        ok++; tick();
      }
      results.push({ sheet: "自費品項", upserted: ok, skipped: skip });
    }

    // ④ sets（FK → physicians）
    {
      let ok = 0, skip = 0;
      for (const r of rows("sets")) {
        if (!isNum(r.id) || !r.name) { skip++; tick(); continue; }
        await dbWrite(
          `INSERT OR REPLACE INTO sets (id,name,surgery_type,physician_id,department_id,notes)
           VALUES (?,?,?,?,?,?)`,
          [r.id, r.name, n(r.surgery_type), n(r.physician_id ?? r.doctor_id), n(r.department_id), n(r.notes)]);
        ok++; tick();
      }
      results.push({ sheet: "套組", upserted: ok, skipped: skip });
    }

    // ⑤ set_items（FK → sets）
    {
      let ok = 0, skip = 0;
      for (const r of rows("set_items")) {
        if (!isNum(r.id) || !isNum(r.set_id)) { skip++; tick(); continue; }
        await dbWrite(
          `INSERT OR REPLACE INTO set_items
           (id,set_id,hospital_code,quantity,is_optional,sort_order,price,notes)
           VALUES (?,?,?,?,?,?,?,?)`,
          [r.id, r.set_id, n(r.hospital_code),
           n(r.quantity) ?? 1, n(r.is_optional) ?? 0, n(r.sort_order) ?? r.id ?? 0,
           n(r.price), n(r.notes)]);
        ok++; tick();
      }
      results.push({ sheet: "套組品項", upserted: ok, skipped: skip });
    }

    // ⑥ physicians
    {
      let ok = 0, skip = 0;
      for (const r of rows("physicians")) {
        if (!r.name || typeof r.name !== "string" || r.name.startsWith("★")) { skip++; tick(); continue; }
        if (isNum(r.id)) {
          await dbWrite(
            `INSERT OR REPLACE INTO physicians
             (id,name,department,title,ext,his_account,his_password,phs_account,phs_password,notes)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [r.id, r.name, n(r.department), n(r.title), n(r.ext),
             n(r.his_account), n(r.his_password), n(r.phs_account), n(r.phs_password), n(r.notes)]);
        } else {
          await dbWrite(
            `INSERT INTO physicians
             (name,department,title,ext,his_account,his_password,phs_account,phs_password,notes)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [r.name, n(r.department), n(r.title), n(r.ext),
             n(r.his_account), n(r.his_password), n(r.phs_account), n(r.phs_password), n(r.notes)]);
        }
        ok++; tick();
      }
      if (ok || skip) results.push({ sheet: "通訊錄", upserted: ok, skipped: skip });
    }

    importResults.value = results;
    await loadAll();
    showToast("success", "匯入完成！");
  } catch (err: any) {
    showToast("error", `匯入失敗：${err?.message ?? err}`);
  } finally {
    importing.value = false;
    if (xlsxInput.value) xlsxInput.value.value = "";
  }
}

// ── 備份群組定義 ──────────────────────────────────────────────────
interface BackupGroup { key: string; label: string; icon: string; tables: string[]; desc: string }

const BACKUP_GROUPS: BackupGroup[] = [
  { key: "clinical",   label: "臨床資料",   icon: "🩺", tables: ["prescriptions","surgery","disease","examination"], desc: "處方、術式、疾病、檢查" },
  { key: "items",      label: "自費耗材",   icon: "📦", tables: ["items","item_depts","surgery_types","surgery_type_items"], desc: "品項主表、科別對應與手術術式" },
  { key: "sets",       label: "手術套組",   icon: "🗂",  tables: ["sets","set_items"],              desc: "套組與套組品項明細" },
  { key: "physicians", label: "通訊錄", icon: "👤", tables: ["physicians"],                     desc: "醫師帳號、分機、密碼" },
  { key: "scheduler",  label: "排班系統",   icon: "📅", tables: ["scheduler_users","app_settings"],desc: "排班使用者與班表設定" },
  { key: "emergency",  label: "危急情境",   icon: "🚨", tables: ["emergency_protocols"],            desc: "ACLS / 急救流程卡" },
  { key: "contacts",   label: "常用分機",   icon: "📞", tables: ["contacts"],                       desc: "常用電話分機" },
  { key: "acp",        label: "ACP 評估",   icon: "📋", tables: ["acp_sets","acp_items","acp_records"], desc: "預立醫療評估集與記錄" },
  { key: "ahk",        label: "AHK 腳本",   icon: "⌨",  tables: ["ahk_scripts","ahk_groups","ahk_group_scripts"], desc: "AHK 腳本元資料與套組" },
];

// FK 相依順序（匯入時依此順序執行）
const FK_ORDER = [
  "physicians","prescriptions","surgery","disease","examination",
  "items","item_depts","surgery_types","surgery_type_items","sets","set_items",
  "scheduler_users","emergency_protocols","contacts",
  "acp_sets","acp_items","acp_records",
  "ahk_scripts","ahk_groups","ahk_group_scripts",
  "app_settings",
];

const TABLE_LABELS: Record<string, string> = {
  prescriptions:"處方", surgery:"術式", disease:"疾病", examination:"檢查",
  items:"自費品項", item_depts:"品項科別", surgery_types:"手術術式", surgery_type_items:"術式品項",
  sets:"套組", set_items:"套組品項",
  physicians:"通訊錄",
  scheduler_users:"排班使用者", app_settings:"程式設定",
  emergency_protocols:"危急情境",
  contacts:"常用分機",
  acp_sets:"ACP評估集", acp_items:"ACP項目", acp_records:"ACP記錄",
  ahk_scripts:"AHK腳本", ahk_groups:"AHK套組", ahk_group_scripts:"AHK套組腳本",
};

// ── 備份 sidebar：從 DB 取得各表欄位與筆數 ───────────────────────
interface DbTableMeta { columns: string[]; count: number }
const tableMetaMap = ref<Record<string, DbTableMeta>>({});

async function loadTableMeta() {
  const db = await getDb();
  const tables = await db.select<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  const result: Record<string, DbTableMeta> = {};
  await Promise.all(tables.map(async ({ name }) => {
    try {
      const [cols, cnt] = await Promise.all([
        db.select<{ name: string }[]>(`PRAGMA table_info("${name}")`),
        db.select<{ c: number }[]>(`SELECT COUNT(*) AS c FROM "${name}"`),
      ]);
      result[name] = { columns: cols.map(c => c.name), count: cnt[0]?.c ?? 0 };
    } catch { result[name] = { columns: [], count: 0 }; }
  }));
  tableMetaMap.value = result;
}

function groupCount(g: BackupGroup): number {
  return g.tables.reduce((sum, t) => sum + (tableMetaMap.value[t]?.count ?? 0), 0);
}

const selectedGroups = ref<Set<string>>(new Set(BACKUP_GROUPS.map(g => g.key)));
function toggleGroup(key: string) {
  const s = new Set(selectedGroups.value);
  s.has(key) ? s.delete(key) : s.add(key);
  selectedGroups.value = s;
}
function selectAll()  { selectedGroups.value = new Set(BACKUP_GROUPS.map(g => g.key)); }
function selectNone() { selectedGroups.value = new Set(); }

function getSelectedTables(): string[] {
  const sel = new Set<string>();
  for (const g of BACKUP_GROUPS) {
    if (selectedGroups.value.has(g.key)) g.tables.forEach(t => sel.add(t));
  }
  return FK_ORDER.filter(t => sel.has(t));
}

// ── 清空本地資料庫 ────────────────────────────────────────────────
const showClearConfirm = ref(false);
const clearInput = ref("");
const clearing = ref(false);
const CLEAR_KEYWORD = "清空資料";

// 清空用獨立勾選（預設全不勾，避免誤操作）
const clearGroups = ref<Set<string>>(new Set());
function toggleClearGroup(key: string) {
  const s = new Set(clearGroups.value);
  s.has(key) ? s.delete(key) : s.add(key);
  clearGroups.value = s;
}

// FK 反向刪除順序
const FK_DELETE_ORDER = [
  "ahk_group_scripts","ahk_scripts","ahk_groups",
  "acp_records","acp_items","acp_sets",
  "contacts","emergency_protocols",
  "surgery_type_items","surgery_types","set_items","sets","item_depts","items",
  "physicians","scheduler_users",
  "prescriptions","surgery","disease","examination",
  "app_settings",
];

async function clearLocalDb() {
  const selectedTables = new Set<string>();
  for (const g of BACKUP_GROUPS) {
    if (clearGroups.value.has(g.key)) g.tables.forEach(t => selectedTables.add(t));
  }
  if (selectedTables.size === 0) return;

  clearing.value = true;
  const errors: string[] = [];
  try {
    // 關閉 FK 約束，避免 FK 阻擋刪除
    await dbWrite("PRAGMA foreign_keys = OFF");
    try {
      // 清除醫師前，先將 sets.physician_id 懸空引用歸零
      if (selectedTables.has("physicians") && !selectedTables.has("sets")) {
        await dbWrite("UPDATE sets SET physician_id = NULL");
      }
      for (const t of FK_DELETE_ORDER) {
        if (!selectedTables.has(t)) continue;
        try {
          await dbWrite(`DELETE FROM ${t}`);
        } catch (e: any) {
          errors.push(`${t}: ${e?.message ?? e}`);
        }
      }
    } finally {
      await dbWrite("PRAGMA foreign_keys = OFF"); // 保持關閉（本 app 不啟用 FK）
    }
    const groupCount = selectedTables.size;
    await loadAll();
    showClearConfirm.value = false;
    clearInput.value = "";
    clearGroups.value = new Set();
    if (errors.length) {
      showToast("error", `部分清空失敗：${errors.join("; ")}`);
    } else {
      showToast("success", `已清空 ${groupCount} 個群組的資料`);
    }
  } catch (err: any) {
    showToast("error", `清空失敗：${err?.message ?? err}`);
  } finally {
    clearing.value = false;
  }
}

// ── 匯出（選擇性） ────────────────────────────────────────────────
const exportingFull = ref(false);
async function exportSelected() {
  exportingFull.value = true;
  try {
    const db = await getDb();
    const tables = getSelectedTables();
    const wb = XLSX.utils.book_new();
    let exported = 0;
    for (const table of tables) {
      try {
        const meta = tableMetaMap.value[table];
        const cols = meta?.columns.length
          ? meta.columns
          : (await db.select<{ name: string }[]>(`PRAGMA table_info("${table}")`)).map(c => c.name);
        const data = await db.select<any[]>(`SELECT * FROM "${table}"`);
        if (!data.length) continue;
        const rows = data.map(row => cols.map(c => row[c] ?? null));
        const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
        XLSX.utils.book_append_sheet(wb, ws, table);
        exported++;
      } catch (e) { console.warn(`Export ${table} failed:`, e); }
    }
    if (exported === 0) { showToast("error", "選取的項目均無資料，未產生檔案"); return; }
    const date = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const path = await saveDialog({
      defaultPath: `medbase_backup_${date}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path) return;
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    await writeFile(path, buf);
    showToast("success", `備份完成！共 ${exported} 個資料表`);
  } catch (err: any) {
    showToast("error", `備份失敗：${err?.message ?? err}`);
  } finally {
    exportingFull.value = false;
  }
}

// ── 範本下載 ──────────────────────────────────────────────────────
const downloadingTemplate = ref(false);
async function downloadTemplate() {
  downloadingTemplate.value = true;
  try {
    const db = await getDb();
    const wb = XLSX.utils.book_new();
    for (const table of FK_ORDER) {
      try {
        const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
        if (!cols.length) continue;
        const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c.name)]);
        XLSX.utils.book_append_sheet(wb, ws, table);
      } catch (e) { console.warn(`Template ${table} failed:`, e); }
    }
    const path = await saveDialog({
      defaultPath: "medbase_template.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path) return;
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    await writeFile(path, buf);
    showToast("success", "範本已下載！每個 sheet 為一個資料表，填入後可直接匯入。");
  } catch (err: any) {
    showToast("error", `下載失敗：${err?.message ?? err}`);
  } finally {
    downloadingTemplate.value = false;
  }
}

// ── 備份 / 還原 app_settings ─────────────────────────────────────
const exportingSettings = ref(false);
const importingSettings = ref(false);

async function exportSettings() {
  exportingSettings.value = true;
  try {
    const db   = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM app_settings");
    const json = JSON.stringify(rows, null, 2);
    const date = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const path = await saveDialog({
      defaultPath: `medbase_settings_${date}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    await writeFile(path, new TextEncoder().encode(json));
    showToast("success", "設定備份完成！");
  } catch (err: any) {
    showToast("error", `備份失敗：${err?.message ?? err}`);
  } finally {
    exportingSettings.value = false;
  }
}

async function handleSettingsImport() {
  const path = await openDialog({
    title: "選擇設定備份檔案",
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });
  if (!path) return;
  if (!confirm("確定還原設定？將覆蓋現有的所有程式設定（不影響臨床資料）。")) return;
  importingSettings.value = true;
  try {
    const text = await readTextFile(path as string);
    const rows: { key: string; value: string }[] = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error("格式錯誤：預期為陣列");
    for (const r of rows) {
      if (typeof r.key !== "string" || typeof r.value !== "string") continue;
      await dbWrite("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [r.key, r.value]);
    }
    await useCloudSettings().reload();
    showToast("success", `設定還原完成，共匯入 ${rows.length} 筆。`);
  } catch (err: any) {
    showToast("error", `還原失敗：${err?.message ?? err}`);
  } finally {
    importingSettings.value = false;
  }
}

// ── 匯入完整資料庫（含預覽確認） ──────────────────────────────────
const importingFull     = ref(false);
const fullImportProgress = ref(0);
const fullImportInput   = ref<HTMLInputElement | null>(null);

interface ImportPreviewRow { table: string; label: string; rows: number }
const importPreview = ref<ImportPreviewRow[] | null>(null);
const pendingImportData = ref<{ table: string; data: any[] }[] | null>(null);

async function handleFullImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (fullImportInput.value) fullImportInput.value.value = "";

  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: "array" });

    // 解析預覽（依 FK 順序）
    const preview: ImportPreviewRow[] = [];
    const pending: { table: string; data: any[] }[] = [];

    for (const table of FK_ORDER) {
      const ws = wb.Sheets[table];
      if (!ws) continue;
      const data = XLSX.utils.sheet_to_json<any>(ws);
      preview.push({ table, label: TABLE_LABELS[table] ?? table, rows: data.length });
      if (data.length > 0) pending.push({ table, data });
    }

    // 也收錄不在 FK_ORDER 的自訂 sheet（向下相容）
    for (const sheetName of wb.SheetNames) {
      if (FK_ORDER.includes(sheetName)) continue;
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<any>(ws);
      if (data.length > 0) {
        preview.push({ table: sheetName, label: sheetName, rows: data.length });
        pending.push({ table: sheetName, data });
      }
    }

    if (preview.length === 0) { showToast("error", "檔案中找不到可識別的資料表"); return; }

    importPreview.value = preview;
    pendingImportData.value = pending;
  } catch (err: any) {
    showToast("error", `讀取失敗：${err?.message ?? err}`);
  }
}

async function confirmFullImport() {
  if (!pendingImportData.value) return;
  importingFull.value = true;
  fullImportProgress.value = 0;
  try {
    let total = 0;
    const grandTotal = pendingImportData.value.reduce((s, { data }) => s + data.length, 0);
    for (const { table, data } of pendingImportData.value) {
      const columns = Object.keys(data[0]);
      const ph = columns.map(() => "?").join(",");
      const cols = columns.join(",");
      for (const row of data) {
        const vals = columns.map(c => {
          const v = row[c];
          return (v === "" || v === undefined) ? null : v;
        });
        await dbWrite(`INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${ph})`, vals);
        total++;
        fullImportProgress.value = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 100;
      }
    }
    await loadAll();
    await useCloudSettings().reload();
    showToast("success", `匯入完成！共更新 ${total} 筆資料。`);
    importPreview.value = null;
    pendingImportData.value = null;
  } catch (err: any) {
    showToast("error", `匯入失敗：${err?.message ?? err}`);
  } finally {
    importingFull.value = false;
  }
}

function cancelImport() {
  importPreview.value = null;
  pendingImportData.value = null;
}

// ── 整體 DB 備份 / 還原 ───────────────────────────────────────────
const dbBackingUp  = ref(false);
const dbRestoring  = ref(false);

async function backupDb() {
  dbBackingUp.value = true;
  try {
    const dbPath = await join(await appDataDir(), "medbase.db");
    const date   = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const dest   = await saveDialog({
      defaultPath: `medbase_${date}.db`,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (!dest) return;
    await copyFile(dbPath, dest);
    showToast("success", "資料庫備份完成！");
  } catch (err: any) {
    showToast("error", `備份失敗：${err?.message ?? err}`);
  } finally {
    dbBackingUp.value = false;
  }
}

async function restoreDb() {
  const src = await openDialog({
    filters: [{ name: "SQLite Database", extensions: ["db"] }],
    multiple: false,
  });
  if (!src || typeof src !== "string") return;
  if (!confirm("確定還原資料庫？這會覆蓋所有現有資料，App 將自動重新啟動。")) return;
  dbRestoring.value = true;
  try {
    const dbPath = await join(await appDataDir(), "medbase.db");
    await closeDb();
    await copyFile(src, dbPath);
    await relaunch();
  } catch (err: any) {
    showToast("error", `還原失敗：${err?.message ?? err}`);
    dbRestoring.value = false;
  }
}

// ── 載入資料 ─────────────────────────────────────────────────────
async function loadAll() {
  const db = await getDb();
  const rawItems = await db.select<Omit<Item,"depts">[]>("SELECT * FROM items ORDER BY name_zh");
  const deptRows = await db.select<{hospital_code:string;dept:string}[]>("SELECT hospital_code, dept FROM item_depts");
  const deptMap  = new Map<string,string[]>();
  for (const r of deptRows) {
    if (!deptMap.has(r.hospital_code)) deptMap.set(r.hospital_code, []);
    deptMap.get(r.hospital_code)!.push(r.dept);
  }
  items.value = rawItems.map(it => ({ ...it, depts: deptMap.get(it.hospital_code) ?? [] }));
  physicians.value = await db.select<Physician[]>("SELECT * FROM physicians ORDER BY department, name");
  protocols.value  = await db.select<Protocol[]>("SELECT * FROM emergency_protocols ORDER BY name");

  // ── 跳轉編輯處理 ──────────────────────────
  if (route.query.tab) {
    activeTab.value = route.query.tab as Tab;
    if (route.query.editId && route.query.tab === "physicians") {
      const pId = parseInt(route.query.editId as string);
      const found = physicians.value.find(p => p.id === pId);
      if (found) {
        openEdit(found);
        // 清除 query 參數以防重新加載時重複彈窗
        router.replace({ path: "/data" });
      }
    }
  }
}
onMounted(loadAll);

// 切 tab 時重置搜尋；切到 backup 時載入表格元資料
watch(activeTab, (tab) => {
  search.value = "";
  selectedProtocolId.value = null;
  protocolEditorOpen.value = false;
  if (tab === "backup") loadTableMeta();
});

// ── 搜尋過濾 ─────────────────────────────────────────────────────
const filteredItems = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return items.value;
  return items.value.filter(m =>
    m.name_zh?.toLowerCase().includes(q) || m.name_en?.toLowerCase().includes(q) ||
    m.hospital_code?.toLowerCase().includes(q) || m.purpose?.toLowerCase().includes(q) ||
    m.supplier?.toLowerCase().includes(q) || m.depts.some(d => d.toLowerCase().includes(q)));
});
const filteredPhysicians = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return physicians.value;
  return physicians.value.filter(p =>
    p.name?.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q) ||
    p.ext?.includes(q) || p.title?.toLowerCase().includes(q));
});
const filteredProtocols = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return protocols.value;
  return protocols.value.filter(p => p.name.toLowerCase().includes(q));
});

// ── Emergency Protocol CRUD ──────────────────────────────────────
function selectProtocol(p: Protocol) {
  selectedProtocolId.value = p.id;
  protocolEditorOpen.value = true;
  protocolForm.value = {
    id: p.id, name: p.name,
    triggers:          JSON.parse(p.triggers          || "[]"),
    immediate_actions: JSON.parse(p.immediate_actions || "[]"),
    critical_meds:     JSON.parse(p.critical_meds     || "[]"),
    timers:            JSON.parse(p.timers            || "[]"),
    contacts:          JSON.parse(p.contacts          || "[]"),
    notes: p.notes || "",
  };
}
function newProtocol() {
  selectedProtocolId.value = null;
  protocolEditorOpen.value = true;
  protocolForm.value = { name: "", triggers: [], immediate_actions: [], critical_meds: [], timers: [], contacts: [], notes: "" };
}
async function saveProtocol() {
  const f = protocolForm.value;
  if (!f.name?.trim()) return;
  const vals = [
    f.name,
    JSON.stringify(f.triggers),
    JSON.stringify(f.immediate_actions),
    JSON.stringify(f.critical_meds),
    JSON.stringify(f.timers),
    JSON.stringify(f.contacts),
    f.notes || "",
  ];
  if (f.id) {
    await dbWrite(
      `UPDATE emergency_protocols SET name=?,triggers=?,immediate_actions=?,critical_meds=?,timers=?,contacts=?,notes=? WHERE id=?`,
      [...vals, f.id]);
  } else {
    const res = await dbWrite(
      `INSERT INTO emergency_protocols (name,triggers,immediate_actions,critical_meds,timers,contacts,notes) VALUES (?,?,?,?,?,?,?)`, vals);
    protocolForm.value.id = res.lastInsertId as number;
    selectedProtocolId.value = protocolForm.value.id;
  }
  await loadAll();
  showToast("success", "已儲存！");
}
async function deleteProtocol() {
  if (!protocolForm.value.id) return;
  deleteTarget.value = { id: protocolForm.value.id } as any;
  showConfirm.value = true;
}
async function doDeleteProtocol() {
  await dbWrite("DELETE FROM emergency_protocols WHERE id=?", [protocolForm.value.id]);
  selectedProtocolId.value = null;
  protocolEditorOpen.value = false;
  protocolForm.value = { name: "", triggers: [], immediate_actions: [], critical_meds: [], timers: [], contacts: [], notes: "" };
  await loadAll();
  showConfirm.value = false;
  deleteTarget.value = null;
}

// ── Modal 開關 ───────────────────────────────────────────────────
function openAdd() {
  if (activeTab.value === "emergency") { newProtocol(); return; }
  modalMode.value = "add";
  if (activeTab.value === "items")       itemForm.value = {};
  if (activeTab.value === "physicians")  physForm.value = {};
  showModal.value = true;
}
function openEdit(row: any) {
  modalMode.value = "edit";
  if (activeTab.value === "items")       itemForm.value = { ...row };
  if (activeTab.value === "physicians")  physForm.value = { ...row };
  showModal.value = true;
}
function closeModal() { showModal.value = false; }

// ── CRUD：items ──────────────────────────────────────────────────
async function saveItem() {
  const f  = itemForm.value;
  if (!f.hospital_code?.trim()) return;
  if (modalMode.value === "add") {
    await dbWrite(
      `INSERT OR IGNORE INTO items (hospital_code,name_en,name_zh,purpose,unit,price,supplier,notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [f.hospital_code, f.name_en||null, f.name_zh||null, f.purpose||null,
       f.unit||null, f.price??null, f.supplier||null, f.notes||null]);
  } else {
    await dbWrite(
      `UPDATE items SET name_en=?,name_zh=?,purpose=?,unit=?,price=?,supplier=?,notes=?
       WHERE hospital_code=?`,
      [f.name_en||null, f.name_zh||null, f.purpose||null,
       f.unit||null, f.price??null, f.supplier||null, f.notes||null, f.hospital_code]);
  }
  // 同步 item_depts
  const depts: string[] = (f as any).depts ?? [];
  await dbWrite("DELETE FROM item_depts WHERE hospital_code=?", [f.hospital_code]);
  for (const dept of depts) {
    await dbWrite("INSERT OR IGNORE INTO item_depts (hospital_code,dept) VALUES (?,?)", [f.hospital_code, dept]);
  }
  closeModal(); await loadAll();
  await markLocalModified("items");
  const gasUrl = useCloudSettings().gasUrl;
  if (gasUrl) {
    const db2 = await getDb();
    const allItems = await db2.select("SELECT * FROM items");
    pushTableToCloud("items", gasUrl, { action: "saveItems", data: allItems }, (allItems as any[]).length).catch(() => {});
  }
}
async function deleteItem(row: Item) {
  await dbWrite("DELETE FROM items WHERE hospital_code=?", [row.hospital_code]);
  await loadAll();
}

// ── CRUD：physicians ─────────────────────────────────────────────
async function savePhysician() {
  const f  = physForm.value;
  if (!f.name?.trim()) return;
  if (modalMode.value === "add") {
    await dbWrite(
      `INSERT INTO physicians (name,department,title,ext,his_account,his_password,phs_account,phs_password,notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [f.name, f.department||null, f.title||null, f.ext||null,
       f.his_account||null, f.his_password||null,
       f.phs_account||null, f.phs_password||null, f.notes||null]);
  } else {
    await dbWrite(
      `UPDATE physicians SET name=?,department=?,title=?,ext=?,his_account=?,his_password=?,
       phs_account=?,phs_password=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?`,
      [f.name, f.department||null, f.title||null, f.ext||null,
       f.his_account||null, f.his_password||null,
       f.phs_account||null, f.phs_password||null, f.notes||null, f.id]);
  }
  closeModal();
  await loadAll();
  const syncMsg = await autoUpdatePassAhk();
  if (syncMsg) showToast("success", syncMsg);
  if (xlsxSyncPathRef.value) { exportToXlsx(); autoCloudSync(); }
  await markLocalModified("physicians");
  const gasUrlP = useCloudSettings().gasUrl;
  if (gasUrlP) {
    const db2 = await getDb();
    const allPhys = await db2.select("SELECT * FROM physicians");
    pushTableToCloud("physicians", gasUrlP, { action: "savePhysicians", data: allPhys }, (allPhys as any[]).length).catch(() => {});
  }
}
async function saveInlinePhys() {
  const f  = editBuf.value;
  await dbWrite(
    `UPDATE physicians SET name=?,department=?,title=?,ext=?,his_account=?,his_password=?,
     phs_account=?,phs_password=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?`,
    [f.name, f.department||null, f.title||null, f.ext||null,
     f.his_account||null, f.his_password||null,
     f.phs_account||null, f.phs_password||null, f.notes||null, f.id]);
  editingPhysId.value = null;
  editBuf.value = {};
  await loadAll();
  const syncMsg = await autoUpdatePassAhk();
  if (syncMsg) showToast("success", syncMsg);
  if (xlsxSyncPathRef.value) { exportToXlsx(); autoCloudSync(); }
  await markLocalModified("physicians");
  const gasUrlP = useCloudSettings().gasUrl;
  if (gasUrlP) {
    const db2 = await getDb();
    const allPhys = await db2.select("SELECT * FROM physicians");
    pushTableToCloud("physicians", gasUrlP, { action: "savePhysicians", data: allPhys }, (allPhys as any[]).length).catch(() => {});
  }
}

async function deletePhysician(row: Physician) {
  await dbWrite("DELETE FROM physicians WHERE id=?", [row.id]);
  await loadAll();
}

// ── 確認刪除 ─────────────────────────────────────────────────────
function confirmDelete(row: Item | Physician) { deleteTarget.value = row; showConfirm.value = true; }
async function doDelete() {
  const row = deleteTarget.value;
  if (!row) return;
  if (activeTab.value === "items")      await deleteItem(row as Item);
  if (activeTab.value === "physicians") await deletePhysician(row as Physician);
  if (activeTab.value === "emergency")  { await doDeleteProtocol(); return; }
  showConfirm.value = false; deleteTarget.value = null;
}

const tabs: { key: Tab; icon: string; label: string; count: () => number }[] = [
  { key: "items",      icon: "📦", label: "自費品項",   count: () => items.value.length },
  { key: "physicians", icon: "👤", label: "通訊錄", count: () => physicians.value.length },
  { key: "emergency",  icon: "🚨", label: "危急情境",   count: () => protocols.value.length },
  { key: "backup",     icon: "💾", label: "備份 / 還原", count: () => 0 },
];
</script>

<template>
  <div class="flex h-full gap-0 overflow-hidden bg-slate-950/20 text-slate-100 select-none">

    <!-- ── 左側 Tab 列 ──────────────────────────────── -->
    <div class="flex flex-col w-48 shrink-0 border-r border-white/5 bg-slate-900/40 backdrop-blur-md py-4 gap-1 px-3">
      <div class="px-3 pb-3 mb-2 border-b border-white/5">
        <span class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono">資料庫管理</span>
      </div>
      <button
        v-for="tab in tabs" :key="tab.key"
        @click="activeTab = tab.key"
        class="flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left cursor-pointer"
        :class="activeTab === tab.key
          ? 'bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.08)]'
          : 'text-slate-400 hover:bg-white/[0.02] border border-transparent hover:text-slate-200'"
      >
        <span class="flex items-center gap-2">
          <span class="text-base leading-none opacity-85">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </span>
        <span v-if="tab.count() > 0" class="text-2xs font-mono font-bold bg-white/5 border border-white/5 text-slate-500 px-1.5 py-0.5 rounded-md">{{ tab.count() }}</span>
      </button>
    </div>

    <!-- ── 右側內容 ─────────────────────────────────── -->
    <div class="flex flex-col flex-1 overflow-hidden bg-slate-900/10">

      <!-- Header -->
      <div v-if="activeTab !== 'backup'" class="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-slate-900/20 backdrop-blur-sm shrink-0">
        <div class="relative flex-1">
          <input
            v-model="search"
            :placeholder="`搜尋${tabs.find(t=>t.key===activeTab)?.label}…`"
            class="w-full px-4 py-2 bg-slate-950 border border-white/10 text-slate-200 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 placeholder-slate-600 text-xs font-medium rounded-xl transition-all outline-none"
          />
          <span v-if="search" @click="search = ''" class="absolute right-3 top-2.5 text-xs text-slate-500 hover:text-slate-300 cursor-pointer">✕</span>
        </div>
        <!-- 匯入 XLSX -->
        <label v-if="activeTab !== 'emergency'"
          class="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer overflow-hidden border border-white/5 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          :class="importing ? 'cursor-wait opacity-80' : ''"
        >
          <div v-if="importing"
            class="absolute inset-0 bg-indigo-500/20 transition-all duration-200"
            :style="{ width: importProgress + '%' }"
          ></div>
          <span class="relative text-sm leading-none">{{ importing ? "⏳" : "📥" }}</span>
          <span class="relative">{{ importing ? `匯入中… ${importProgress}%` : "匯入 XLSX" }}</span>
          <input ref="xlsxInput" type="file" accept=".xlsx,.xls" class="hidden"
            :disabled="importing" @change="handleXlsx" />
        </label>
        <button v-if="activeTab === 'items'"
          @click="openBatchAdd"
          class="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/5 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white text-xs font-bold transition-all shrink-0 cursor-pointer"
        >
          批次新增
        </button>
        <button
          @click="openAdd"
          class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 border border-indigo-500/30 text-white hover:bg-indigo-500 text-xs font-bold transition-all shrink-0 cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.15)]"
        >
          <span>＋</span> 新增
        </button>
      </div>

      <!-- 匯入結果摘要 -->
      <Transition name="slide-down">
        <div v-if="importResults"
          class="flex items-center gap-4 px-6 py-2.5 bg-indigo-500/5 border-b border-indigo-500/10 shrink-0 text-xs">
          <span class="text-indigo-400 font-bold font-mono uppercase tracking-wider text-2xs">匯入結果</span>
          <span v-for="r in importResults" :key="r.sheet"
            class="flex items-center gap-1 text-slate-300 font-medium">
            <span class="text-emerald-400 font-mono font-bold">+{{ r.upserted }}</span>
            <span class="text-slate-400">{{ r.sheet }}</span>
            <span v-if="r.skipped" class="text-slate-600">（略過 {{ r.skipped }}）</span>
            <span class="text-slate-700 last:hidden">·</span>
          </span>
          <button @click="importResults = null" class="ml-auto text-slate-500 hover:text-slate-300 cursor-pointer">✕</button>
        </div>
      </Transition>

      <!-- ── 自費品項 表格 ─────────────────────────── -->
      <div v-if="activeTab === 'items'" class="flex-1 overflow-auto px-6 py-4">
        <div class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-white/10 bg-slate-900/50 text-slate-400 text-2xs font-bold tracking-wider uppercase font-mono">
                <th class="px-4 py-3">院內碼</th>
                <th class="px-4 py-3">中文品名</th>
                <th class="px-4 py-3">用途</th>
                <th class="px-4 py-3">適用科別</th>
                <th class="px-4 py-3 text-right">價格</th>
                <th class="px-4 py-3">廠商</th>
                <th class="w-24 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.03]">
              <tr v-if="filteredItems.length === 0">
                <td colspan="7" class="text-center text-slate-500 py-12 italic text-xs">無匹配的自費品項資料</td>
              </tr>
              <tr v-for="m in filteredItems" :key="m.hospital_code"
                class="hover:bg-white/[0.015] transition-all group">
                <td class="px-4 py-2.5 text-slate-400 font-mono text-xs font-semibold">{{ m.hospital_code }}</td>
                <td class="px-4 py-2.5 text-slate-200 text-xs font-bold">{{ m.name_zh || m.name_en || "—" }}</td>
                <td class="px-4 py-2.5 text-xs">
                  <span v-if="m.purpose" class="bg-teal-500/10 border border-teal-500/20 text-teal-400 px-2 py-0.5 rounded-lg text-2xs font-bold font-mono">{{ m.purpose }}</span>
                  <span v-else class="text-slate-600">—</span>
                </td>
                <td class="px-4 py-2.5 text-xs">
                  <div class="flex flex-wrap gap-1">
                    <span v-for="d in m.depts" :key="d" class="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-lg text-2xs font-bold">{{ d }}</span>
                    <span v-if="!m.depts.length" class="text-slate-600">—</span>
                  </div>
                </td>
                <td class="px-4 py-2.5 text-right text-emerald-400 font-mono text-xs font-black">
                  {{ m.price ? `$${m.price.toLocaleString()}` : "—" }}</td>
                <td class="px-4 py-2.5 text-slate-500 text-xs font-medium">{{ m.supplier || "—" }}</td>
                <td class="px-4 py-2.5 text-right">
                  <div class="flex gap-2.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button @click="openEdit(m)" class="text-xs text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer">編輯</button>
                    <button @click="confirmDelete(m)" class="text-xs text-rose-400 hover:text-rose-300 font-bold cursor-pointer">刪除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── 通訊錄 表格 ───────────────────────── -->
      <div v-if="activeTab === 'physicians'" class="flex-1 overflow-auto px-6 py-4">
        <div class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-white/10 bg-slate-900/50 text-slate-400 text-2xs font-bold tracking-wider uppercase font-mono">
                <th class="px-4 py-3">姓名</th>
                <th class="px-4 py-3">科別</th>
                <th class="px-4 py-3">職稱</th>
                <th class="px-4 py-3">分機</th>
                <th class="px-4 py-3">HIS 帳號</th>
                <th class="px-4 py-3">HIS 密碼</th>
                <th class="w-24 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.03]">
              <tr v-if="filteredPhysicians.length === 0">
                <td colspan="7" class="text-center text-slate-500 py-12 italic text-xs">無匹配的醫師通訊錄資料</td>
              </tr>
              <tr v-for="p in filteredPhysicians" :key="p.id"
                class="transition-all group"
                :class="editingPhysId === p.id ? 'bg-indigo-500/5' : 'hover:bg-white/[0.015]'">

                <!-- 姓名 -->
                <td class="px-4 py-2.5">
                  <input v-if="editingPhysId === p.id" v-model="editBuf.name"
                    class="w-full min-w-[5rem] px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs font-bold text-slate-200 outline-none focus:border-indigo-500/50" />
                  <span v-else class="text-slate-200 font-bold text-xs">{{ p.name }}</span>
                </td>

                <!-- 科別 -->
                <td class="px-4 py-2.5">
                  <input v-if="editingPhysId === p.id" v-model="editBuf.department"
                    class="w-full min-w-[4rem] px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs text-slate-300 outline-none focus:border-indigo-500/50" />
                  <span v-else class="text-slate-400 text-xs font-semibold">{{ p.department || "—" }}</span>
                </td>

                <!-- 職稱 -->
                <td class="px-4 py-2.5">
                  <input v-if="editingPhysId === p.id" v-model="editBuf.title"
                    class="w-full min-w-[4rem] px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs text-slate-400 outline-none focus:border-indigo-500/50" />
                  <span v-else class="text-slate-500 text-xs font-medium">{{ p.title || "—" }}</span>
                </td>

                <!-- 分機 -->
                <td class="px-4 py-2.5">
                  <input v-if="editingPhysId === p.id" v-model="editBuf.ext"
                    class="w-20 px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50" />
                  <span v-else class="text-indigo-400 font-mono text-xs font-black">{{ p.ext || "—" }}</span>
                </td>

                <!-- HIS 帳號 -->
                <td class="px-4 py-2.5">
                  <input v-if="editingPhysId === p.id" v-model="editBuf.his_account"
                    class="w-24 px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs font-mono text-slate-300 outline-none focus:border-indigo-500/50" />
                  <span v-else class="text-slate-400 font-mono text-xs font-medium">{{ p.his_account || "—" }}</span>
                </td>

                <!-- HIS 密碼 -->
                <td class="px-4 py-2.5">
                  <input v-if="editingPhysId === p.id" v-model="editBuf.his_password"
                    class="w-24 px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs font-mono text-slate-300 outline-none focus:border-indigo-500/50" />
                  <span v-else class="text-slate-500 font-mono text-xs font-medium">{{ p.his_password || "—" }}</span>
                </td>

                <!-- 操作 -->
                <td class="px-4 py-2.5 text-right">
                  <div class="flex gap-2.5 justify-end whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                    <template v-if="editingPhysId === p.id">
                      <button @click="saveInlinePhys" class="text-xs text-emerald-400 hover:text-emerald-300 font-bold cursor-pointer">儲存</button>
                      <button @click="cancelEditPhys" class="text-xs text-slate-500 hover:text-slate-300 cursor-pointer">取消</button>
                    </template>
                    <template v-else>
                      <button @click="startEditPhys(p)" class="text-xs text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer">編輯</button>
                      <button @click="confirmDelete(p)" class="text-xs text-rose-400 hover:text-rose-300 font-bold cursor-pointer">刪除</button>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── 危急情境 ──────────────────────────────── -->
      <div v-if="activeTab === 'emergency'" class="flex-1 flex overflow-hidden">

        <!-- Protocol list sidebar -->
        <div class="w-56 shrink-0 border-r border-white/5 bg-slate-950/20 overflow-y-auto flex flex-col">
          <div
            v-for="p in filteredProtocols" :key="p.id"
            @click="selectProtocol(p)"
            class="px-5 py-3.5 cursor-pointer border-b border-white/[0.02] transition-all text-left"
            :class="selectedProtocolId === p.id
              ? 'bg-rose-500/10 text-rose-300 border-l-2 border-l-rose-500 shadow-[0_0_15px_rgba(239,68,68,0.08)]'
              : 'text-slate-400 hover:bg-white/[0.01] hover:text-slate-200'"
          >
            <div class="font-bold text-xs">{{ p.name }}</div>
          </div>
          <div v-if="!filteredProtocols.length" class="text-center text-slate-600 py-12 italic text-xs">
            無危急情境資料
          </div>
        </div>

        <!-- Editor panel -->
        <div v-if="protocolEditorOpen" class="flex-1 overflow-y-auto bg-slate-900/10">
          <div class="px-8 py-6 space-y-6 max-w-4xl">

            <!-- Name + actions -->
            <div class="flex items-center gap-3 bg-slate-900/50 backdrop-blur-md p-4 rounded-2xl border border-white/5 shadow-lg">
              <input v-model="protocolForm.name"
                class="flex-1 px-4 py-2 rounded-xl bg-slate-950 border border-white/10 text-slate-100 text-sm font-bold focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/20"
                placeholder="情境名稱（如：過敏性休克 Anaphylaxis）" />
              <button @click="saveProtocol"
                class="px-4 py-2 rounded-xl bg-rose-600 border border-rose-500/30 hover:bg-rose-500 text-white text-xs font-bold shrink-0 cursor-pointer shadow-[0_4px_12px_rgba(239,68,68,0.15)]"
              >
                儲存
              </button>
              <button v-if="protocolForm.id" @click="deleteProtocol"
                class="px-3 py-2 rounded-xl text-rose-500 hover:bg-rose-500/10 text-xs font-bold shrink-0 cursor-pointer transition-colors"
              >
                刪除
              </button>
            </div>

            <!-- Triggers (Neon Amber) -->
            <div class="bg-slate-900/40 border border-amber-500/10 rounded-2xl p-5 shadow-sm">
              <div class="flex items-center justify-between mb-4 border-b border-amber-500/10 pb-2">
                <span class="text-xs font-black text-amber-400 uppercase tracking-widest font-mono">▲ 1. 觸發情境 (Triggers)</span>
                <button @click="protocolForm.triggers.push('')"
                  class="text-2xs font-bold bg-amber-500/10 border border-amber-500/20 text-amber-300 px-2 py-1 rounded-lg hover:bg-amber-500/20 transition-all cursor-pointer"
                >＋ 新增條件</button>
              </div>
              <div class="space-y-2">
                <div v-for="(_, i) in protocolForm.triggers" :key="i" class="flex gap-2 items-center">
                  <input v-model="protocolForm.triggers[i]"
                    class="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-amber-500/45 text-slate-200 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500/20 transition-all"
                    placeholder="例如：收縮壓 &lt; 90 mmHg 且合併心搏過速" />
                  <button @click="protocolForm.triggers.splice(i,1)"
                    class="text-slate-500 hover:text-rose-400 text-lg px-2 cursor-pointer transition-colors"
                  >✕</button>
                </div>
                <div v-if="!protocolForm.triggers.length" class="text-xs text-slate-500 italic py-2">無設定觸發條件，該卡片將始終顯示。</div>
              </div>
            </div>

            <!-- Immediate actions (Neon Red) -->
            <div class="bg-slate-900/40 border border-rose-500/10 rounded-2xl p-5 shadow-sm">
              <div class="flex items-center justify-between mb-4 border-b border-rose-500/10 pb-2">
                <span class="text-xs font-black text-rose-400 uppercase tracking-widest font-mono">⚡ 2. 立即處置 (Immediate Actions)</span>
                <button @click="protocolForm.immediate_actions.push('')"
                  class="text-2xs font-bold bg-rose-500/10 border border-rose-500/20 text-rose-300 px-2 py-1 rounded-lg hover:bg-rose-500/20 transition-all cursor-pointer"
                >＋ 新增處置</button>
              </div>
              <div class="space-y-2">
                <div v-for="(_, i) in protocolForm.immediate_actions" :key="i" class="flex gap-2 items-center">
                  <span class="text-xs text-rose-500/60 w-5 shrink-0 text-right font-mono font-bold">{{ i+1 }}.</span>
                  <input v-model="protocolForm.immediate_actions[i]"
                    class="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-rose-500/45 text-slate-200 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-rose-500/20 transition-all"
                    placeholder="處置動作描述（如：建立大口徑靜脈管路、給予高流量氧氣）" />
                  <button @click="protocolForm.immediate_actions.splice(i,1)"
                    class="text-slate-500 hover:text-rose-400 text-lg px-2 cursor-pointer transition-colors"
                  >✕</button>
                </div>
                <div v-if="!protocolForm.immediate_actions.length" class="text-xs text-slate-500 italic py-2">尚未新增處置步驟。</div>
              </div>
            </div>

            <!-- Critical meds (Neon Blue) -->
            <div class="bg-slate-900/40 border border-indigo-500/10 rounded-2xl p-5 shadow-sm">
              <div class="flex items-center justify-between mb-4 border-b border-indigo-500/10 pb-2">
                <span class="text-xs font-black text-indigo-400 uppercase tracking-widest font-mono">💊 3. 關鍵藥物 (Critical Medications)</span>
                <button @click="protocolForm.critical_meds.push({ name:'', dose:'', color:'blue' })"
                  class="text-2xs font-bold bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-2 py-1 rounded-lg hover:bg-indigo-500/20 transition-all cursor-pointer"
                >＋ 新增藥物</button>
              </div>
              <div class="space-y-2">
                <div v-for="(med, i) in protocolForm.critical_meds" :key="i"
                  class="grid grid-cols-[1.5fr_1.5fr_1fr_auto] gap-2.5 items-center">
                  <input v-model="med.name"
                    class="px-3.5 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-indigo-500/45 text-slate-200 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-all"
                    placeholder="藥物名稱（如：Epinephrine）" />
                  <input v-model="med.dose"
                    class="px-3.5 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-indigo-500/45 text-slate-200 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500/20 transition-all"
                    placeholder="劑量及給藥途徑（如：0.3 mg IM q5-15m）" />
                  <select v-model="med.color"
                    class="px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-300 text-xs font-bold focus:outline-none focus:border-indigo-500/45">
                    <option value="blue">🔵 藍色 (Tech)</option>
                    <option value="red">🔴 紅色 (Danger)</option>
                    <option value="green">🟢 綠色 (Safety)</option>
                    <option value="yellow">🟡 黃色 (Warn)</option>
                    <option value="purple">🟣 紫色 (Special)</option>
                    <option value="orange">🟠 橙色 (Alert)</option>
                  </select>
                  <button @click="protocolForm.critical_meds.splice(i,1)"
                    class="text-slate-500 hover:text-rose-400 text-lg px-2 cursor-pointer transition-colors"
                  >✕</button>
                </div>
                <div v-if="!protocolForm.critical_meds.length" class="text-xs text-slate-500 italic py-2">無設定關鍵用藥。</div>
              </div>
            </div>

            <!-- Timers (Neon Green) -->
            <div class="bg-slate-900/40 border border-emerald-500/10 rounded-2xl p-5 shadow-sm">
              <div class="flex items-center justify-between mb-4 border-b border-emerald-500/10 pb-2">
                <span class="text-xs font-black text-emerald-400 uppercase tracking-widest font-mono">⏱ 4. 循環計時器 (Timers)</span>
                <button @click="protocolForm.timers.push({ label:'', seconds: 120 })"
                  class="text-2xs font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-2 py-1 rounded-lg hover:bg-emerald-500/20 transition-all cursor-pointer"
                >＋ 新增計時</button>
              </div>
              <div class="space-y-2">
                <div v-for="(timer, i) in protocolForm.timers" :key="i" class="flex gap-3 items-center">
                  <input v-model="timer.label"
                    class="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-emerald-500/45 text-slate-200 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500/20 transition-all"
                    placeholder="計時事件說明（如：評估心律/CPR 週期）" />
                  <div class="flex items-center gap-1.5 shrink-0">
                    <input v-model.number="timer.seconds" type="number" min="1"
                      class="w-20 px-3 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-emerald-500/45 text-slate-200 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500/20 transition-all text-center" />
                    <span class="text-xs text-slate-500 font-bold">秒</span>
                  </div>
                  <button @click="protocolForm.timers.splice(i,1)"
                    class="text-slate-500 hover:text-rose-400 text-lg px-2 cursor-pointer transition-colors"
                  >✕</button>
                </div>
                <div v-if="!protocolForm.timers.length" class="text-xs text-slate-500 italic py-2">無配置倒數計時器。</div>
              </div>
            </div>

            <!-- Contacts (Neon Purple) -->
            <div class="bg-slate-900/40 border border-violet-500/10 rounded-2xl p-5 shadow-sm">
              <div class="flex items-center justify-between mb-4 border-b border-violet-500/10 pb-2">
                <span class="text-xs font-black text-violet-400 uppercase tracking-widest font-mono">📞 5. 緊急通報分機 (Contacts)</span>
                <button @click="protocolForm.contacts.push({ label:'', ext:'' })"
                  class="text-2xs font-bold bg-violet-500/10 border border-violet-500/20 text-violet-300 px-2 py-1 rounded-lg hover:bg-violet-500/20 transition-all cursor-pointer"
                >＋ 新增聯絡</button>
              </div>
              <div class="space-y-2">
                <div v-for="(contact, i) in protocolForm.contacts" :key="i" class="flex gap-2.5 items-center">
                  <input v-model="contact.label"
                    class="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-violet-500/45 text-slate-200 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-violet-500/20 transition-all"
                    placeholder="通報目標或代碼（如：急救小組 999、ECMO 團隊）" />
                  <input v-model="contact.ext"
                    class="w-32 px-3.5 py-2 rounded-xl bg-slate-950 border border-white/5 focus:border-violet-500/45 text-slate-200 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-violet-500/20 transition-all text-center"
                    placeholder="直撥分機" />
                  <button @click="protocolForm.contacts.splice(i,1)"
                    class="text-slate-500 hover:text-rose-400 text-lg px-2 cursor-pointer transition-colors"
                  >✕</button>
                </div>
                <div v-if="!protocolForm.contacts.length" class="text-xs text-slate-500 italic py-2">無設定聯絡電話。</div>
              </div>
            </div>

            <!-- Notes -->
            <div class="bg-slate-900/30 border border-white/5 rounded-2xl p-5">
              <label class="text-2xs font-black text-slate-400 uppercase tracking-widest font-mono mb-2 block">備註資訊</label>
              <textarea v-model="protocolForm.notes" rows="4"
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-white/5 focus:border-white/20 text-slate-200 text-xs font-medium focus:outline-none resize-none leading-relaxed transition-all"
                placeholder="其他背景知識、藥物稀釋配方、診斷排除指引等資訊…" />
            </div>

          </div>
        </div>

        <!-- Empty state -->
        <div v-if="!protocolEditorOpen" class="flex-1 flex items-center justify-center bg-slate-950/10">
          <div class="text-center p-8 max-w-sm">
            <div class="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mx-auto text-2xl mb-4 shadow-[0_0_20px_rgba(239,68,68,0.08)] animate-pulse">🚨</div>
            <h4 class="text-sm font-bold text-slate-300 mb-1">危急情境卡片編輯器</h4>
            <p class="text-xs text-slate-500 leading-relaxed">請在左側面板選擇現有的 ACLS 情境進行編輯，或點擊右上角「新增」建立一套全新的緊急醫療監控儀表。</p>
          </div>
        </div>

      </div>

      <!-- ── 備份 / 還原 ──────────────────────────── -->
      <div v-if="activeTab === 'backup'" class="flex-1 overflow-y-auto px-8 py-6 space-y-6">

        <!-- ① DB 整體備份 -->
        <div class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl space-y-3">
          <div class="flex items-center gap-2">
            <span class="text-lg">🗄️</span>
            <h3 class="font-bold text-slate-200 text-sm">資料庫實體備份 (.db 檔案)</h3>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed">下載或載入 MedBase 的主 SQLite 資料庫檔案 <code class="font-mono text-indigo-300 bg-slate-950 px-1.5 py-0.5 rounded text-2xs border border-white/5">medbase.db</code>。此選項適用於完全遷移、手動硬碟備份。還原成功後，程式將自動重啟以載入新庫。</p>
          <div class="flex gap-3 pt-2">
            <button @click="backupDb" :disabled="dbBackingUp || dbRestoring"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 border border-indigo-500/30 text-white text-xs font-bold hover:bg-indigo-500 transition-all disabled:opacity-40 cursor-pointer shadow-lg shadow-indigo-500/10">
              {{ dbBackingUp ? '備份中…' : '💾 匯出資料庫主檔 (.db)' }}
            </button>
            <button @click="restoreDb" :disabled="dbBackingUp || dbRestoring"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 border border-amber-500/30 text-white text-xs font-bold hover:bg-amber-500 transition-all disabled:opacity-40 cursor-pointer shadow-lg shadow-amber-500/10">
              {{ dbRestoring ? '還原中…' : '📂 匯入並還原資料庫 (.db)' }}
            </button>
          </div>
        </div>

        <!-- ② 匯出區 -->
        <div class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl space-y-4">
          <div class="flex items-center justify-between border-b border-white/5 pb-3">
            <div class="flex items-center gap-2">
              <span class="text-lg">📤</span>
              <h3 class="font-bold text-slate-200 text-sm">模組資料備份與匯出 (XLSX)</h3>
            </div>
            <div class="flex gap-2">
              <button @click="selectAll"  class="text-xs text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer">全選</button>
              <span class="text-slate-700 font-mono">|</span>
              <button @click="selectNone" class="text-xs text-rose-400 hover:text-rose-300 font-bold cursor-pointer">全消</button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <label
              v-for="g in BACKUP_GROUPS" :key="g.key"
              class="flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all"
              :class="selectedGroups.has(g.key)
                ? 'border-indigo-500/30 bg-indigo-500/[0.04]'
                : 'border-white/5 bg-slate-950/20 hover:border-white/10'"
            >
              <input type="checkbox" :checked="selectedGroups.has(g.key)"
                @change="toggleGroup(g.key)"
                class="mt-0.5 accent-indigo-500 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between text-xs text-slate-200 font-bold">
                  <span>{{ g.icon }} {{ g.label }}</span>
                  <span v-if="groupCount(g) > 0" class="text-2xs font-mono font-bold bg-white/5 border border-white/5 text-emerald-400 px-1.5 py-0.5 rounded">
                    {{ groupCount(g).toLocaleString() }} 筆
                  </span>
                  <span v-else-if="Object.keys(tableMetaMap).length > 0" class="text-2xs font-mono text-slate-600 px-1 py-0.5">空</span>
                </div>
                <div class="text-2xs text-slate-500 mt-1 font-medium">{{ g.desc }}</div>
              </div>
            </label>
          </div>

          <div class="flex gap-3 pt-2">
            <button
              @click="exportSelected"
              :disabled="exportingFull || selectedGroups.size === 0"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 border border-indigo-500/30 text-white text-xs font-bold hover:bg-indigo-500 transition-all disabled:opacity-40 cursor-pointer shadow-lg shadow-indigo-500/10"
            >
              {{ exportingFull ? '匯出中…' : '💾 匯出選取模組 (Excel .xlsx)' }}
            </button>
            <button
              @click="downloadTemplate"
              :disabled="downloadingTemplate"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-40 cursor-pointer"
            >
              {{ downloadingTemplate ? '下載中…' : '📥 下載系統填寫模板 (Excel)' }}
            </button>
          </div>
        </div>

        <!-- ② 還原區 -->
        <div class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl space-y-4">
          <div class="flex items-center gap-2">
            <span class="text-lg">📥</span>
            <h3 class="font-bold text-slate-200 text-sm">匯入與還原 (Excel / JSON)</h3>
          </div>

          <!-- 步驟 1：選檔（無預覽時） -->
          <div v-if="!importPreview" class="space-y-4">
            <p class="text-xs text-slate-400 leading-relaxed">請選擇備份的 Excel 活頁簿進行還原。系統會先載入檔案分頁與結構，顯示寫入預覽，在您確認無誤後才會執行資料庫覆寫寫入動作。</p>
            <div class="flex gap-3 flex-wrap">
              <label
                class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border border-white/5 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                :class="importingFull ? 'opacity-55 cursor-wait' : ''"
              >
                📁 選擇模組備份檔 (Excel)
                <input ref="fullImportInput" type="file" accept=".xlsx" class="hidden"
                  :disabled="importingFull" @change="handleFullImport" />
              </label>

              <!-- 設定備份（JSON） -->
              <button @click="exportSettings" :disabled="exportingSettings"
                class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-40 cursor-pointer">
                {{ exportingSettings ? '處理中…' : '📤 匯出系統參數設定 (JSON)' }}
              </button>
              <button @click="handleSettingsImport" :disabled="importingSettings"
                class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-40 cursor-pointer">
                {{ importingSettings ? '處理中…' : '📥 匯入系統參數設定 (JSON)' }}
              </button>
            </div>
          </div>

          <!-- 步驟 2：預覽確認 -->
          <div v-if="importPreview" class="space-y-4 border-t border-white/5 pt-4">
            <p class="text-xs font-black text-amber-400 uppercase tracking-widest font-mono">⚠️ 匯入資料預覽確認</p>
            <div class="grid grid-cols-3 gap-2">
              <div v-for="row in importPreview" :key="row.table"
                class="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/5 text-xs font-semibold">
                <span class="text-slate-300">{{ row.label }}</span>
                <span class="font-mono text-emerald-400 font-bold">{{ row.rows }} 筆</span>
              </div>
            </div>
            <p class="text-[0.6875rem] text-slate-500 leading-relaxed">
              * 系統將使用 <code class="font-mono bg-slate-950 px-1 py-0.5 text-slate-400 border border-white/5 rounded text-2xs">INSERT OR REPLACE</code> 執行寫入，具有相同 ID 或主鍵的列將被<b>完全覆寫</b>。
            </p>
            <!-- 進度條（匯入中才顯示） -->
            <div v-if="importingFull" class="w-full rounded-full bg-slate-950 border border-white/5 h-2 overflow-hidden">
              <div class="h-2 bg-emerald-500 transition-all duration-150 rounded-full"
                :style="{ width: fullImportProgress + '%' }"></div>
            </div>
            <div class="flex items-center gap-3 pt-2">
              <button
                @click="confirmFullImport"
                :disabled="importingFull"
                class="px-5 py-2 rounded-xl bg-emerald-600 border border-emerald-500/30 text-white text-xs font-bold hover:bg-emerald-500 transition-all disabled:opacity-40 cursor-pointer shadow-lg shadow-emerald-500/10"
              >{{ importingFull ? `寫入中… ${fullImportProgress}%` : '確認寫入資料庫' }}</button>
              <button
                @click="cancelImport"
                :disabled="importingFull"
                class="px-4 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all cursor-pointer"
              >取消</button>
            </div>
          </div>
        </div>

        <!-- ③ 通訊錄雙軌同步 -->
        <div class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl space-y-4">
          <div class="flex items-center gap-2">
            <span class="text-lg">🔄</span>
            <h3 class="font-bold text-slate-200 text-sm">通訊錄雙軌即時同步 (.xlsx)</h3>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed">
            將此程式通訊錄資料庫與本地指定之 <code class="font-mono text-indigo-300 bg-slate-950 px-1.5 py-0.5 rounded text-2xs border border-white/5">通訊錄.xlsx</code> 連結。對程式做出的任何通訊錄修改會同步回寫該 Excel；若 Excel 檔遭外部程式修改，MedBase 亦會自動偵測並重載，並即時推送 GAS 雲端表單以維持同步。
          </p>

          <!-- 未綁定 -->
          <div v-if="!xlsxSyncPath" class="flex flex-wrap gap-2.5 pt-2">
            <button
              @click="bindXlsxFile"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 border border-indigo-500/30 text-white text-xs font-bold hover:bg-indigo-500 transition-all cursor-pointer shadow-lg shadow-indigo-500/10"
            >
              📂 連結現有 Excel 檔案
            </button>
            <button
              @click="createXlsxFile"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all cursor-pointer"
            >
              ✨ 建立新 Excel 檔案並連結
            </button>
          </div>

          <!-- 已綁定 -->
          <div v-else class="space-y-3 pt-2">
            <div class="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-slate-950 border border-white/5 text-xs">
              <span class="text-emerald-400 animate-pulse mt-0.5">●</span>
              <div class="space-y-1">
                <div class="text-slate-500 font-bold uppercase tracking-wider text-3xs font-mono">即時監控路徑</div>
                <div class="text-slate-200 font-mono break-all font-bold text-[0.6875rem]">{{ xlsxSyncPath }}</div>
              </div>
            </div>
            <div v-if="xlsxFormatSummary" class="px-4 py-2.5 rounded-xl bg-slate-950 border border-white/[0.03] text-xs text-slate-400 font-medium">
              <span class="text-slate-500 font-bold mr-1">XLSX 結構偵測:</span> {{ xlsxFormatSummary }}
            </div>
            <div v-if="xlsxSyncStatus" class="px-4 py-2.5 rounded-xl bg-slate-950/50 border border-white/[0.02] text-xs text-slate-500 font-medium font-mono">
              {{ xlsxSyncStatus }}
            </div>
            <div class="flex flex-wrap gap-2.5 pt-1">
              <button
                @click="doXlsxExport"
                :disabled="xlsxSyncing"
                class="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-white/5 bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-50 cursor-pointer"
              >
                {{ xlsxSyncing ? '處理中…' : '⬆ 同步寫入 Excel (DB → XLSX)' }}
              </button>
              <button
                @click="doXlsxImport"
                :disabled="xlsxSyncing"
                class="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-white/5 bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all disabled:opacity-50 cursor-pointer"
              >
                {{ xlsxSyncing ? '處理中…' : '⬇ 從 Excel 重新載入 (XLSX → DB)' }}
              </button>
              <button
                @click="doXlsxUnbind"
                class="flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-rose-950/20 border border-rose-900/30 hover:border-rose-900/60 text-rose-400 text-xs font-bold hover:bg-rose-950/40 transition-all cursor-pointer"
              >
                解除連結
              </button>
            </div>
          </div>
        </div>

        <!-- ④ 危險操作 (Rose-danger) -->
        <div class="bg-rose-950/[0.04] rounded-2xl border border-rose-500/20 p-6 shadow-xl space-y-4">
          <div class="flex items-center justify-between border-b border-rose-500/10 pb-3">
            <div class="flex items-center gap-2">
              <span class="text-lg">⚠️</span>
              <h3 class="font-bold text-rose-400 text-sm">清除/清空資料庫內容</h3>
            </div>
            <div class="flex gap-2">
              <button @click="clearGroups = new Set(BACKUP_GROUPS.map(g => g.key))" class="text-xs text-rose-400/80 hover:text-rose-400 font-bold cursor-pointer">全選</button>
              <span class="text-rose-900 font-mono">|</span>
              <button @click="clearGroups = new Set()" class="text-xs text-slate-500 hover:text-slate-400 font-bold cursor-pointer">全消</button>
            </div>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed">請勾選欲清空的資料模組。注意：清空後資料將徹底從本地庫移除且<b>無法復原</b>，執行前請確保已有 XLSX 備份。</p>

          <div class="grid grid-cols-2 gap-2.5">
            <label
              v-for="g in BACKUP_GROUPS" :key="g.key"
              class="flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all"
              :class="clearGroups.has(g.key)
                ? 'border-rose-700/40 bg-rose-500/[0.04]'
                : 'border-white/5 bg-slate-950/20 hover:border-rose-500/10'"
            >
              <input type="checkbox" :checked="clearGroups.has(g.key)"
                @change="toggleClearGroup(g.key)"
                class="accent-rose-600 shrink-0" />
              <span class="text-xs text-slate-200 font-bold">{{ g.icon }} {{ g.label }}</span>
            </label>
          </div>

          <button
            @click="showClearConfirm = true"
            :disabled="clearGroups.size === 0"
            class="px-5 py-2.5 rounded-xl bg-rose-900/40 border border-rose-700/30 hover:border-rose-700 text-rose-200 text-xs font-bold hover:bg-rose-950/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-rose-950/20"
          >清空選取模組（{{ clearGroups.size }} 個群組）</button>
        </div>

        <!-- ③ 注意事項 -->
        <div class="text-2xs text-slate-600 space-y-1.5 px-2 py-4 border-t border-white/[0.02] font-medium leading-relaxed">
          <p>• 模組備份 XLSX 的每個分頁 (Sheet) 名稱對應資料庫實體表名稱，方便手動用 Excel 大量編輯。</p>
          <p>• 還原匯入時系統會自動關閉外鍵檢查，並依賴資料相依拓撲順序寫入，確保不會觸發外鍵衝突。</p>
          <p>• <span class="text-amber-500/80">班表參數設定</span>及帳號密碼，均儲存在「排班系統」模組的 <code class="font-mono bg-slate-950 px-1 py-0.5 rounded border border-white/5 text-3xs">app_settings</code> 表中，備份排班資料時請務必勾選該群組。</p>
          <p>• AHK 腳本的<span class="text-amber-500/80">硬碟實體檔案</span>不在 SQLite 資料庫備份範圍內，此處備份僅包含腳本的元資料、群組結構及關聯資訊。</p>
        </div>

      </div>

    </div><!-- /右側 -->
  </div><!-- /外層 -->

  <!-- ════════════════════════════════════════════════
       Modal 容器
  ════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      @click.self="closeModal">

      <!-- ── 自費品項 Modal ─────────────────────── -->
      <div v-if="activeTab === 'items'"
        class="w-full max-w-lg bg-slate-900/90 rounded-2xl border border-white/10 shadow-2xl overflow-hidden backdrop-blur-md">
        <div class="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h3 class="font-bold text-slate-100 text-sm">{{ modalMode === "add" ? "新增" : "編輯" }}品項</h3>
          <button @click="closeModal" class="text-slate-500 hover:text-slate-300 text-lg leading-none cursor-pointer">✕</button>
        </div>
        <div class="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">院內碼 *</label>
              <input v-model="itemForm.hospital_code" :disabled="modalMode==='edit'"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-mono font-bold focus:outline-none focus:border-indigo-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                placeholder="M1A01234" />
            </div>
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">計價單位</label>
              <input v-model="itemForm.unit"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-medium focus:outline-none focus:border-indigo-500/50"
                placeholder="個 / 支 / 組" />
            </div>
          </div>
          <div>
            <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">中文品名</label>
            <input v-model="itemForm.name_zh"
              class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-bold focus:outline-none focus:border-indigo-500/50"
              placeholder="請輸入中文品名..." />
          </div>
          <div>
            <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">英文品名</label>
            <input v-model="itemForm.name_en"
              class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-medium focus:outline-none focus:border-indigo-500/50"
              placeholder="English Name / Description..." />
          </div>
          <div>
            <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">耗材用途分類</label>
            <input v-model="itemForm.purpose"
              class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-bold focus:outline-none focus:border-teal-500/50"
              placeholder="例如：止血劑 / Mesh人工網膜 / 骨釘" />
          </div>
          <div>
            <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">適用科別（多科請用分號分隔，如：骨科;一般外科）</label>
            <input
              :value="(itemForm as any).depts?.join(';') ?? ''"
              @input="(itemForm as any).depts = ($event.target as HTMLInputElement).value.split(';').map((s:string)=>s.trim()).filter(Boolean)"
              class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-bold focus:outline-none focus:border-cyan-500/50"
              placeholder="骨科;一般外科;心臟外科" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">自費金額 (NTD)</label>
              <input v-model.number="itemForm.price" type="number"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-mono font-bold focus:outline-none focus:border-indigo-500/50"
                placeholder="0" />
            </div>
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">材料廠商名稱</label>
              <input v-model="itemForm.supplier"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-medium focus:outline-none focus:border-indigo-500/50"
                placeholder="進口商或供應商" />
            </div>
          </div>
          <div>
            <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">備註資訊</label>
            <textarea v-model="itemForm.notes" rows="2"
              class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-medium focus:outline-none focus:border-indigo-500/50 resize-none leading-relaxed" />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-white/5 bg-slate-900/50">
          <button @click="closeModal" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-white/5 cursor-pointer transition-colors">取消</button>
          <button @click="saveItem" class="px-5 py-2 rounded-xl bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shadow-lg shadow-indigo-500/10">儲存品項</button>
        </div>
      </div>

      <!-- ── 通訊錄 Modal ───────────────────── -->
      <div v-if="activeTab === 'physicians'"
        class="w-full max-w-lg bg-slate-900/90 rounded-2xl border border-white/10 shadow-2xl overflow-hidden backdrop-blur-md">
        <div class="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h3 class="font-bold text-slate-100 text-sm">{{ modalMode === "add" ? "新增" : "編輯" }}醫師</h3>
          <button @click="closeModal" class="text-slate-500 hover:text-slate-300 text-lg leading-none cursor-pointer">✕</button>
        </div>
        <div class="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">姓名 *</label>
              <input v-model="physForm.name"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-bold focus:outline-none focus:border-indigo-500/50"
                placeholder="王大明" />
            </div>
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">所屬科別</label>
              <input v-model="physForm.department"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-bold focus:outline-none focus:border-indigo-500/50"
                placeholder="骨科 / 一般外科" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">職稱 / 職等</label>
              <input v-model="physForm.title"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-bold focus:outline-none focus:border-indigo-500/50"
                placeholder="主治醫師 / 住院醫師" />
            </div>
            <div>
              <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">院內電話分機</label>
              <input v-model="physForm.ext"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-mono font-bold focus:outline-none focus:border-indigo-500/50"
                placeholder="1234" />
            </div>
          </div>
          <div class="border-t border-white/5 pt-3">
            <span class="text-2xs font-bold text-slate-500 uppercase mb-3 block">資訊系統登入金鑰 (用於 AHK 自動登入)</span>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-2xs font-bold text-slate-600 mb-1 block">HIS 醫療系統帳號</label>
                <input v-model="physForm.his_account"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label class="text-2xs font-bold text-slate-600 mb-1 block">HIS 醫療系統密碼</label>
                <input v-model="physForm.his_password" type="password"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label class="text-2xs font-bold text-slate-600 mb-1 block">PHS 通訊系統帳號</label>
                <input v-model="physForm.phs_account"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label class="text-2xs font-bold text-slate-600 mb-1 block">PHS 通訊系統密碼</label>
                <input v-model="physForm.phs_password" type="password"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500/50" />
              </div>
            </div>
          </div>
          <div>
            <label class="text-2xs font-bold text-slate-500 uppercase mb-1 block">備註說明</label>
            <textarea v-model="physForm.notes" rows="2"
              class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-100 text-xs font-medium focus:outline-none focus:border-indigo-500/50 resize-none leading-relaxed" />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-white/5 bg-slate-900/50">
          <button @click="closeModal" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-white/5 cursor-pointer transition-colors">取消</button>
          <button @click="savePhysician" class="px-5 py-2 rounded-xl bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shadow-lg shadow-indigo-500/10">儲存資料</button>
        </div>
      </div>

    </div>
  </Teleport>

  <!-- ════ 批次新增品項 Modal ════ -->
  <Teleport to="body">
    <div v-if="showBatchAdd"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      @click.self="showBatchAdd = false">
      <div class="w-full max-w-5xl bg-slate-900/90 rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] backdrop-blur-md">

        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div>
            <h3 class="font-bold text-slate-100 text-sm">自費耗材批次快速輸入</h3>
            <p class="text-2xs text-slate-500 mt-1 font-medium">填入多筆品項後一次性儲存。院內碼為必要識別欄，若院內碼已存在則會自動略過避免重疊。</p>
          </div>
          <button @click="showBatchAdd = false" class="text-slate-500 hover:text-slate-300 text-lg leading-none cursor-pointer">✕</button>
        </div>

        <!-- 表格 -->
        <div class="flex-1 overflow-auto px-4 py-2">
          <table class="w-full text-xs text-left border-collapse">
            <thead class="sticky top-0 bg-slate-900 z-10 border-b border-white/10">
              <tr class="text-slate-500 text-2xs font-bold tracking-wider uppercase font-mono">
                <th class="px-3 py-3 w-32">院內碼 *</th>
                <th class="px-3 py-3">中文品名</th>
                <th class="px-3 py-3 w-36">用途分類</th>
                <th class="px-3 py-3 w-40">適用科別 (用分號 ;)</th>
                <th class="px-3 py-3 w-28">自費金額</th>
                <th class="px-3 py-3 w-32">廠商名稱</th>
                <th class="w-10 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.02]">
              <tr v-for="(row, i) in batchRows" :key="i"
                class="hover:bg-white/[0.01]"
                :class="row.hospital_code.trim() ? '' : 'bg-white/[0.002]'">
                <td class="px-2 py-2">
                  <input v-model="row.hospital_code" placeholder="M1A01234"
                    class="w-full px-2.5 py-1.5 bg-slate-950 border border-white/5 focus:border-indigo-500/50 rounded-lg text-xs font-mono font-bold text-slate-200 outline-none transition-all"
                    :class="!row.hospital_code.trim() && i > 0 ? 'border-dashed border-slate-800' : ''" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.name_zh" placeholder="耗材中文名..."
                    class="w-full px-2.5 py-1.5 bg-slate-950 border border-white/5 focus:border-indigo-500/50 rounded-lg text-xs text-slate-200 outline-none transition-all" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.purpose" placeholder="止血棉..."
                    class="w-full px-2.5 py-1.5 bg-slate-950 border border-white/5 focus:border-teal-500/50 rounded-lg text-xs text-slate-200 outline-none transition-all" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.deptsStr" placeholder="骨科;外科"
                    class="w-full px-2.5 py-1.5 bg-slate-950 border border-white/5 focus:border-cyan-500/50 rounded-lg text-xs text-slate-200 outline-none transition-all" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.price" type="number" placeholder="0"
                    class="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs font-mono text-gray-100 outline-none focus:border-blue-500" />
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="row.supplier" placeholder="廠商名稱"
                    class="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-100 outline-none focus:border-blue-500" />
                </td>
                <td class="px-2 py-1.5 text-center">
                  <button @click="removeBatchRow(i)" :disabled="batchRows.length === 1"
                    class="text-gray-600 hover:text-red-400 disabled:opacity-20 text-base leading-none">×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between px-5 py-3 border-t border-gray-800 shrink-0">
          <button @click="addBatchRow"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors">
            ＋ 新增一列
          </button>
          <div class="flex gap-2">
            <span class="text-xs text-gray-600 self-center mr-2">
              {{ batchRows.filter(r=>r.hospital_code.trim()).length }} / {{ batchRows.length }} 列有效
            </span>
            <button @click="showBatchAdd = false"
              class="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800">取消</button>
            <button @click="saveBatchItems" :disabled="batchSaving || !batchRows.some(r=>r.hospital_code.trim())"
              class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium">
              {{ batchSaving ? "儲存中…" : `全部儲存（${batchRows.filter(r=>r.hospital_code.trim()).length} 筆）` }}
            </button>
          </div>
        </div>

      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="slide-down">
      <div v-if="toast"
        class="fixed top-4 right-4 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium"
        :class="toast.type === 'success'
          ? 'bg-emerald-900 border border-emerald-700 text-emerald-200'
          : 'bg-red-900 border border-red-700 text-red-200'"
      >
        <span>{{ toast.type === 'success' ? '✓' : '✕' }}</span>
        <span>{{ toast.msg }}</span>
      </div>
    </Transition>
  </Teleport>

  <!-- ════════════════════════════════════════════════
       刪除確認 Dialog
  ════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="showConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl p-6 text-center">
        <div class="text-3xl mb-3">🗑️</div>
        <h3 class="font-semibold text-gray-100 mb-1">確認刪除？</h3>
        <p class="text-sm text-gray-500 mb-5">
          此操作無法復原。
        </p>
        <div class="flex gap-3 justify-center">
          <button @click="showConfirm = false"
            class="px-5 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700">
            取消
          </button>
          <button @click="doDelete"
            class="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium">
            確認刪除
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ── 清空資料庫確認 Modal ──────────────────── -->
  <Teleport to="body">
    <div v-if="showClearConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      @click.self="showClearConfirm = false; clearInput = ''">
      <div class="w-full max-w-sm bg-gray-900 rounded-2xl border border-red-800 shadow-2xl p-6">
        <div class="text-3xl mb-3 text-center">⚠️</div>
        <h3 class="font-semibold text-red-400 text-center mb-1">確認清空</h3>
        <p class="text-sm text-gray-400 text-center mb-3">
          以下資料將被永久刪除，此操作<span class="text-red-400 font-semibold">無法復原</span>。
        </p>
        <div class="flex flex-wrap gap-1 justify-center mb-4">
          <span v-for="g in BACKUP_GROUPS.filter(g => clearGroups.has(g.key))" :key="g.key"
            class="px-2 py-0.5 rounded-full bg-red-900/50 text-red-300 text-xs">
            {{ g.icon }} {{ g.label }}
          </span>
        </div>
        <p class="text-xs text-gray-500 mb-2 text-center">
          輸入「<span class="text-red-400 font-mono">{{ CLEAR_KEYWORD }}</span>」以確認
        </p>
        <input
          v-model="clearInput"
          :placeholder="CLEAR_KEYWORD"
          class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm text-center focus:outline-none focus:border-red-500 mb-4"
        />
        <div class="flex gap-3">
          <button
            @click="showClearConfirm = false; clearInput = ''"
            class="flex-1 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm"
          >取消</button>
          <button
            @click="clearLocalDb"
            :disabled="clearInput !== CLEAR_KEYWORD || clearing"
            class="flex-1 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >{{ clearing ? '清空中…' : '確認清空' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active { transition: all 0.2s ease; }
.slide-down-enter-from,
.slide-down-leave-to { opacity: 0; transform: translateY(-6px); }
</style>

