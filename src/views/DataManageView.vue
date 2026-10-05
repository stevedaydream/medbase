<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { getDb, dbWrite } from "@/db";
import * as XLSX from "xlsx";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
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
} from "@/composables/useXlsxSync";
import { touchTable, markDeleted } from "@/composables/useTableSync";
import { refreshPassAhk } from "@/composables/usePhysicians";
import NpDutyDataManager from "@/components/NpDutyDataManager.vue";
import ItemFormModal from "@/components/ItemFormModal.vue";
import ComboInput from "@/components/ComboInput.vue";
import EmergencyEditor from "@/components/emergency/EmergencyEditor.vue";
import HandbookEditor from "@/components/handbook/HandbookEditor.vue";
import BackupPanel from "@/components/BackupPanel.vue";
import TrashPanel from "@/components/TrashPanel.vue";

// ── 型別定義 ────────────────────────────────────────────────────
interface Item {
  hospital_code: string; name_en: string | null; name_zh: string | null;
  purpose: string | null; depts: string[]; unit: string | null;
  price: number | null; supplier: string | null; notes: string | null;
}
type Tab = "items" | "emergency" | "handbook" | "npDuty" | "backup" | "trash";

// ── 狀態 ────────────────────────────────────────────────────────
const activeTab   = ref<Tab>("items");
const search      = ref("");
const route       = useRoute();

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
// 危急處置卡由 EmergencyEditor 自行讀寫（ADR-017）
const emEditor = ref<InstanceType<typeof EmergencyEditor> | null>(null);
const emCount = ref(0);
const hbEditor = ref<InstanceType<typeof HandbookEditor> | null>(null);
const hbCount = ref(0);

// Modal
const showModal   = ref(false);
const modalMode   = ref<"add" | "edit">("add");
const deleteTarget = ref<Item | null>(null);
const showConfirm  = ref(false);

// 表單暫存
const itemForm   = ref<Partial<Item>>({});
// ── 批次新增品項 ─────────────────────────────────────────────────
interface BatchItemRow {
  hospital_code: string; name_zh: string; name_en: string; purpose: string;
  deptsStr: string; price: string; supplier: string;
}
const showBatchAdd = ref(false);
const batchRows    = ref<BatchItemRow[]>([]);
const batchSaving  = ref(false);

/** 用途分類下拉選單：既有品項的分類＋批次表格中剛輸入的新分類 */
const purposeOptions = computed(() => [
  ...items.value.map(m => m.purpose ?? ""),
  ...batchRows.value.map(r => r.purpose),
].filter(p => p.trim()));
const existingCodes = computed(() => new Set(items.value.map(m => m.hospital_code)));

function emptyBatchRow(): BatchItemRow {
  return { hospital_code: "", name_zh: "", name_en: "", purpose: "", deptsStr: "", price: "", supplier: "" };
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
        `INSERT OR IGNORE INTO items (hospital_code,name_zh,name_en,purpose,unit,price,supplier,notes) VALUES (?,?,?,?,?,?,?,?)`,
        [code, r.name_zh||null, r.name_en.trim()||null, r.purpose.trim()||null, null,
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
    await touchTable("items");
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
// 備份檔沒有時間戳的資料視為最舊：同步時以雲端為準，避免還原舊備份蓋掉其他電腦較新的修改
const EPOCH = "1970-01-01 00:00:00";
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
          // 不可用 REPLACE：先刪再插會換掉 uid，同步後雲端多出一份（ADR-011）
          `INSERT INTO sets (id,name,surgery_type,physician_id,department_id,notes)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, surgery_type=excluded.surgery_type,
             physician_id=excluded.physician_id, department_id=excluded.department_id, notes=excluded.notes`,
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
             (id,name,department,title,ext,his_account,his_password,notes,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [r.id, r.name, n(r.department), n(r.title), n(r.ext),
             n(r.his_account), n(r.his_password), n(r.notes), n(r.updated_at) ?? EPOCH]);
        } else {
          await dbWrite(
            `INSERT INTO physicians
             (name,department,title,ext,his_account,his_password,notes,updated_at)
             VALUES (?,?,?,?,?,?,?,?)`,
            [r.name, n(r.department), n(r.title), n(r.ext),
             n(r.his_account), n(r.his_password), n(r.notes), n(r.updated_at) ?? EPOCH]);
        }
        ok++; tick();
      }
      if (ok || skip) results.push({ sheet: "通訊錄", upserted: ok, skipped: skip });
    }

    importResults.value = results;
    await loadAll();
    for (const t of ["items", "sets", "physicians"]) await touchTable(t);
    // physicians sheet 可能帶入新的 HIS 帳密
    const ahkMessage = await refreshPassAhk();
    showToast("success", ahkMessage ? `匯入完成！｜${ahkMessage}` : "匯入完成！");
  } catch (err: any) {
    showToast("error", `匯入失敗：${err?.message ?? err}`);
  } finally {
    importing.value = false;
    if (xlsxInput.value) xlsxInput.value.value = "";
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

  // 由外部指定要開啟的分頁（?tab=）
  // 通訊錄分頁已移除（改用 /physicians），舊網址的 ?tab=physicians 忽略
  const qTab = route.query.tab;
  if (typeof qTab === "string" && tabs.some(t => t.key === qTab)) {
    activeTab.value = qTab as Tab;
  }
}
onMounted(loadAll);

