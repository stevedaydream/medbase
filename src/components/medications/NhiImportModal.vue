<script setup lang="ts">
/**
 * 健保藥典 / TFDA Excel 匯入
 *
 * 支援的來源格式：
 *  1. 健保署「健保用藥品項」Excel（每季公布）
 *     常見欄位：藥品代碼、中文品名、英文品名、學名、劑型、含量規格、健保價、廠商名稱
 *  2. 食藥署開放資料匯出 Excel
 *     常見欄位：許可證字號、中文品名、英文品名、藥品類別、劑型、有效成分
 *  3. 自訂格式（手動對應欄位）
 *
 * 下載來源（請自行至官方網站下載最新版本）：
 *  - 健保署藥品給付：https://www.nhi.gov.tw → 醫事機構專區 → 藥品給付規定
 *  - 食藥署開放資料：https://data.fda.gov.tw → 藥品
 *  - 政府開放資料：https://data.gov.tw → 搜尋「西藥許可證」
 */

import { ref } from "vue";
import * as XLSX from "xlsx";

interface RowPreview { [key: string]: string }

interface FieldMapping {
  name: string;
  generic_name: string;
  synonyms: string;
  category: string;
  route: string;
  dose: string;
  warnings: string;
  notes: string;
}

const emit = defineEmits<{ imported: [rows: RowPreview[]]; close: [] }>();

const step = ref<"upload" | "map" | "preview">("upload");
const headers = ref<string[]>([]);
const previewRows = ref<RowPreview[]>([]);
const allRows = ref<RowPreview[]>([]);
const fileName = ref("");

// Known NHI/TFDA column name patterns → our field
const AUTO_DETECT: Record<keyof FieldMapping, string[]> = {
  name:         ["中文品名", "品名", "藥品名稱", "藥名", "名稱", "中文名稱"],
  generic_name: ["學名", "英文品名", "英文名稱", "generic", "active ingredient", "有效成分", "成分"],
  synonyms:     ["別名", "商品名", "同義詞", "品牌名", "商標名"],
  category:     ["藥品類別", "分類", "類別", "ATC碼", "ATC分類"],
  route:        ["給藥途徑", "劑型", "用法", "途徑", "route"],
  dose:         ["含量規格", "含量", "規格", "劑量", "strength"],
  warnings:     ["備註", "給付備註", "給付規定", "注意事項", "警語", "warning"],
  notes:        ["廠商名稱", "製造廠", "廠商", "健保代碼", "許可證字號"],
};

const mapping = ref<FieldMapping>({
  name: "", generic_name: "", synonyms: "", category: "",
  route: "", dose: "", warnings: "", notes: "",
});

function autoDetect(cols: string[]) {
  const m = { ...mapping.value } as FieldMapping;
  for (const [field, patterns] of Object.entries(AUTO_DETECT) as [keyof FieldMapping, string[]][]) {
    const hit = cols.find((c) => patterns.some((p) => c.toLowerCase().includes(p.toLowerCase())));
    m[field] = hit ?? "";
  }
  mapping.value = m;
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  fileName.value = file.name;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RowPreview>(ws, { defval: "" });
  if (rows.length === 0) return;
  headers.value = Object.keys(rows[0]);
  allRows.value = rows;
  previewRows.value = rows.slice(0, 5);
  autoDetect(headers.value);
  step.value = "map";
}

function toPreview() {
  step.value = "preview";
}

function applyImport() {
  emit("imported", allRows.value);
}

function mappedValue(row: RowPreview, field: keyof FieldMapping): string {
  const col = mapping.value[field];
  return col ? (row[col] ?? "") : "";
}

const FIELD_LABELS: Record<keyof FieldMapping, string> = {
  name: "藥品名稱 *",
  generic_name: "學名 (Generic)",
  synonyms: "同義詞 / 別名",
  category: "分類",
  route: "給藥途徑",
  dose: "劑量 / 規格",
  warnings: "警語 / 備註",
  notes: "其他備註",
};

const mappingFields = Object.keys(FIELD_LABELS) as (keyof FieldMapping)[];

