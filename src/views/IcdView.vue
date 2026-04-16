<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import * as XLSX from "xlsx";

interface IcdCode {
  code: string;
  version: "ICD9" | "ICD10";
  description_zh: string;
  description_en: string;
  category: string;
}

const codes      = ref<IcdCode[]>([]);
const activeVer  = ref<"ICD9" | "ICD10">("ICD10");
const searchQ    = ref("");
const toastMsg   = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2000);
}

// ── 載入 ─────────────────────────────────────────────────────
onMounted(load);
async function load() {
  const db = await getDb();
  codes.value = await db.select<IcdCode[]>(
    "SELECT * FROM icd_codes ORDER BY code"
  );
}

// ── 搜尋過濾 ─────────────────────────────────────────────────
const filtered = computed(() => {
  const q = searchQ.value.trim().toLowerCase();
  return codes.value
    .filter(c => c.version === activeVer.value)
    .filter(c => !q ||
      c.code.toLowerCase().includes(q) ||
      c.description_zh.toLowerCase().includes(q) ||
      c.description_en.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
});

// ── 複製 ─────────────────────────────────────────────────────
const copiedCode = ref("");
async function copyCode(code: string) {
  await navigator.clipboard.writeText(code);
  copiedCode.value = code;
  setTimeout(() => { copiedCode.value = ""; }, 1200);
}

// ── CRUD ─────────────────────────────────────────────────────
const showModal   = ref(false);
const modalMode   = ref<"add" | "edit">("add");
const form        = ref<Partial<IcdCode>>({});
const deleteTarget = ref<IcdCode | null>(null);

function openAdd() {
  form.value = { version: activeVer.value, code: "", description_zh: "", description_en: "", category: "" };
  modalMode.value = "add";
  showModal.value = true;
}
function openEdit(c: IcdCode) {
  form.value = { ...c };
  modalMode.value = "edit";
  showModal.value = true;
}
async function saveForm() {
  const f = form.value;
  if (!f.code?.trim() || !f.version) return;
  const db = await getDb();
  if (modalMode.value === "add") {
    try {
      await db.execute(
        "INSERT INTO icd_codes (code, version, description_zh, description_en, category) VALUES (?,?,?,?,?)",
        [f.code.trim().toUpperCase(), f.version, f.description_zh ?? "", f.description_en ?? "", f.category ?? ""]
      );
      toast("已新增");
    } catch { toast("代碼已存在"); return; }
  } else {
    await db.execute(
      "UPDATE icd_codes SET version=?, description_zh=?, description_en=?, category=? WHERE code=?",
      [f.version, f.description_zh ?? "", f.description_en ?? "", f.category ?? "", f.code]
    );
    toast("已更新");
  }
  showModal.value = false;
  await load();
}
async function doDelete() {
  if (!deleteTarget.value) return;
  const db = await getDb();
  await db.execute("DELETE FROM icd_codes WHERE code=?", [deleteTarget.value.code]);
  deleteTarget.value = null;
  toast("已刪除");
  await load();
}

// ── Excel 匯入 ────────────────────────────────────────────────
const showImport   = ref(false);
const importRows   = ref<IcdCode[]>([]);
const importLoading = ref(false);

const COL_MAP: Record<keyof Omit<IcdCode, "version">, string[]> = {
  code:           ["疾病碼", "icd碼", "代碼", "code", "icd", "碼"],
  description_zh: ["中文名稱", "中文", "診斷", "中文診斷", "名稱"],
  description_en: ["英文名稱", "英文", "english", "en"],
  category:       ["類別", "大類", "category"],
};

function detectCol(headers: string[], keys: string[]): number {
  for (const h of headers) {
    const idx = headers.indexOf(h);
    if (keys.some(k => h.toLowerCase().includes(k.toLowerCase()))) return idx;
  }
  return -1;
}

function handleFileImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  importLoading.value = true;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target?.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
      if (!raw.length) { toast("Excel 無資料"); importLoading.value = false; return; }

      const headers = Object.keys(raw[0]);
      const codeIdx  = detectCol(headers, COL_MAP.code);
      const zhIdx    = detectCol(headers, COL_MAP.description_zh);
      const enIdx    = detectCol(headers, COL_MAP.description_en);
      const catIdx   = detectCol(headers, COL_MAP.category);

      if (codeIdx < 0) { toast("找不到代碼欄位（疾病碼/ICD碼/代碼）"); importLoading.value = false; return; }

      importRows.value = raw
        .map(r => ({
          code:           (String(r[headers[codeIdx]] ?? "")).trim().toUpperCase(),
          version:        activeVer.value,
          description_zh: zhIdx  >= 0 ? String(r[headers[zhIdx]]  ?? "").trim() : "",
          description_en: enIdx  >= 0 ? String(r[headers[enIdx]]  ?? "").trim() : "",
          category:       catIdx >= 0 ? String(r[headers[catIdx]] ?? "").trim() : "",
        }))
        .filter(r => r.code);

      showImport.value = true;
    } catch { toast("Excel 解析失敗"); }
    finally { importLoading.value = false; }
  };
  reader.readAsArrayBuffer(file);
  (e.target as HTMLInputElement).value = "";
}

