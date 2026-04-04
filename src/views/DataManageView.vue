<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { getDb } from "@/db";
import * as XLSX from "xlsx";

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
type Tab = "items" | "physicians";

// ── 狀態 ────────────────────────────────────────────────────────
const activeTab   = ref<Tab>("items");
const search      = ref("");

// 資料
const items       = ref<Item[]>([]);
const physicians  = ref<Physician[]>([]);

// Modal
const showModal   = ref(false);
const modalMode   = ref<"add" | "edit">("add");
const deleteTarget = ref<Item | Physician | null>(null);
const showConfirm  = ref(false);

// 表單暫存
const itemForm   = ref<Partial<Item>>({});
const physForm   = ref<Partial<Physician>>({});

// ── Toast ────────────────────────────────────────────────────────
interface Toast { type: "success" | "error"; msg: string; }
const toast = ref<Toast | null>(null);
function showToast(type: Toast["type"], msg: string) {
  toast.value = { type, msg };
  setTimeout(() => { toast.value = null; }, 3500);
}

// ── 匯入 XLSX ────────────────────────────────────────────────────
interface ImportResult { sheet: string; upserted: number; skipped: number; }
const importing     = ref(false);
const importResults = ref<ImportResult[] | null>(null);
const xlsxInput     = ref<HTMLInputElement | null>(null);

function n(v: any): any { return (v === undefined || v === "" || v === null) ? null : v; }
function isNum(v: any): v is number { return typeof v === "number" && isFinite(v); }

