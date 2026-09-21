<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as XLSX from "xlsx";
import { getDb } from "@/db";
import { localDateKey, NP_DUTY_UPDATED_EVENT, type NpDutyAssignment } from "@/composables/useNpDuty";
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

onMounted(loadLastImport);

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

    status.value = `已匯入 ${preview.value.rows.length} 筆，更新 ${months.join("、")}`;
    window.dispatchEvent(new Event(NP_DUTY_UPDATED_EVENT));
    await loadLastImport();
    preview.value = null;
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = "";
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
      <div v-if="lastImport" class="text-right text-xs text-muted">
        <div>最近匯入：{{ lastImport.imported_at }}</div>
        <div class="max-w-72 truncate" :title="lastImport.source_file ?? ''">{{ lastImport.source_file }} · {{ lastImport.count }} 筆</div>
      </div>
    </div>

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
  </section>
</template>
