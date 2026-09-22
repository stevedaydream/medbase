<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import * as XLSX from "xlsx";
import { getDb, dbWrite } from "@/db";
import {
  localDateKey, NP_DUTY_UPDATED_EVENT, type NpDutyAssignment,
  pushNpDutyMonth, syncNpDuty, getNpDutyUrl, saveNpDutyUrl,
} from "@/composables/useNpDuty";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { NP_WARDS, parseNpDutyWorkbook, type NpDutyImportRow, type NpDutyParseResult } from "@/utils/npDutyXlsx";
import { parseNpDutyPdf } from "@/utils/npDutyPdf";

const fileInput = ref<HTMLInputElement | null>(null);
const rosterMonth = ref(localDateKey().slice(0, 7));
const selectedFile = ref<File | null>(null);
const preview = ref<NpDutyParseResult | null>(null);
const parsing = ref(false);
const importing = ref(false);
const status = ref("");
const lastImport = ref<{ source_file: string | null; imported_at: string; count: number } | null>(null);

const previewMonths = computed(() => [...new Set((preview.value?.rows ?? []).map(row => row.dutyDate.slice(0, 7)))]);
const previewSummary = computed(() => NP_WARDS.map(ward => ({
  ward,
  count: preview.value?.rows.filter(row => row.ward === ward).length ?? 0,
})));
const previewRows = computed(() => preview.value?.rows.slice(0, 12) ?? []);
const canImport = computed(() => Boolean(preview.value?.rows.length && !preview.value.errors.length && selectedFile.value));

const cloud = useCloudSettings();
const syncing = ref(false);

onMounted(async () => {
  await cloud.load();
  await Promise.all([loadLastImport(), loadMonthRows()]);
  downloadUrl.value = await getNpDutyUrl();
});

// ── 班表下載網址 ─────────────────────────────────────────
const downloadUrl = ref("");
const urlSaved = ref(false);