async function confirmImport() {
  const db = await getDb();
  let count = 0;
  for (const r of importRows.value) {
    await db.execute(
      "INSERT OR REPLACE INTO icd_codes (code, version, description_zh, description_en, category) VALUES (?,?,?,?,?)",
      [r.code, r.version, r.description_zh, r.description_en, r.category]
    );
    count++;
  }
  showImport.value = false;
  importRows.value = [];
  await load();
  toast(`已匯入 ${count} 筆 ${activeVer.value} 代碼`);
}
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h1 class="text-xl font-bold text-white">ICD 查詢</h1>
        <p class="text-xs text-gray-500 mt-0.5">共 {{ codes.filter(c => c.version === activeVer).length }} 筆 {{ activeVer }}</p>
      </div>
      <div class="flex gap-2">
        <label class="px-3 py-1.5 rounded-lg bg-green-800/60 text-green-200 text-xs cursor-pointer hover:bg-green-700/60 transition-colors">
          📥 Excel 匯入
          <input type="file" accept=".xlsx,.xls" class="hidden" @change="handleFileImport" />
        </label>
        <button @click="openAdd" class="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs hover:bg-blue-600 transition-colors">
          ＋ 新增
        </button>
      </div>
    </div>

    <!-- Version tabs -->
    <div class="flex gap-1 mb-3">
      <button v-for="v in (['ICD10', 'ICD9'] as const)" :key="v"
        @click="activeVer = v; searchQ = ''"
        class="px-4 py-1.5 rounded-lg text-sm transition-colors"
        :class="activeVer === v ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'">
        {{ v }}
      </button>
    </div>

    <!-- Search -->
    <input v-model="searchQ" placeholder="搜尋代碼或診斷名稱…"
      class="w-full px-3 py-2 mb-3 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" />

    <!-- List -->
    <div class="space-y-1">
      <div v-if="!filtered.length" class="text-gray-600 text-sm text-center py-10">
        {{ searchQ ? '無符合結果' : '尚無資料，請匯入 Excel 或手動新增' }}
      </div>
      <div v-for="c in filtered" :key="c.code"
        class="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-gray-700 hover:bg-gray-800/50 transition-colors cursor-pointer"
        @click="copyCode(c.code)">
        <!-- Code badge -->
        <span class="shrink-0 font-mono text-sm px-2 py-0.5 rounded"
          :class="copiedCode === c.code ? 'bg-green-700 text-green-100' : 'bg-gray-700 text-blue-300'">
          {{ copiedCode === c.code ? '✓ 已複製' : c.code }}
        </span>
        <!-- Descriptions -->
        <div class="flex-1 min-w-0">
          <p class="text-sm text-gray-200 truncate">{{ c.description_zh || '—' }}</p>
          <p v-if="c.description_en" class="text-xs text-gray-500 truncate">{{ c.description_en }}</p>
        </div>
        <!-- Category -->
        <span v-if="c.category" class="shrink-0 text-xs text-gray-600 hidden group-hover:inline">{{ c.category }}</span>
        <!-- Actions -->
        <div class="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button @click.stop="openEdit(c)" class="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">編輯</button>
          <button @click.stop="deleteTarget = c" class="text-xs px-2 py-0.5 rounded bg-red-900/60 text-red-300 hover:bg-red-800/60">刪除</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Add/Edit modal -->
  <Teleport to="body">
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="showModal = false">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[480px] max-w-[90vw] p-6 space-y-4">
        <h2 class="text-white font-semibold">{{ modalMode === 'add' ? '新增 ICD 代碼' : '編輯 ICD 代碼' }}</h2>
        <div class="space-y-3">
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="text-xs text-gray-400 mb-1 block">代碼 *</label>
              <input v-model="form.code" :disabled="modalMode === 'edit'"
                placeholder="e.g. J18.9"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50" />
            </div>
            <div>
              <label class="text-xs text-gray-400 mb-1 block">版本</label>
              <select v-model="form.version"
                class="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none">
                <option value="ICD10">ICD-10</option>
                <option value="ICD9">ICD-9</option>
              </select>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">中文名稱</label>
            <input v-model="form.description_zh" placeholder="肺炎，未明確病原體"
              class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">英文名稱</label>
            <input v-model="form.description_en" placeholder="Pneumonia, unspecified organism"
              class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">類別</label>
            <input v-model="form.category" placeholder="呼吸系統疾病"
              class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-1">
          <button @click="showModal = false" class="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">取消</button>
          <button @click="saveForm" class="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-600">儲存</button>
        </div>
      </div>
    </div>

    <!-- Import preview modal -->
    <div v-if="showImport" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="showImport = false">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[560px] max-w-[90vw] p-6 space-y-4 flex flex-col max-h-[80vh]">
        <h2 class="text-white font-semibold shrink-0">匯入預覽</h2>
        <p class="text-sm text-gray-400 shrink-0">共 <span class="text-white font-semibold">{{ importRows.length }}</span> 筆 {{ activeVer }} 代碼，確認後寫入（重複代碼以新資料覆蓋）</p>
        <div class="flex-1 overflow-y-auto space-y-1 min-h-0">
          <div v-for="r in importRows.slice(0, 50)" :key="r.code" class="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-gray-800/60 text-sm">
            <span class="font-mono text-blue-300 w-20 shrink-0">{{ r.code }}</span>
            <span class="text-gray-300 truncate">{{ r.description_zh }}</span>
            <span v-if="r.category" class="text-gray-600 text-xs shrink-0">{{ r.category }}</span>
          </div>
          <p v-if="importRows.length > 50" class="text-xs text-gray-600 text-center py-2">…還有 {{ importRows.length - 50 }} 筆</p>
        </div>
        <div class="flex gap-3 justify-end shrink-0 pt-1">
          <button @click="showImport = false" class="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">取消</button>
          <button @click="confirmImport" class="px-5 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-600">確認匯入</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="deleteTarget = null">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-80 p-6 space-y-4">
        <p class="text-white">確定刪除 <span class="font-mono text-red-400">{{ deleteTarget.code }}</span>？</p>
        <div class="flex gap-3 justify-end">
          <button @click="deleteTarget = null" class="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-sm bg-red-700 text-white rounded-lg hover:bg-red-600">刪除</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-[9999] pointer-events-none">
        {{ toastMsg }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