async function handleXlsx(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  importing.value = true;
  importResults.value = null;

  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: "array" });
    const db  = await getDb();
    const results: ImportResult[] = [];

    function rows(sheet: string): Record<string, any>[] {
      const ws = wb.Sheets[sheet];
      return ws ? XLSX.utils.sheet_to_json<Record<string, any>>(ws) : [];
    }

    // ① departments
    {
      let ok = 0, skip = 0;
      for (const r of rows("departments")) {
        if (!r.name || typeof r.name !== "string" || r.name.startsWith("★")) { skip++; continue; }
        if (isNum(r.id)) {
          await db.execute("INSERT OR REPLACE INTO departments (id, name) VALUES (?,?)", [r.id, r.name]);
        } else {
          await db.execute("INSERT OR IGNORE INTO departments (name) VALUES (?)", [r.name]);
        }
        ok++;
      }
      results.push({ sheet: "科別", upserted: ok, skipped: skip });
    }

    // ② doctors（FK → departments）
    {
      let ok = 0, skip = 0;
      for (const r of rows("doctors")) {
        if (!r.name || typeof r.name !== "string" || r.name.startsWith("★")) { skip++; continue; }
        if (isNum(r.id)) {
          await db.execute(
            "INSERT OR REPLACE INTO doctors (id, name, department_id) VALUES (?,?,?)",
            [r.id, r.name, n(r.department_id)]);
        } else {
          await db.execute(
            "INSERT OR IGNORE INTO doctors (name, department_id) VALUES (?,?)",
            [r.name, n(r.department_id)]);
        }
        ok++;
      }
      results.push({ sheet: "醫師(VS)", upserted: ok, skipped: skip });
    }

    // ③ items
    {
      let ok = 0, skip = 0;
      for (const r of rows("items")) {
        const code = r.hospital_code;
        if (!code || typeof code !== "string" || code.startsWith("★")) { skip++; continue; }
        await db.execute(
          `INSERT OR REPLACE INTO items
           (hospital_code,name_en,name_zh,purpose,unit,price,supplier,notes)
           VALUES (?,?,?,?,?,?,?,?)`,
          [code, n(r.name_en), n(r.name_zh), n(r.purpose ?? r.category),
           n(r.unit), n(r.price), n(r.supplier), n(r.notes)]);
        // item_depts：depts 欄位用分號分隔，如「骨科;一般外科」
        if (r.depts && typeof r.depts === "string") {
          await db.execute("DELETE FROM item_depts WHERE hospital_code=?", [code]);
          for (const dept of r.depts.split(";").map((d:string)=>d.trim()).filter(Boolean)) {
            await db.execute(
              "INSERT OR IGNORE INTO item_depts (hospital_code, dept) VALUES (?,?)",
              [code, dept]);
          }
        }
        ok++;
      }
      results.push({ sheet: "自費品項", upserted: ok, skipped: skip });
    }

    // ④ sets（FK → doctors, departments）
    {
      let ok = 0, skip = 0;
      for (const r of rows("sets")) {
        if (!isNum(r.id) || !r.name) { skip++; continue; }
        await db.execute(
          `INSERT OR REPLACE INTO sets (id,name,surgery_type,doctor_id,department_id,notes)
           VALUES (?,?,?,?,?,?)`,
          [r.id, r.name, n(r.surgery_type), n(r.doctor_id), n(r.department_id), n(r.notes)]);
        ok++;
      }
      results.push({ sheet: "套組", upserted: ok, skipped: skip });
    }

    // ⑤ set_items（FK → sets）
    {
      let ok = 0, skip = 0;
      for (const r of rows("set_items")) {
        if (!isNum(r.id) || !isNum(r.set_id)) { skip++; continue; }
        await db.execute(
          `INSERT OR REPLACE INTO set_items
           (id,set_id,hospital_code,quantity,is_optional,sort_order,price,notes)
           VALUES (?,?,?,?,?,?,?,?)`,
          [r.id, r.set_id, n(r.hospital_code),
           n(r.quantity) ?? 1, n(r.is_optional) ?? 0, n(r.sort_order) ?? r.id ?? 0,
           n(r.price), n(r.notes)]);
        ok++;
      }
      results.push({ sheet: "套組品項", upserted: ok, skipped: skip });
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

// ── 匯出完整資料庫 ────────────────────────────────────────────────
const exportingFull = ref(false);
async function exportFullDb() {
  exportingFull.value = true;
  try {
    const db = await getDb();
    const tables = [
      "medications", "prescriptions", "surgery", "disease", "examination",
      "items", "item_depts", "sets", "set_items", "physicians",
      "emergency_protocols", "app_settings", "scheduler_users",
      "ahk_scripts", "ahk_groups", "ahk_group_scripts", "contacts",
      "acp_sets", "acp_items", "acp_records"
    ];

    const wb = XLSX.utils.book_new();
    for (const table of tables) {
      try {
        const data = await db.select<any[]>(`SELECT * FROM ${table}`);
        if (data && data.length > 0) {
          const ws = XLSX.utils.json_to_sheet(data);
          XLSX.utils.book_append_sheet(wb, ws, table.substring(0, 31));
        }
      } catch (e) {
        console.warn(`Export table ${table} failed:`, e);
      }
    }

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `medbase_full_backup_${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "完整資料庫匯出完成！");
  } catch (err: any) {
    showToast("error", `匯出失敗：${err?.message ?? err}`);
  } finally {
    exportingFull.value = false;
  }
}

// ── 匯入完整資料庫 ────────────────────────────────────────────────
const importingFull = ref(false);
const fullImportInput = ref<HTMLInputElement | null>(null);

async function handleFullImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!confirm("警告：匯入完整資料庫將會覆蓋現有資料（以 ID/主鍵對應），確定繼續？")) {
    if (fullImportInput.value) fullImportInput.value.value = "";
    return;
  }

  importingFull.value = true;
  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: "array" });
    const db  = await getDb();

    let totalUpserted = 0;
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<any>(ws);
      if (data.length === 0) continue;

      // 取得欄位名稱
      const columns = Object.keys(data[0]);
      const placeholders = columns.map(() => "?").join(",");
      const colNames = columns.join(",");

      for (const row of data) {
        const values = columns.map(col => {
          const val = row[col];
          return (val === "" || val === undefined) ? null : val;
        });
        await db.execute(
          `INSERT OR REPLACE INTO ${sheetName} (${colNames}) VALUES (${placeholders})`,
          values
        );
        totalUpserted++;
      }
    }

    await loadAll();
    showToast("success", `完整匯入完成！共更新 ${totalUpserted} 筆資料。`);
  } catch (err: any) {
    showToast("error", `匯入失敗：${err?.message ?? err}`);
  } finally {
    importingFull.value = false;
    if (fullImportInput.value) fullImportInput.value.value = "";
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
}
onMounted(loadAll);

// 切 tab 時重置搜尋
watch(activeTab, () => { search.value = ""; });

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

// ── Modal 開關 ───────────────────────────────────────────────────
function openAdd() {
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
  const db = await getDb();
  const f  = itemForm.value;
  if (!f.hospital_code?.trim()) return;
  if (modalMode.value === "add") {
    await db.execute(
      `INSERT OR IGNORE INTO items (hospital_code,name_en,name_zh,purpose,unit,price,supplier,notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [f.hospital_code, f.name_en||null, f.name_zh||null, f.purpose||null,
       f.unit||null, f.price??null, f.supplier||null, f.notes||null]);
  } else {
    await db.execute(
      `UPDATE items SET name_en=?,name_zh=?,purpose=?,unit=?,price=?,supplier=?,notes=?
       WHERE hospital_code=?`,
      [f.name_en||null, f.name_zh||null, f.purpose||null,
       f.unit||null, f.price??null, f.supplier||null, f.notes||null, f.hospital_code]);
  }
  // 同步 item_depts
  const depts: string[] = (f as any).depts ?? [];
  await db.execute("DELETE FROM item_depts WHERE hospital_code=?", [f.hospital_code]);
  for (const dept of depts) {
    await db.execute("INSERT OR IGNORE INTO item_depts (hospital_code,dept) VALUES (?,?)", [f.hospital_code, dept]);
  }
  closeModal(); await loadAll();
}
async function deleteItem(row: Item) {
  const db = await getDb();
  await db.execute("DELETE FROM items WHERE hospital_code=?", [row.hospital_code]);
  await loadAll();
}

// ── CRUD：physicians ─────────────────────────────────────────────
async function savePhysician() {
  const db = await getDb();
  const f  = physForm.value;
  if (!f.name?.trim()) return;
  if (modalMode.value === "add") {
    await db.execute(
      `INSERT INTO physicians (name,department,title,ext,his_account,his_password,phs_account,phs_password,notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [f.name, f.department||null, f.title||null, f.ext||null,
       f.his_account||null, f.his_password||null,
       f.phs_account||null, f.phs_password||null, f.notes||null]);
  } else {
    await db.execute(
      `UPDATE physicians SET name=?,department=?,title=?,ext=?,his_account=?,his_password=?,
       phs_account=?,phs_password=?,notes=? WHERE id=?`,
      [f.name, f.department||null, f.title||null, f.ext||null,
       f.his_account||null, f.his_password||null,
       f.phs_account||null, f.phs_password||null, f.notes||null, f.id]);
  }
  closeModal(); await loadAll();
}
async function deletePhysician(row: Physician) {
  const db = await getDb();
  await db.execute("DELETE FROM physicians WHERE id=?", [row.id]);
  await loadAll();
}

// ── 確認刪除 ─────────────────────────────────────────────────────
function confirmDelete(row: Item | Physician) { deleteTarget.value = row; showConfirm.value = true; }
async function doDelete() {
  const row = deleteTarget.value;
  if (!row) return;
  if (activeTab.value === "items")      await deleteItem(row as Item);
  if (activeTab.value === "physicians") await deletePhysician(row as Physician);
  showConfirm.value = false; deleteTarget.value = null;
}

const tabs: { key: Tab; icon: string; label: string; count: () => number }[] = [
  { key: "items",      icon: "📦",  label: "自費品項",   count: () => items.value.length },
  { key: "physicians", icon: "👨‍⚕️", label: "醫師通訊錄", count: () => physicians.value.length },
];
</script>

<template>
  <div class="flex h-full gap-0 overflow-hidden">

    <!-- ── 左側 Tab 列 ──────────────────────────────── -->
    <div class="flex flex-col w-44 shrink-0 border-r border-gray-800 bg-gray-950 py-3 gap-0.5 px-2">
      <button
        v-for="tab in tabs" :key="tab.key"
        @click="activeTab = tab.key"
        class="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-left"
        :class="activeTab === tab.key
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'"
      >
        <span class="flex items-center gap-2">
          <span class="text-base leading-none">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </span>
        <span class="text-[11px] font-mono text-gray-600">{{ tab.count() }}</span>
      </button>

      <div class="mt-auto pt-4 border-t border-gray-800 flex flex-col gap-2">
        <button
          @click="exportFullDb"
          :disabled="exportingFull"
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors text-gray-400 hover:bg-gray-800 hover:text-blue-400 disabled:opacity-40"
        >
          <span>{{ exportingFull ? '⌛' : '📤' }}</span>
          <span>完整備份 (XLSX)</span>
        </button>
        <label
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors text-gray-400 hover:bg-gray-800 hover:text-emerald-400 cursor-pointer"
          :class="{ 'opacity-40 cursor-wait': importingFull }"
        >
          <span>{{ importingFull ? '⌛' : '📥' }}</span>
          <span>完整匯入 (XLSX)</span>
          <input ref="fullImportInput" type="file" accept=".xlsx" class="hidden"
            :disabled="importingFull" @change="handleFullImport" />
        </label>
      </div>
    </div>

    <!-- ── 右側內容 ─────────────────────────────────── -->
    <div class="flex flex-col flex-1 overflow-hidden">

      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-800 shrink-0">
        <input
          v-model="search"
          :placeholder="`搜尋${tabs.find(t=>t.key===activeTab)?.label}…`"
          class="flex-1 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <!-- 匯入 XLSX -->
        <label
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 cursor-pointer"
          :class="importing
            ? 'bg-gray-700 text-gray-400 cursor-wait'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-200'"
        >
          <span class="text-base leading-none">{{ importing ? "⏳" : "📥" }}</span>
          {{ importing ? "匯入中…" : "匯入 XLSX" }}
          <input ref="xlsxInput" type="file" accept=".xlsx,.xls" class="hidden"
            :disabled="importing" @change="handleXlsx" />
        </label>
        <button
          @click="openAdd"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors shrink-0"
        >
          <span class="text-base leading-none">＋</span> 新增
        </button>
      </div>

      <!-- 匯入結果摘要 -->
      <Transition name="slide-down">
        <div v-if="importResults"
          class="flex items-center gap-4 px-5 py-2 bg-gray-800/60 border-b border-gray-700 shrink-0 text-xs">
          <span class="text-gray-400 font-medium">匯入結果：</span>
          <span v-for="r in importResults" :key="r.sheet"
            class="flex items-center gap-1 text-gray-300">
            <span class="text-green-400 font-mono">+{{ r.upserted }}</span>
            {{ r.sheet }}
            <span v-if="r.skipped" class="text-gray-600">（略過 {{ r.skipped }}）</span>
            <span class="text-gray-700 last:hidden">·</span>
          </span>
          <button @click="importResults = null" class="ml-auto text-gray-600 hover:text-gray-400">×</button>
        </div>
      </Transition>

      <!-- ── 自費品項 表格 ─────────────────────────── -->
      <div v-if="activeTab === 'items'" class="flex-1 overflow-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-gray-900 z-10">
            <tr class="border-b border-gray-800 text-gray-500 text-xs">
              <th class="text-left px-4 py-3 font-medium">院內碼</th>
              <th class="text-left px-4 py-3 font-medium">中文品名</th>
              <th class="text-left px-4 py-3 font-medium">用途</th>
              <th class="text-left px-4 py-3 font-medium">適用科別</th>
              <th class="text-right px-4 py-3 font-medium">價格</th>
              <th class="text-left px-4 py-3 font-medium">廠商</th>
              <th class="w-20 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredItems.length === 0">
              <td colspan="7" class="text-center text-gray-600 py-12">無資料</td>
            </tr>
            <tr v-for="m in filteredItems" :key="m.hospital_code"
              class="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td class="px-4 py-2 text-gray-400 font-mono text-xs">{{ m.hospital_code }}</td>
              <td class="px-4 py-2 text-gray-200">{{ m.name_zh || m.name_en || "—" }}</td>
              <td class="px-4 py-2 text-xs">
                <span v-if="m.purpose" class="bg-teal-900/40 text-teal-300 px-1.5 py-0.5 rounded-full text-[11px]">{{ m.purpose }}</span>
                <span v-else class="text-gray-600">—</span>
              </td>
              <td class="px-4 py-2 text-xs">
                <div class="flex flex-wrap gap-1">
                  <span v-for="d in m.depts" :key="d" class="bg-cyan-900/30 text-cyan-400 px-1.5 py-0.5 rounded text-[11px]">{{ d }}</span>
                  <span v-if="!m.depts.length" class="text-gray-600">—</span>
                </div>
              </td>
              <td class="px-4 py-2 text-right text-green-400 font-mono text-xs">
                {{ m.price ? `$${m.price.toLocaleString()}` : "—" }}</td>
              <td class="px-4 py-2 text-gray-500 text-xs">{{ m.supplier || "—" }}</td>
              <td class="px-4 py-2">
                <div class="flex gap-2 justify-end">
                  <button @click="openEdit(m)" class="text-xs text-blue-400 hover:text-blue-300">編輯</button>
                  <button @click="confirmDelete(m)" class="text-xs text-red-500 hover:text-red-400">刪除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── 醫師通訊錄 表格 ───────────────────────── -->
      <div v-if="activeTab === 'physicians'" class="flex-1 overflow-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-gray-900 z-10">
            <tr class="border-b border-gray-800 text-gray-500 text-xs">
              <th class="text-left px-4 py-3 font-medium">姓名</th>
              <th class="text-left px-4 py-3 font-medium">科別</th>
              <th class="text-left px-4 py-3 font-medium">職稱</th>
              <th class="text-left px-4 py-3 font-medium">分機</th>
              <th class="text-left px-4 py-3 font-medium">HIS 帳號</th>
              <th class="text-left px-4 py-3 font-medium">PHS 帳號</th>
              <th class="w-20 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredPhysicians.length === 0">
              <td colspan="7" class="text-center text-gray-600 py-12">無資料，請新增醫師</td>
            </tr>
            <tr v-for="p in filteredPhysicians" :key="p.id"
              class="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td class="px-4 py-2 text-gray-200 font-medium">{{ p.name }}</td>
              <td class="px-4 py-2 text-gray-400 text-xs">{{ p.department || "—" }}</td>
              <td class="px-4 py-2 text-gray-400 text-xs">{{ p.title || "—" }}</td>
              <td class="px-4 py-2 text-blue-400 font-mono text-xs">{{ p.ext || "—" }}</td>
              <td class="px-4 py-2 text-gray-400 font-mono text-xs">{{ p.his_account || "—" }}</td>
              <td class="px-4 py-2 text-gray-400 font-mono text-xs">{{ p.phs_account || "—" }}</td>
              <td class="px-4 py-2">
                <div class="flex gap-2 justify-end">
                  <button @click="openEdit(p)" class="text-xs text-blue-400 hover:text-blue-300">編輯</button>
                  <button @click="confirmDelete(p)" class="text-xs text-red-500 hover:text-red-400">刪除</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div><!-- /右側 -->
  </div><!-- /外層 -->

  <!-- ════════════════════════════════════════════════
       Modal 容器
  ════════════════════════════════════════════════ -->
  <Teleport to="body">
    <div v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="closeModal">

      <!-- ── 自費品項 Modal ─────────────────────── -->
      <div v-if="activeTab === 'items'"
        class="w-full max-w-lg bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 class="font-semibold text-gray-100">{{ modalMode === "add" ? "新增" : "編輯" }}品項</h3>
          <button @click="closeModal" class="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        <div class="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-500 mb-1 block">院內碼 *</label>
              <input v-model="itemForm.hospital_code" :disabled="modalMode==='edit'"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-40"
                placeholder="M1A01234" />
            </div>
            <div>
              <label class="text-xs text-gray-500 mb-1 block">單位</label>
              <input v-model="itemForm.unit"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                placeholder="個" />
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">中文品名</label>
            <input v-model="itemForm.name_zh"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
              placeholder="中文品名" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">英文品名</label>
            <input v-model="itemForm.name_en"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
              placeholder="English Name" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">用途</label>
            <input v-model="itemForm.purpose"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-teal-500"
              placeholder="止血劑 / Mesh人工網膜 / 骨板…" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">適用科別（用分號分隔多科，如：骨科;一般外科）</label>
            <input
              :value="(itemForm as any).depts?.join(';') ?? ''"
              @input="(itemForm as any).depts = ($event.target as HTMLInputElement).value.split(';').map((s:string)=>s.trim()).filter(Boolean)"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-cyan-500"
              placeholder="骨科;一般外科;泌尿科" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-500 mb-1 block">自費金額</label>
              <input v-model.number="itemForm.price" type="number"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                placeholder="0" />
            </div>
            <div>
              <label class="text-xs text-gray-500 mb-1 block">廠商</label>
              <input v-model="itemForm.supplier"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">備註</label>
            <textarea v-model="itemForm.notes" rows="2"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button @click="closeModal" class="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800">取消</button>
          <button @click="saveItem" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">儲存</button>
        </div>
      </div>

      <!-- ── 醫師通訊錄 Modal ───────────────────── -->
      <div v-if="activeTab === 'physicians'"
        class="w-full max-w-lg bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 class="font-semibold text-gray-100">{{ modalMode === "add" ? "新增" : "編輯" }}醫師</h3>
          <button @click="closeModal" class="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        <div class="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-500 mb-1 block">姓名 *</label>
              <input v-model="physForm.name"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                placeholder="王大明" />
            </div>
            <div>
              <label class="text-xs text-gray-500 mb-1 block">科別</label>
              <input v-model="physForm.department"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                placeholder="骨科" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-500 mb-1 block">職稱</label>
              <input v-model="physForm.title"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                placeholder="主治醫師" />
            </div>
            <div>
              <label class="text-xs text-gray-500 mb-1 block">分機</label>
              <input v-model="physForm.ext"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
                placeholder="1234" />
            </div>
          </div>
          <div class="border-t border-gray-800 pt-3">
            <p class="text-xs text-gray-600 mb-2">系統帳號（選填）</p>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs text-gray-500 mb-1 block">HIS 帳號</label>
                <input v-model="physForm.his_account"
                  class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 font-mono" />
              </div>
              <div>
                <label class="text-xs text-gray-500 mb-1 block">HIS 密碼</label>
                <input v-model="physForm.his_password" type="password"
                  class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 font-mono" />
              </div>
              <div>
                <label class="text-xs text-gray-500 mb-1 block">PHS 帳號</label>
                <input v-model="physForm.phs_account"
                  class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 font-mono" />
              </div>
              <div>
                <label class="text-xs text-gray-500 mb-1 block">PHS 密碼</label>
                <input v-model="physForm.phs_password" type="password"
                  class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 font-mono" />
              </div>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">備註</label>
            <textarea v-model="physForm.notes" rows="2"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button @click="closeModal" class="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800">取消</button>
          <button @click="savePhysician" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">儲存</button>
        </div>
      </div>

    </div>
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
</template>