async function saveUrl() {
  const url = downloadUrl.value.trim();
  if (url && !/^https?:\/\//i.test(url)) { status.value = "網址需以 http:// 或 https:// 開頭"; return; }
  try {
    await saveNpDutyUrl(cloud.gasUrl, url);
    urlSaved.value = true;
    setTimeout(() => { urlSaved.value = false; }, 1500);
  } catch (error) {
    status.value = `網址已存於本機，但上傳雲端失敗：${(error as Error).message}`;
  }
}

// ── 已匯入列表 ─────────────────────────────────────────
const monthRows = ref<NpDutyAssignment[]>([]);
const wardFilter = ref<"" | NpDutyAssignment["ward"]>("");
const filteredMonthRows = computed(() =>
  wardFilter.value ? monthRows.value.filter(r => r.ward === wardFilter.value) : monthRows.value);

async function loadMonthRows() {
  const db = await getDb();
  monthRows.value = await db.select<NpDutyAssignment[]>(
    `SELECT * FROM np_duty_assignments WHERE substr(duty_date,1,7)=?
     ORDER BY duty_date,
              CASE ward WHEN '9A' THEN 1 WHEN '9B' THEN 2 ELSE 3 END,
              CASE shift WHEN '白八' THEN 1 WHEN '夜八' THEN 2 ELSE 3 END, np_name`,
    [rosterMonth.value],
  );
}
watch(rosterMonth, loadMonthRows);

type EditForm = Pick<NpDutyAssignment, "duty_date" | "ward" | "np_name" | "staff_code" | "extension" | "shift" | "notes">;
const editingId = ref<number | "new" | null>(null);
const editForm = ref<EditForm>(emptyForm());

function emptyForm(): EditForm {
  return { duty_date: `${rosterMonth.value}-01`, ward: "9A", np_name: "", staff_code: "", extension: "", shift: "白八", notes: "" };
}

function startAdd() {
  editingId.value = "new";
  editForm.value = emptyForm();
}

function startEdit(row: NpDutyAssignment) {
  editingId.value = row.id;
  editForm.value = { duty_date: row.duty_date, ward: row.ward, np_name: row.np_name, staff_code: row.staff_code ?? "",
    extension: row.extension ?? "", shift: row.shift, notes: row.notes ?? "" };
}

async function saveEdit() {
  const f = editForm.value;
  if (!f.duty_date || !f.np_name.trim() || !f.shift.trim()) { status.value = "日期、姓名、班別為必填"; return; }
  const oldMonth = editingId.value !== "new"
    ? monthRows.value.find(r => r.id === editingId.value)?.duty_date.slice(0, 7) : undefined;
  const vals = [f.duty_date, f.ward, f.np_name.trim(), f.staff_code || null, f.extension || null, f.shift.trim(), f.notes || null];
  try {
    if (editingId.value === "new") {
      await dbWrite(
        `INSERT INTO np_duty_assignments (duty_date,ward,np_name,staff_code,extension,shift,notes,source_file,imported_at)
         VALUES (?,?,?,?,?,?,?,'手動新增',datetime('now','localtime'))`, vals);
    } else {
      await dbWrite(
        `UPDATE np_duty_assignments SET duty_date=?,ward=?,np_name=?,staff_code=?,extension=?,shift=?,notes=? WHERE id=?`,
        [...vals, editingId.value]);
    }
  } catch (error) {
    const msg = (error as Error).message ?? String(error);
    status.value = /UNIQUE/i.test(msg) ? "同一天、同病房、同班別已有此人" : `儲存失敗：${msg}`;
    return;
  }
  editingId.value = null;
  // 日期改到別的月份時，兩個月都要上傳
  await afterLocalChange([...new Set([f.duty_date.slice(0, 7), oldMonth].filter(Boolean) as string[])]);
}

async function deleteRow(row: NpDutyAssignment) {
  await dbWrite("DELETE FROM np_duty_assignments WHERE id=?", [row.id]);
  await afterLocalChange([row.duty_date.slice(0, 7)]);
}

/** 本地修改後：重新載入、通知側邊欄、整月上傳 */
async function afterLocalChange(months: string[]) {
  await loadMonthRows();
  window.dispatchEvent(new Event(NP_DUTY_UPDATED_EVENT));
  const stale: string[] = [];
  try {
    for (const m of months) if (!await pushNpDutyMonth(cloud.gasUrl, m)) stale.push(m);
    if (stale.length) {
      status.value = `雲端的 ${stale.join("、")} 已被其他電腦更新，你的修改未上傳。請按「同步雲端」取得最新版（本機這次的修改會被取代）後再修改。`;
    } else if (cloud.gasUrl) {
      status.value = `已儲存並上傳雲端（${months.join("、")}）`;
    } else {
      status.value = "已儲存（未設定 GAS，僅存本機）";
    }
  } catch (error) {
    status.value = `已儲存於本機，上傳雲端失敗：${(error as Error).message}（稍後按「同步雲端」重試）`;
  }
}

async function syncNow() {
  if (!cloud.gasUrl) { status.value = "請先在排班設定填入 GAS Web App URL"; return; }
  syncing.value = true; setGlobalSyncing("npDuty", true);
  try {
    const { downloaded, uploaded } = await syncNpDuty(cloud.gasUrl);
    await saveSyncTimestamp("npDuty");
    await Promise.all([loadMonthRows(), loadLastImport()]);
    downloadUrl.value = await getNpDutyUrl();
    const parts: string[] = [];
    if (downloaded.length) parts.push(`下載 ${downloaded.join("、")}`);
    if (uploaded.length) parts.push(`上傳 ${uploaded.join("、")}`);
    status.value = parts.length ? `同步完成：${parts.join("；")}` : "同步完成：已是最新";
  } catch (error) {
    status.value = `同步失敗：${(error as Error).message}`;
  } finally {
    syncing.value = false; setGlobalSyncing("npDuty", false);
  }
}

async function loadLastImport() {
  try {
    const db = await getDb();
    const rows = await db.select<{ source_file: string | null; imported_at: string; count: number }[]>(
      `SELECT source_file, MAX(imported_at) AS imported_at, COUNT(*) AS count
       FROM np_duty_assignments
       WHERE imported_at=(SELECT MAX(imported_at) FROM np_duty_assignments)`,
    );
    lastImport.value = rows[0]?.imported_at ? rows[0] : null;
  } catch {
    lastImport.value = null;
  }
}

function resetPreview() {
  selectedFile.value = null;
  preview.value = null;
  status.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

async function handleFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  selectedFile.value = file;
  preview.value = null;
  status.value = "";
  parsing.value = true;
  try {
    const buffer = await file.arrayBuffer();
    preview.value = file.name.toLowerCase().endsWith(".pdf")
      ? await parseNpDutyPdf(buffer, rosterMonth.value)
      : parseNpDutyWorkbook(buffer, rosterMonth.value);
    if (preview.value.errors.length) status.value = "檔案尚未通過匯入檢查";
  } catch (error) {
    preview.value = { rows: [], warnings: [], errors: [`解析失敗：${(error as Error).message}`], sheetNames: [] };
  } finally {
    parsing.value = false;
  }
}

async function confirmImport() {
  if (!canImport.value || !preview.value || !selectedFile.value) return;
  importing.value = true;
  status.value = "正在寫入值班資料…";
  const months = previewMonths.value;
  const backup: NpDutyAssignment[] = [];
  let db: Awaited<ReturnType<typeof getDb>> | null = null;

  try {
    db = await getDb();
    for (const month of months) {
      backup.push(...await db.select<NpDutyAssignment[]>(
        "SELECT * FROM np_duty_assignments WHERE substr(duty_date,1,7)=?",
        [month],
      ));
    }

    for (const month of months) {
      await db.execute("DELETE FROM np_duty_assignments WHERE substr(duty_date,1,7)=?", [month]);
    }
    for (const row of preview.value.rows) {
      await db.execute(
        `INSERT INTO np_duty_assignments
         (duty_date,ward,np_name,staff_code,extension,shift,notes,source_file,imported_at)
         VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))`,
        [row.dutyDate, row.ward, row.npName, row.staffCode || null, row.extension || null,
          row.shift, row.notes || null, selectedFile.value.name],
      );
    }

    const count = preview.value.rows.length;
    await loadLastImport();
    preview.value = null;
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = "";
    await afterLocalChange(months);
    status.value = `已匯入 ${count} 筆，更新 ${months.join("、")}｜${status.value}`;
  } catch (error) {
    if (db) {
      for (const month of months) {
        await db.execute("DELETE FROM np_duty_assignments WHERE substr(duty_date,1,7)=?", [month]);
      }
      for (const row of backup) {
        await db.execute(
          `INSERT OR REPLACE INTO np_duty_assignments
           (id,duty_date,ward,np_name,staff_code,extension,shift,notes,source_file,imported_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [row.id, row.duty_date, row.ward, row.np_name, row.staff_code, row.extension,
            row.shift, row.notes, row.source_file, row.imported_at],
        );
      }
    }
    status.value = `匯入失敗，已還原原資料：${(error as Error).message}`;
  } finally {
    importing.value = false;
  }
}

function downloadTemplate() {
  const headers = ["日期", "病房", "姓名", "代號", "分機", "班別", "備註"];
  const sample = [
    [`${rosterMonth.value}-01`, "9A", "王小明", "a", "62000", "白八", ""],
    [`${rosterMonth.value}-01`, "9A", "李小美", "b", "62001", "夜八", ""],
    [`${rosterMonth.value}-01`, "9B", "PGY 陳小華", "PGY", "62002", "值班", ""],
    [`${rosterMonth.value}-01`, "8A", "林小安", "c", "62003", "白八", ""],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  XLSX.utils.book_append_sheet(workbook, sheet, "NP值班");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `NP值班匯入範本_${rosterMonth.value}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function rowLabel(row: NpDutyImportRow) {
  return `${row.dutyDate} · ${row.ward} · ${row.shift}`;
}
</script>

<template>
  <section class="bg-surface rounded-2xl border border-hairline p-6 shadow-xl space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="text-lg">🧑‍⚕️</span>
          <h3 class="font-bold text-fg text-sm">今日值班 NP</h3>
        </div>
        <p class="mt-1 text-xs leading-relaxed text-fg-secondary">
          匯入外科秘書每月提供的 PDF 或 Excel，更新側邊欄 9A、9B、8A 值班人員。
        </p>
      </div>
      <div class="flex items-start gap-3">
        <div v-if="lastImport" class="text-right text-xs text-muted">
          <div>最近匯入：{{ lastImport.imported_at }}</div>
          <div class="max-w-72 truncate" :title="lastImport.source_file ?? ''">{{ lastImport.source_file }} · {{ lastImport.count }} 筆</div>
        </div>
        <button @click="syncNow" :disabled="syncing"
          class="shrink-0 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-xs font-bold text-accent hover:bg-accent/20 disabled:opacity-50 cursor-pointer"
          title="雲端較新的月份下載、本機較新的月份上傳">
          {{ syncing ? '同步中…' : '⇅ 同步雲端' }}
        </button>
      </div>
    </div>

    <label class="block">
      <span class="mb-1.5 block text-xs font-semibold text-fg-secondary">班表下載網址（所有電腦共用；側邊欄沒有資料時顯示下載連結）</span>
      <div class="flex gap-2">
        <input v-model="downloadUrl" type="url" placeholder="https://…" @keydown.enter="saveUrl"
          class="flex-1 rounded-xl border border-hairline bg-sunken px-3 py-2 text-xs text-fg outline-none focus:border-accent/50" />
        <button @click="saveUrl"
          class="rounded-xl border border-hairline bg-elevated px-4 py-2 text-xs font-bold hover:bg-raised cursor-pointer"
          :class="urlSaved ? 'text-success' : 'text-fg-secondary'">
          {{ urlSaved ? '✓ 已儲存' : '儲存' }}
        </button>
      </div>
    </label>

    <div class="grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-end">
      <label class="block">
        <span class="mb-1.5 block text-xs font-semibold text-fg-secondary">班表月份</span>
        <input v-model="rosterMonth" type="month" class="w-full rounded-xl border border-hairline bg-sunken px-3 py-2 text-xs text-fg outline-none focus:border-accent/50" />
      </label>
      <label class="block">
        <span class="mb-1.5 block text-xs font-semibold text-fg-secondary">班表檔案</span>
        <input ref="fileInput" type="file" accept=".pdf,.xlsx,.xls" @change="handleFile"
          class="block w-full rounded-xl border border-hairline bg-sunken px-3 py-1.5 text-xs text-fg file:mr-3 file:rounded-lg file:border-0 file:bg-accent/10 file:px-3 file:py-1.5 file:font-bold file:text-accent" />
      </label>
      <button @click="downloadTemplate" class="rounded-xl border border-hairline bg-elevated px-4 py-2 text-xs font-bold text-fg-secondary hover:bg-raised">
        下載 Excel 範本
      </button>
    </div>

    <p class="text-xs leading-relaxed text-muted">
      PDF：支援外科值班表第一頁的 9A／9B／8A 欄位，斜線前為白八、斜線後為夜八，姓名與分機由第二頁 NP 代號表解析。Excel：欄位使用日期、病房、姓名、班別，可選填代號、分機與備註。
    </p>

    <div v-if="parsing" class="rounded-xl border border-hairline bg-sunken px-4 py-3 text-xs text-muted">正在解析班表…</div>

    <div v-if="preview" class="space-y-3 border-t border-hairline pt-4">
      <div class="grid grid-cols-3 gap-2">
        <div v-for="item in previewSummary" :key="item.ward" class="rounded-xl border border-hairline bg-sunken px-3 py-2.5 text-center">
          <div class="text-xs font-bold text-accent">{{ item.ward }}</div>
          <div class="mt-0.5 text-xs text-fg-secondary">{{ item.count }} 筆班次</div>
        </div>
      </div>

      <div v-if="preview.errors.length" class="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-xs text-danger">
        <p v-for="error in preview.errors" :key="error">{{ error }}</p>
      </div>
      <div v-if="preview.warnings.length" class="rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-xs text-warning">
        <p v-for="warning in preview.warnings.slice(0, 8)" :key="warning">{{ warning }}</p>
        <p v-if="preview.warnings.length > 8">另有 {{ preview.warnings.length - 8 }} 項警告</p>
      </div>

      <div v-if="previewRows.length" class="overflow-hidden rounded-xl border border-hairline">
        <table class="w-full text-xs">
          <thead class="bg-sunken text-fg-secondary">
            <tr><th class="px-3 py-2 text-left">日期／病房／班別</th><th class="px-3 py-2 text-left">人員</th><th class="px-3 py-2 text-left">代號／分機</th></tr>
          </thead>
          <tbody class="divide-y divide-hairline">
            <tr v-for="row in previewRows" :key="`${rowLabel(row)}-${row.npName}`">
              <td class="px-3 py-2 text-fg-secondary">{{ rowLabel(row) }}</td>
              <td class="px-3 py-2 font-semibold text-fg">{{ row.npName }}</td>
              <td class="px-3 py-2 text-muted">{{ row.staffCode || '—' }}<span v-if="row.extension"> · {{ row.extension }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="preview.rows.length > previewRows.length" class="border-t border-hairline bg-sunken px-3 py-2 text-xs text-muted">
          預覽前 {{ previewRows.length }} 筆，共 {{ preview.rows.length }} 筆。
        </p>
      </div>

      <p v-if="canImport" class="text-xs text-warning">
        確認後將取代 {{ previewMonths.join('、') }} 的既有 NP 值班資料。
      </p>
      <div class="flex gap-2">
        <button @click="confirmImport" :disabled="!canImport || importing"
          class="rounded-xl border border-accent/30 bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          {{ importing ? '匯入中…' : '確認匯入' }}
        </button>
        <button @click="resetPreview" :disabled="importing" class="rounded-xl border border-hairline bg-elevated px-4 py-2 text-xs font-bold text-fg-secondary hover:bg-raised">
          取消
        </button>
      </div>
    </div>

    <div v-if="status" class="rounded-xl border border-hairline bg-sunken px-4 py-3 text-xs text-fg-secondary">{{ status }}</div>

    <!-- 已匯入列表（依上方「班表月份」） -->
    <div class="space-y-3 border-t border-hairline pt-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="text-xs font-bold text-fg">{{ rosterMonth }} 已匯入 · {{ monthRows.length }} 筆</h4>
        <div class="flex items-center gap-1.5">
          <button v-for="w in (['', '9A', '9B', '8A'] as const)" :key="w" @click="wardFilter = w"
            class="rounded-full border px-2.5 py-0.5 text-2xs font-bold cursor-pointer"
            :class="wardFilter === w ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'">
            {{ w || '全部' }}
          </button>
          <button @click="startAdd" :disabled="editingId !== null"
            class="ml-2 rounded-xl border border-accent/30 bg-accent px-3 py-1 text-xs font-bold text-white disabled:opacity-40 cursor-pointer">
            ＋ 新增
          </button>
        </div>
      </div>

      <div class="overflow-hidden rounded-xl border border-hairline">
        <table class="w-full text-xs">
          <thead class="bg-sunken text-fg-secondary">
            <tr>
              <th class="px-2 py-2 text-left">日期</th><th class="px-2 py-2 text-left">病房</th><th class="px-2 py-2 text-left">班別</th>
              <th class="px-2 py-2 text-left">姓名</th><th class="px-2 py-2 text-left">代號</th><th class="px-2 py-2 text-left">分機</th>
              <th class="px-2 py-2 text-left">備註</th><th class="px-2 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-hairline">
            <template v-for="row in (editingId === 'new' ? [null, ...filteredMonthRows] : filteredMonthRows)" :key="row?.id ?? 'new'">
              <tr v-if="row === null || editingId === row.id" class="bg-accent/5">
                <td class="px-1 py-1"><input v-model="editForm.duty_date" type="date" class="w-full rounded border border-hairline bg-sunken px-1.5 py-1 text-fg" /></td>
                <td class="px-1 py-1">
                  <select v-model="editForm.ward" class="rounded border border-hairline bg-sunken px-1 py-1 text-fg">
                    <option v-for="w in NP_WARDS" :key="w" :value="w">{{ w }}</option>
                  </select>
                </td>
                <td class="px-1 py-1"><input v-model="editForm.shift" list="np-shift-options" class="w-16 rounded border border-hairline bg-sunken px-1.5 py-1 text-fg" /></td>
                <td class="px-1 py-1"><input v-model="editForm.np_name" class="w-full rounded border border-hairline bg-sunken px-1.5 py-1 text-fg" /></td>
                <td class="px-1 py-1"><input v-model="editForm.staff_code" class="w-14 rounded border border-hairline bg-sunken px-1.5 py-1 text-fg" /></td>
                <td class="px-1 py-1"><input v-model="editForm.extension" class="w-20 rounded border border-hairline bg-sunken px-1.5 py-1 text-fg" /></td>
                <td class="px-1 py-1"><input v-model="editForm.notes" class="w-full rounded border border-hairline bg-sunken px-1.5 py-1 text-fg" /></td>
                <td class="px-1 py-1 whitespace-nowrap text-right">
                  <button @click="saveEdit" class="rounded px-2 py-1 font-bold text-accent hover:bg-accent/10 cursor-pointer">儲存</button>
                  <button @click="editingId = null" class="rounded px-2 py-1 text-muted hover:bg-raised cursor-pointer">取消</button>
                </td>
              </tr>
              <tr v-else>
                <td class="px-2 py-1.5 tabular-nums text-fg-secondary">{{ row.duty_date.slice(5) }}</td>
                <td class="px-2 py-1.5 font-bold text-accent">{{ row.ward }}</td>
                <td class="px-2 py-1.5 text-fg-secondary">{{ row.shift }}</td>
                <td class="px-2 py-1.5 font-semibold text-fg">{{ row.np_name }}</td>
                <td class="px-2 py-1.5 text-muted">{{ row.staff_code || '—' }}</td>
                <td class="px-2 py-1.5 tabular-nums text-muted">{{ row.extension || '—' }}</td>
                <td class="px-2 py-1.5 text-muted truncate max-w-40" :title="row.notes ?? ''">{{ row.notes || '' }}</td>
                <td class="px-1 py-1.5 whitespace-nowrap text-right">
                  <button @click="startEdit(row)" :disabled="editingId !== null" class="rounded px-2 py-0.5 text-fg-secondary hover:bg-raised disabled:opacity-30 cursor-pointer">編輯</button>
                  <button @click="deleteRow(row)" :disabled="editingId !== null" class="rounded px-2 py-0.5 text-danger hover:bg-danger/10 disabled:opacity-30 cursor-pointer">刪除</button>
                </td>
              </tr>
            </template>
            <tr v-if="!filteredMonthRows.length && editingId !== 'new'">
              <td colspan="8" class="px-3 py-6 text-center text-muted">此月份尚無資料</td>
            </tr>
          </tbody>
        </table>
      </div>
      <datalist id="np-shift-options"><option value="白八" /><option value="夜八" /><option value="值班" /></datalist>
    </div>
  </section>
</template>