// Export mapping for parent
defineExpose({ mapping });
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('close')">
    <div class="w-full max-w-3xl bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl flex flex-col max-h-[85vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
        <div>
          <h2 class="text-white font-semibold">匯入健保藥典 / 食藥署資料</h2>
          <p class="text-gray-500 text-xs mt-0.5">支援健保署藥品給付 Excel、食藥署開放資料 Excel</p>
        </div>
        <button @click="emit('close')" class="text-gray-500 hover:text-gray-300 cursor-pointer text-xl leading-none">×</button>
      </div>

      <div class="flex-1 overflow-y-auto p-5">

        <!-- Step 1: Upload -->
        <div v-if="step === 'upload'" class="flex flex-col items-center justify-center py-12">
          <div class="text-4xl mb-4">📥</div>
          <p class="text-gray-300 font-medium mb-2">選擇 Excel 檔案</p>
          <p class="text-gray-500 text-sm mb-6 text-center max-w-sm">
            支援健保署「健保用藥品項」或食藥署匯出 Excel。<br/>
            系統會自動偵測欄位對應。
          </p>
          <label class="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm cursor-pointer hover:bg-blue-500 transition-colors">
            選擇 .xlsx / .xls 檔案
            <input type="file" accept=".xlsx,.xls" class="hidden" @change="onFile" />
          </label>
        </div>

        <!-- Step 2: Column Mapping -->
        <div v-else-if="step === 'map'">
          <div class="flex items-center gap-2 mb-4 p-3 rounded-lg bg-green-950/40 border border-green-900/50">
            <span class="text-green-400">✓</span>
            <span class="text-green-300 text-sm">已載入 <strong>{{ fileName }}</strong>，共 <strong>{{ allRows.length }}</strong> 筆藥品資料</span>
          </div>

          <p class="text-gray-400 text-sm mb-3">請確認欄位對應（已自動偵測，可手動調整）：</p>

          <div class="grid grid-cols-2 gap-3">
            <div v-for="field in mappingFields" :key="field">
              <label class="block text-xs text-gray-400 mb-1">{{ FIELD_LABELS[field] }}</label>
              <select v-model="mapping[field]" class="w-full px-3 py-2 rounded-lg bg-gray-800 border text-sm focus:outline-none focus:border-blue-500 transition-colors"
                :class="mapping[field] ? 'border-green-800 text-gray-100' : 'border-gray-700 text-gray-500'">
                <option value="">— 不匯入此欄位 —</option>
                <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Step 3: Preview -->
        <div v-else-if="step === 'preview'">
          <p class="text-gray-400 text-sm mb-3">預覽前 5 筆（共 {{ allRows.length }} 筆）：</p>
          <div class="overflow-x-auto rounded-lg border border-gray-800">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-gray-800 bg-gray-800/50">
                  <th class="text-left px-3 py-2 text-gray-400 font-medium">藥品名稱</th>
                  <th class="text-left px-3 py-2 text-gray-400 font-medium">學名</th>
                  <th class="text-left px-3 py-2 text-gray-400 font-medium">劑型/途徑</th>
                  <th class="text-left px-3 py-2 text-gray-400 font-medium">規格/劑量</th>
                  <th class="text-left px-3 py-2 text-gray-400 font-medium">備註</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in previewRows" :key="i" class="border-b border-gray-800/50">
                  <td class="px-3 py-2 text-gray-200 font-medium">{{ mappedValue(row, 'name') || '—' }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ mappedValue(row, 'generic_name') || '—' }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ mappedValue(row, 'route') || '—' }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ mappedValue(row, 'dose') || '—' }}</td>
                  <td class="px-3 py-2 text-gray-500 truncate max-w-[150px]">{{ mappedValue(row, 'warnings') || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-between items-center px-5 py-4 border-t border-gray-800 shrink-0">
        <button v-if="step !== 'upload'" @click="step = step === 'preview' ? 'map' : 'upload'" class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 cursor-pointer">← 上一步</button>
        <div v-else></div>
        <div class="flex gap-2">
          <button @click="emit('close')" class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 cursor-pointer">取消</button>
          <button v-if="step === 'map'" @click="toPreview" :disabled="!mapping.name" class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 disabled:opacity-40 cursor-pointer">預覽 →</button>
          <button v-if="step === 'preview'" @click="applyImport" class="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-500 cursor-pointer">✓ 匯入 {{ allRows.length }} 筆</button>
        </div>
      </div>
    </div>
  </div>
</template>
