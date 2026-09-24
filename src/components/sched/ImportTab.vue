<script setup lang="ts">
import { ref, computed } from "vue";
import * as XLSX from "xlsx";
import { readFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { monthSheets } from "@/utils/sched/excelImport";
import { importFromWorkbook, clearSchedLocal } from "@/composables/useSchedStore";
import type { ImportReport } from "@/utils/sched/importApply";

const emit = defineEmits<{ toast: [msg: string] }>();

const fileName = ref("");
const wb = ref<XLSX.WorkBook | null>(null);
const sheets = ref<string[]>([]);
const baseSheet = ref<string | null>(null);
const extras = ref<string[]>([]);
const busy = ref(false);
const report = ref<ImportReport | null>(null);
const error = ref("");

const clearText = ref("");
async function onClear() {
  if (clearText.value !== "清除排班資料") return;
  try {
    busy.value = true;
    await clearSchedLocal();
    clearText.value = "";
    report.value = null;
    emit("toast", "已清除本機排班 v3 資料");
  } catch (e) {
    error.value = `清除失敗：${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}

const extraCandidates = computed(() => sheets.value.filter(s => baseSheet.value && s > baseSheet.value));

async function pickFile() {
  error.value = "";
  report.value = null;
  const picked = await openDialog({ multiple: false, filters: [{ name: "Excel", extensions: ["xls", "xlsx", "xlsm"] }] });
  if (!picked || Array.isArray(picked)) return;
  try {
    busy.value = true;
    const data = await readFile(picked);
    wb.value = XLSX.read(data);
    fileName.value = picked.split(/[\\/]/).pop() ?? picked;
    sheets.value = monthSheets(wb.value);
    baseSheet.value = sheets.value.includes("202610") ? "202610" : sheets.value[sheets.value.length - 1] ?? null;
    extras.value = [];
  } catch (e) {
    error.value = `讀取失敗：${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}

function toggleExtra(s: string) {
  extras.value = extras.value.includes(s) ? extras.value.filter(x => x !== s) : [...extras.value, s].sort();
}

async function runImport() {
  if (!wb.value || !baseSheet.value) return;
  error.value = "";
  try {
    busy.value = true;
    report.value = await importFromWorkbook(wb.value, baseSheet.value, extras.value.filter(s => s > baseSheet.value!));
    emit("toast", "匯入完成");
  } catch (e) {
    error.value = `匯入失敗：${(e as Error).message}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="p-5 max-w-3xl space-y-5 overflow-y-auto h-full">
    <section class="space-y-2">
      <h2 class="text-sm font-semibold text-fg">從醫院 Excel 匯入</h2>
      <p class="text-xs text-muted leading-relaxed">
        起點月份完整匯入（人員順序與旗標、V/X、人力、國假、預班區、排班區），視為已發布，並一併匯入「8-4輪值」工作表。
        其後的月份只匯入預班區與國假註記。可重複匯入：以姓名比對既有人員，同月份文件會被取代。
      </p>
      <div class="flex items-center gap-2">
        <button class="text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-50"
          :disabled="busy" @click="pickFile">選擇 Excel 檔…</button>
        <span class="text-xs text-fg-secondary truncate">{{ fileName }}</span>
      </div>
    </section>

    <section v-if="sheets.length" class="space-y-3">
      <div>
        <div class="text-xs text-fg-secondary mb-1">起點月份（完整匯入）</div>
        <div class="flex flex-wrap gap-1">
          <button v-for="s in sheets" :key="s"
            class="text-xs px-2 py-1 rounded border"
            :class="baseSheet === s ? 'bg-accent text-white border-accent' : 'border-hairline text-fg-secondary hover:bg-elevated'"
            @click="baseSheet = s; extras = extras.filter(x => x > s)">{{ s }}</button>
        </div>
      </div>
      <div>
        <div class="text-xs text-fg-secondary mb-1">之後的月份（只匯入預班與國假）</div>
        <div v-if="extraCandidates.length" class="flex flex-wrap gap-1">
          <button v-for="s in extraCandidates" :key="s"
            class="text-xs px-2 py-1 rounded border"
            :class="extras.includes(s) ? 'bg-accent text-white border-accent' : 'border-hairline text-fg-secondary hover:bg-elevated'"
            @click="toggleExtra(s)">{{ s }}</button>
        </div>
        <div v-else class="text-xs text-muted">此檔案在起點之後沒有月份分頁</div>
      </div>
      <button class="text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-50"
        :disabled="busy || !baseSheet" @click="runImport">
        {{ busy ? "匯入中…" : "開始匯入" }}
      </button>
    </section>

    <div v-if="error" class="text-xs text-danger">{{ error }}</div>

    <section class="space-y-2 text-xs border-t border-hairline pt-4">
      <h2 class="text-sm font-semibold text-fg">清除本機排班資料</h2>
      <p class="text-muted">刪除這台電腦上全部排班 v3 文件（人員、設定、月份、預班、紀錄），通常在重新匯入前使用。雲端資料不受影響；已同步的電腦會在下次同步時重新下載雲端版本。</p>
      <div class="flex items-center gap-2">
        <input v-model="clearText" placeholder="輸入「清除排班資料」" class="sched-input w-44" />
        <button class="px-3 py-1 rounded border border-danger text-danger hover:bg-danger/10 disabled:opacity-40"
          :disabled="busy || clearText !== '清除排班資料'" @click="onClear">清除</button>
      </div>
    </section>

    <section v-if="report" class="space-y-2 text-xs">
      <h3 class="font-semibold text-fg">匯入結果</h3>
      <div class="text-fg-secondary">新增人員 {{ report.created.length }} 位、更新 {{ report.updated.length }} 位</div>
      <div v-if="report.created.length" class="text-muted">新增：{{ report.created.join("、") }}</div>
      <div v-if="report.noHis.length" class="text-warning">沒有 HIS 帳號（無法登入，請到人員名單補上）：{{ report.noHis.join("、") }}</div>
      <div v-if="report.unmatchedLegacy.length" class="text-warning">
        舊排班帳號配不到人員（請手動處理）：{{ report.unmatchedLegacy.join("、") }}
      </div>
      <ul v-if="report.warnings.length" class="list-disc pl-5 text-warning space-y-0.5">
        <li v-for="(w, i) in report.warnings" :key="i">{{ w }}</li>
      </ul>
    </section>
  </div>
</template>