// 切 tab 時重置搜尋
watch(activeTab, () => {
  search.value = "";
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
// ── Modal 開關 ───────────────────────────────────────────────────
function openAdd() {
  if (activeTab.value === "emergency") { emEditor.value?.newCard(); return; }
  if (activeTab.value === "handbook") { hbEditor.value?.newCard(); return; }
  modalMode.value = "add";
  if (activeTab.value === "items")       itemForm.value = {};
  showModal.value = true;
}
function openEdit(row: any) {
  modalMode.value = "edit";
  if (activeTab.value === "items")       itemForm.value = { ...row };
  showModal.value = true;
}
function closeModal() { showModal.value = false; }

// ── CRUD：items ──────────────────────────────────────────────────
async function onItemSaved() {
  closeModal();
  await loadAll();
}
async function deleteItem(row: Item) {
  await markDeleted("items", row.hospital_code);
  await dbWrite("DELETE FROM item_depts WHERE hospital_code=?", [row.hospital_code]);
  await dbWrite("DELETE FROM items WHERE hospital_code=?", [row.hospital_code]);
  await loadAll();
  await touchTable("items");
}

// ── 確認刪除 ─────────────────────────────────────────────────────
function confirmDelete(row: Item) { deleteTarget.value = row; showConfirm.value = true; }
async function doDelete() {
  const row = deleteTarget.value;
  if (!row) return;
  if (activeTab.value === "items")      await deleteItem(row as Item);
  showConfirm.value = false; deleteTarget.value = null;
}

const tabs: { key: Tab; icon: string; label: string; count: () => number }[] = [
  { key: "items",      icon: "📦", label: "自費品項",   count: () => items.value.length },
  { key: "emergency",  icon: "🚨", label: "危急情境",   count: () => emCount.value },
  { key: "handbook",   icon: "📘", label: "工作手冊",   count: () => hbCount.value },
  { key: "npDuty",     icon: "🧑‍⚕️", label: "NP／VS 值班", count: () => 0 },
  { key: "backup",     icon: "💾", label: "備份 / 還原", count: () => 0 },
  { key: "trash",      icon: "🗑️", label: "垃圾桶",     count: () => 0 },
];
</script>

<template>
  <div class="accent-indigo flex h-full gap-0 overflow-hidden bg-sunken text-fg select-none">

    <!-- ── 左側 Tab 列 ──────────────────────────────── -->
    <div class="flex flex-col w-48 shrink-0 border-r border-hairline bg-surface py-4 gap-1 px-3">
      <div class="px-3 pb-3 mb-2 border-b border-hairline">
        <span class="text-xs font-black text-muted">資料庫管理</span>
      </div>
      <button
        v-for="tab in tabs" :key="tab.key"
        @click="activeTab = tab.key"
        class="flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all text-left cursor-pointer"
        :class="activeTab === tab.key
          ? 'bg-accent/10 border border-accent/30 text-accent shadow-[0_0_15px_rgba(99,102,241,0.08)]'
          : 'text-fg-secondary hover:bg-overlay/[0.02] border border-transparent hover:text-fg'"
      >
        <span class="flex items-center gap-2">
          <span class="text-base leading-none opacity-85">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </span>
        <span v-if="tab.count() > 0" class="text-2xs font-mono font-bold bg-overlay/5 border border-hairline text-muted px-1.5 py-0.5 rounded-md">{{ tab.count() }}</span>
      </button>
    </div>

    <!-- ── 右側內容 ─────────────────────────────────── -->
    <div class="flex flex-col flex-1 min-w-0 overflow-hidden bg-surface">

      <!-- Header -->
      <div v-if="activeTab !== 'backup' && activeTab !== 'npDuty'" class="flex items-center gap-3 px-6 py-4 border-b border-hairline bg-surface shrink-0">
        <div class="relative flex-1">
          <input
            v-model="search"
            :placeholder="`搜尋${tabs.find(t=>t.key===activeTab)?.label}…`"
            class="w-full px-4 py-2 bg-sunken border border-hairline text-fg focus:border-accent/50 focus:ring-1 focus:ring-accent/30 placeholder-muted text-xs font-medium rounded-xl transition-all outline-none"
          />
          <span v-if="search" @click="search = ''" class="absolute right-3 top-2.5 text-xs text-muted hover:text-fg-secondary cursor-pointer">✕</span>
        </div>
        <!-- 匯入 XLSX -->
        <label v-if="activeTab !== 'emergency' && activeTab !== 'handbook'"
          class="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer overflow-hidden border border-hairline bg-elevated text-fg-secondary hover:bg-raised hover:text-fg"
          :class="importing ? 'cursor-wait opacity-80' : ''"
        >
          <div v-if="importing"
            class="absolute inset-0 bg-accent/20 transition-all duration-200"
            :style="{ width: importProgress + '%' }"
          ></div>
          <span class="relative text-sm leading-none">{{ importing ? "⏳" : "📥" }}</span>
          <span class="relative">{{ importing ? `匯入中… ${importProgress}%` : "匯入 XLSX" }}</span>
          <input ref="xlsxInput" type="file" accept=".xlsx,.xls" class="hidden"
            :disabled="importing" @change="handleXlsx" />
        </label>
        <button v-if="activeTab === 'items'"
          @click="openBatchAdd"
          class="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-hairline bg-elevated text-fg-secondary hover:bg-raised hover:text-fg text-xs font-bold transition-all shrink-0 cursor-pointer"
        >
          批次新增
        </button>
        <button
          @click="openAdd"
          class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent border border-accent/30 text-white hover:bg-accent text-xs font-bold transition-all shrink-0 cursor-pointer shadow-[0_4px_12px_rgba(99,102,241,0.15)]"
        >
          <span>＋</span> 新增
        </button>
      </div>

      <!-- 匯入結果摘要 -->
      <Transition name="slide-down">
        <div v-if="importResults"
          class="flex items-center gap-4 px-6 py-2.5 bg-accent/5 border-b border-accent/10 shrink-0 text-xs">
          <span class="text-accent font-bold text-xs">匯入結果</span>
          <span v-for="r in importResults" :key="r.sheet"
            class="flex items-center gap-1 text-fg-secondary font-medium">
            <span class="text-success font-mono font-bold">+{{ r.upserted }}</span>
            <span class="text-fg-secondary">{{ r.sheet }}</span>
            <span v-if="r.skipped" class="text-muted">（略過 {{ r.skipped }}）</span>
            <span class="text-muted last:hidden">·</span>
          </span>
          <button @click="importResults = null" class="ml-auto text-muted hover:text-fg-secondary cursor-pointer">✕</button>
        </div>
      </Transition>

      <!-- ── 自費品項 表格 ─────────────────────────── -->
      <div v-if="activeTab === 'items'" class="flex-1 overflow-auto px-6 py-4">
        <div class="bg-surface rounded-2xl border border-hairline shadow-2xl overflow-hidden w-max min-w-full">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-hairline bg-surface text-fg-secondary text-xs font-bold">
                <th class="px-4 py-3">院內碼</th>
                <th class="px-4 py-3">中文品名</th>
                <th class="px-4 py-3">用途</th>
                <th class="px-4 py-3">適用科別</th>
                <th class="px-4 py-3 text-right">價格</th>
                <th class="px-4 py-3">廠商</th>
                <th class="w-24 px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-hairline">
              <tr v-if="filteredItems.length === 0">
                <td colspan="7" class="text-center text-muted py-12 italic text-xs">無匹配的自費品項資料</td>
              </tr>
              <tr v-for="m in filteredItems" :key="m.hospital_code"
                class="hover:bg-overlay/[0.015] transition-all group">
                <td class="px-4 py-2.5 text-fg-secondary font-mono text-xs font-semibold">{{ m.hospital_code }}</td>
                <td class="px-4 py-2.5 text-fg text-xs font-bold">{{ m.name_zh || m.name_en || "—" }}</td>
                <td class="px-4 py-2.5 text-xs">
                  <span v-if="m.purpose" class="bg-accent/10 border border-accent/20 text-accent px-2 py-0.5 rounded-lg text-2xs font-bold font-mono">{{ m.purpose }}</span>
                  <span v-else class="text-muted">—</span>
                </td>
                <td class="px-4 py-2.5 text-xs">
                  <div class="flex flex-wrap gap-1">
                    <span v-for="d in m.depts" :key="d" class="bg-accent/10 border border-accent/20 text-accent px-2 py-0.5 rounded-lg text-2xs font-bold">{{ d }}</span>
                    <span v-if="!m.depts.length" class="text-muted">—</span>
                  </div>
                </td>
                <td class="px-4 py-2.5 text-right text-success font-mono text-xs font-black">
                  {{ m.price ? `$${m.price.toLocaleString()}` : "—" }}</td>
                <td class="px-4 py-2.5 text-muted text-xs font-medium">{{ m.supplier || "—" }}</td>
                <td class="px-4 py-2.5 text-right">
                  <div class="flex gap-2.5 justify-end transition-opacity">
                    <button @click="openEdit(m)" class="text-xs text-accent hover:text-accent-hover font-bold cursor-pointer">編輯</button>
                    <button @click="confirmDelete(m)" class="text-xs text-danger hover:text-danger-hover font-bold cursor-pointer">刪除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── 危急處置卡（ADR-017）──────────────────── -->
      <EmergencyEditor v-if="activeTab === 'emergency'" ref="emEditor" :search="search"
        @count="n => (emCount = n)" @toast="(k, m) => showToast(k, m)" />
      <HandbookEditor v-if="activeTab === 'handbook'" ref="hbEditor" :search="search"
        @count="n => (hbCount = n)" @toast="(k, m) => showToast(k, m)" />

      <!-- ── 值班 NP ─────────────────────────────── -->
      <div v-if="activeTab === 'npDuty'" class="flex-1 overflow-y-auto px-8 py-6">
        <NpDutyDataManager />
      </div>

      <!-- ── 備份 / 還原 ──────────────────────────── -->
      <TrashPanel v-if="activeTab === 'trash'" @toast="showToast" @changed="loadAll" />
      <div v-else-if="activeTab === 'backup'" class="flex-1 overflow-y-auto px-8 py-6 space-y-6">

        <BackupPanel @toast="showToast" @changed="loadAll" />

        <!-- ③ 通訊錄雙軌同步 -->
        <div class="bg-surface rounded-2xl border border-hairline p-6 shadow-xl space-y-4">
          <div class="flex items-center gap-2">
            <span class="text-lg">🔄</span>
            <h3 class="font-bold text-fg text-sm">通訊錄雙軌即時同步 (.xlsx)</h3>
          </div>
          <p class="text-xs text-fg-secondary leading-relaxed">
            將此程式通訊錄資料庫與本地指定之 <code class="text-accent bg-sunken px-1.5 py-0.5 rounded text-xs border border-hairline">通訊錄.xlsx</code> 連結。對程式做出的任何通訊錄修改會同步回寫該 Excel；若 Excel 檔遭外部程式修改，MedBase 亦會自動偵測並重載，並即時推送 GAS 雲端表單以維持同步。
          </p>

          <!-- 未綁定 -->
          <div v-if="!xlsxSyncPath" class="flex flex-wrap gap-2.5 pt-2">
            <button
              @click="bindXlsxFile"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent border border-accent/30 text-white text-xs font-bold hover:bg-accent transition-all cursor-pointer shadow-lg shadow-accent/10"
            >
              📂 連結現有 Excel 檔案
            </button>
            <button
              @click="createXlsxFile"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised transition-all cursor-pointer"
            >
              ✨ 建立新 Excel 檔案並連結
            </button>
          </div>

          <!-- 已綁定 -->
          <div v-else class="space-y-3 pt-2">
            <div class="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-sunken border border-hairline text-xs">
              <span class="text-success animate-pulse mt-0.5">●</span>
              <div class="space-y-1">
                <div class="text-muted font-bold text-xs">即時監控路徑</div>
                <div class="text-fg font-mono break-all font-bold text-[0.6875rem]">{{ xlsxSyncPath }}</div>
              </div>
            </div>
            <div v-if="xlsxFormatSummary" class="px-4 py-2.5 rounded-xl bg-sunken border border-hairline text-xs text-fg-secondary font-medium">
              <span class="text-muted font-bold mr-1">XLSX 結構偵測:</span> {{ xlsxFormatSummary }}
            </div>
            <div v-if="xlsxSyncStatus" class="px-4 py-2.5 rounded-xl bg-sunken border border-hairline text-xs text-muted font-medium font-mono">
              {{ xlsxSyncStatus }}
            </div>
            <div class="flex flex-wrap gap-2.5 pt-1">
              <button
                @click="doXlsxExport"
                :disabled="xlsxSyncing"
                class="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-hairline bg-elevated text-fg-secondary text-xs font-bold hover:bg-raised transition-all disabled:opacity-50 cursor-pointer"
              >
                {{ xlsxSyncing ? '處理中…' : '⬆ 同步寫入 Excel (DB → XLSX)' }}
              </button>
              <button
                @click="doXlsxImport"
                :disabled="xlsxSyncing"
                class="flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-hairline bg-elevated text-fg-secondary text-xs font-bold hover:bg-raised transition-all disabled:opacity-50 cursor-pointer"
              >
                {{ xlsxSyncing ? '處理中…' : '⬇ 從 Excel 重新載入 (XLSX → DB)' }}
              </button>
              <button
                @click="doXlsxUnbind"
                class="flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-danger/10 border border-danger/30 hover:border-danger/60 text-danger text-xs font-bold hover:bg-danger/20 transition-all cursor-pointer"
              >
                解除連結
              </button>
            </div>
          </div>
        </div>

      </div>

    </div><!-- /右側 -->
  </div><!-- /外層 -->

  <!-- ════════════════════════════════════════════════
       Modal 容器
  ════════════════════════════════════════════════ -->
  <ItemFormModal :open="showModal && activeTab === 'items'" :mode="modalMode" :item="itemForm"
    :purposes="purposeOptions" :existing-codes="existingCodes"
    @close="closeModal" @saved="onItemSaved" />

  <!-- ════ 批次新增品項 Modal ════ -->
  <Teleport to="body">
    <div v-if="showBatchAdd"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showBatchAdd = false">
      <div class="w-full max-w-5xl bg-surface rounded-2xl border border-hairline shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-hairline shrink-0">
          <div>
            <h3 class="font-bold text-fg text-sm">自費耗材批次快速輸入</h3>
            <p class="text-xs text-muted mt-1 font-medium">填入多筆品項後一次性儲存。院內碼為必要識別欄，若院內碼已存在則會自動略過避免重疊。</p>
          </div>
          <button @click="showBatchAdd = false" class="text-muted hover:text-fg-secondary text-lg leading-none cursor-pointer">✕</button>
        </div>

        <!-- 表格 -->
        <div class="flex-1 overflow-auto px-4 py-2">
          <table class="w-full text-xs text-left border-collapse">
            <thead class="sticky top-0 bg-surface z-10 border-b border-hairline">
              <tr class="text-muted text-xs font-bold">
                <th class="px-3 py-3 w-32">院內碼 *</th>
                <th class="px-3 py-3">中文品名</th>
                <th class="px-3 py-3">英文品名</th>
                <th class="px-3 py-3 w-40">用途分類</th>
                <th class="px-3 py-3 w-40">適用科別 (用分號 ;)</th>
                <th class="px-3 py-3 w-28">自費金額</th>
                <th class="px-3 py-3 w-32">廠商名稱</th>
                <th class="w-10 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-hairline">
              <tr v-for="(row, i) in batchRows" :key="i"
                class="hover:bg-overlay/[0.01]"
                :class="row.hospital_code.trim() ? '' : 'bg-overlay/[0.002]'">
                <td class="px-2 py-2">
                  <input v-model="row.hospital_code" placeholder="M1A01234"
                    class="w-full px-2.5 py-1.5 bg-sunken border border-hairline focus:border-accent/50 rounded-lg text-xs font-mono font-bold text-fg outline-none transition-all"
                    :class="!row.hospital_code.trim() && i > 0 ? 'border-dashed border-hairline' : ''" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.name_zh" placeholder="耗材中文名..."
                    class="w-full px-2.5 py-1.5 bg-sunken border border-hairline focus:border-accent/50 rounded-lg text-xs text-fg outline-none transition-all" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.name_en" placeholder="English name..."
                    class="w-full px-2.5 py-1.5 bg-sunken border border-hairline focus:border-accent/50 rounded-lg text-xs text-fg outline-none transition-all" />
                </td>
                <td class="px-2 py-2">
                  <ComboInput v-model="row.purpose" :options="purposeOptions" add-label="新增類別" placeholder="止血棉..."
                    input-class="w-full px-2.5 py-1.5 bg-sunken border border-hairline focus:border-accent/50 rounded-lg text-xs text-fg outline-none transition-all" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.deptsStr" placeholder="骨科;外科"
                    class="w-full px-2.5 py-1.5 bg-sunken border border-hairline focus:border-accent/50 rounded-lg text-xs text-fg outline-none transition-all" />
                </td>
                <td class="px-2 py-2">
                  <input v-model="row.price" type="number" placeholder="0"
                    class="w-full px-2 py-1 bg-elevated border border-hairline rounded text-xs font-mono text-fg outline-none focus:border-accent/30" />
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="row.supplier" placeholder="廠商名稱"
                    class="w-full px-2 py-1 bg-elevated border border-hairline rounded text-xs text-fg outline-none focus:border-accent/30" />
                </td>
                <td class="px-2 py-1.5 text-center">
                  <button @click="removeBatchRow(i)" :disabled="batchRows.length === 1"
                    class="text-muted hover:text-danger disabled:opacity-20 text-base leading-none">×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between px-5 py-3 border-t border-hairline shrink-0">
          <button @click="addBatchRow"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated hover:bg-raised text-fg-secondary text-sm transition-colors">
            ＋ 新增一列
          </button>
          <div class="flex gap-2">
            <span class="text-xs text-muted self-center mr-2">
              {{ batchRows.filter(r=>r.hospital_code.trim()).length }} / {{ batchRows.length }} 列有效
            </span>
            <button @click="showBatchAdd = false"
              class="px-4 py-1.5 rounded-lg text-sm text-fg-secondary hover:text-fg hover:bg-elevated">取消</button>
            <button @click="saveBatchItems" :disabled="batchSaving || !batchRows.some(r=>r.hospital_code.trim())"
              class="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent disabled:opacity-40 text-white text-sm font-medium">
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
          ? 'bg-success/10 border border-success/30 text-success'
          : 'bg-danger/10 border border-danger text-danger'"
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
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-surface rounded-2xl border border-hairline shadow-2xl p-6 text-center">
        <div class="text-3xl mb-3">🗑️</div>
        <h3 class="font-semibold text-fg mb-1">確認刪除？</h3>
        <p class="text-sm text-muted mb-5">
          此操作無法復原。
        </p>
        <div class="flex gap-3 justify-center">
          <button @click="showConfirm = false"
            class="px-5 py-2 rounded-lg text-sm text-fg-secondary hover:text-fg hover:bg-elevated border border-hairline">
            取消
          </button>
          <button @click="doDelete"
            class="px-5 py-2 rounded-lg bg-danger hover:bg-danger text-white text-sm font-medium">
            確認刪除
          </button>
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

