<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { getDb, dbWrite } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { icdSyncing, icdProgress, icdTotal, icdMessage, pullIcdFromCloud } from "@/composables/useIcdSync";
import * as XLSX from "xlsx";

interface IcdCode {
  code: string;
  version: "ICD9" | "ICD10";
  description_zh: string;
  description_en: string;
  category: string;
  is_starred: number;
}

const results      = ref<IcdCode[]>([]);
const totalCount   = ref(0);
const starredCount = ref(0);
const isSearching  = ref(false);
const starFilter   = ref(false);
const activeVer    = ref<"ICD9" | "ICD10">("ICD10");
const searchQ     = ref("");
const toastMsg    = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2000);
}

const cloud = useCloudSettings();

// ── 初始化：只載入筆數 ────────────────────────────────────────
onMounted(() => { cloud.load(); loadCount(); });

async function loadCount() {
  const db = await getDb();
  const [total, starred] = await Promise.all([
    db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM icd_codes WHERE version = ?", [activeVer.value]),
    db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM icd_codes WHERE version = ? AND is_starred = 1", [activeVer.value]),
  ]);
  totalCount.value   = total[0]?.c   ?? 0;
  starredCount.value = starred[0]?.c ?? 0;
}

async function refresh() {
  await loadCount();
  if (searchQ.value.trim()) await doSearch();
  else results.value = [];
}

// ── DB 搜尋（debounce 300ms）─────────────────────────────────
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(searchQ, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 300);
});

watch(activeVer, () => {
  results.value = [];
  loadCount();
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 100);
});

watch(starFilter, () => {
  if (searchTimer) clearTimeout(searchTimer);
  doSearch();
});

async function doSearch() {
  const q       = searchQ.value.trim();
  const starred = starFilter.value;
  if (!q && !starred) { results.value = []; return; }
  isSearching.value = true;
  try {
    const db = await getDb();

    // 多詞 AND：每個 token 都必須出現在 code / zh / en 其中一欄
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    let tokenSql = "";
    const tokenParams: string[] = [];
    for (const token of tokens) {
      // 單詞時 code 用前綴比對（利用索引），多詞全用 %token%
      const codeLike = tokens.length === 1 ? token + "%" : "%" + token + "%";
      tokenSql += ` AND (code LIKE ? OR description_zh LIKE ? OR description_en LIKE ?)`;
      tokenParams.push(codeLike, "%" + token + "%", "%" + token + "%");
    }

    const starSql = starred ? " AND is_starred = 1" : "";
    results.value = await db.select<IcdCode[]>(
      `SELECT * FROM icd_codes WHERE version = ?${starSql}${tokenSql} ORDER BY code LIMIT 200`,
      [activeVer.value, ...tokenParams]
    );
  } finally {
    isSearching.value = false;
  }
}

async function toggleStar(code: string, current: number) {
  const newVal = current ? 0 : 1;
  await dbWrite("UPDATE icd_codes SET is_starred = ? WHERE code = ?", [newVal, code]);
  const item = results.value.find(r => r.code === code);
  if (item) item.is_starred = newVal;
  // 若目前在 star filter 且取消星號，從列表移除
  if (starFilter.value && !newVal) {
    results.value = results.value.filter(r => r.code !== code);
  }
  starredCount.value += newVal ? 1 : -1;
}

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
  if (modalMode.value === "add") {
    try {
      await dbWrite(
        "INSERT INTO icd_codes (code, version, description_zh, description_en, category) VALUES (?,?,?,?,?)",
        [f.code.trim().toUpperCase(), f.version, f.description_zh ?? "", f.description_en ?? "", f.category ?? ""]
      );
      toast("已新增");
    } catch { toast("代碼已存在"); return; }
  } else {
    await dbWrite(
      "UPDATE icd_codes SET version=?, description_zh=?, description_en=?, category=? WHERE code=?",
      [f.version, f.description_zh ?? "", f.description_en ?? "", f.category ?? "", f.code]
    );
    toast("已更新");
  }
  showModal.value = false;
  await refresh();
}
async function doDelete() {
  if (!deleteTarget.value) return;
  await dbWrite("DELETE FROM icd_codes WHERE code=?", [deleteTarget.value.code]);
  deleteTarget.value = null;
  toast("已刪除");
  await refresh();
}

// ── 雲端同步 ─────────────────────────────────────────────────
async function pushToCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  try {
    const db = await getDb();
    const allCodes = await db.select<IcdCode[]>("SELECT * FROM icd_codes");
    await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveIcdCodes", data: allCodes }),
      mode: "no-cors",
    });
    toast(`已上傳 ${allCodes.length} 筆至雲端`);
  } catch (e) {
    toast(`上傳失敗：${(e as Error).message}`);
  }
}

async function startPullFromCloud() {
  await pullIcdFromCloud();
  // 同步完成後刷新本頁狀態
  results.value = [];
  searchQ.value = "";
  await loadCount();
  if (icdMessage.value) toast(icdMessage.value);
}

// ── Excel 匯入 ────────────────────────────────────────────────
const showImport            = ref(false);
const importRows            = ref<IcdCode[]>([]);
const importVersion         = ref<"ICD9" | "ICD10">("ICD10");
const importLoading         = ref(false);
const importConfirming      = ref(false);
const importConfirmProgress = ref(0);

const COL_MAP: Record<keyof Omit<IcdCode, "version" | "is_starred">, string[]> = {
  code:           ["icd-9-cm代碼", "icd-10-cm代碼", "疾病碼", "icd碼", "診斷碼", "代碼", "code", "icd", "碼"],
  description_zh: ["icd-9-cm中文名稱", "icd-10-cm中文名稱", "中文名稱", "中文", "診斷", "中文診斷"],
  description_en: ["icd-9-cm英文名稱", "icd-10-cm英文名稱", "英文名稱", "英文", "english", "en"],
  category:       ["類別", "大類", "category"],
};

function detectCol(headers: string[], keys: string[]): number {
  for (const key of keys) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(key.toLowerCase()));
    if (idx >= 0) return idx;
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

      importVersion.value = activeVer.value;
      importRows.value = raw
        .map(r => ({
          code:           (String(r[headers[codeIdx]] ?? "")).trim().toUpperCase(),
          version:        importVersion.value,
          description_zh: zhIdx  >= 0 ? String(r[headers[zhIdx]]  ?? "").trim() : "",
          description_en: enIdx  >= 0 ? String(r[headers[enIdx]]  ?? "").trim() : "",
          category:       catIdx >= 0 ? String(r[headers[catIdx]] ?? "").trim() : "",
          is_starred:     0,
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
  if (importConfirming.value) return;
  importConfirming.value = true;
  importConfirmProgress.value = 0;
  const rows = importRows.value;
  const total = rows.length;
  const BATCH = 100;
  try {
    for (let i = 0; i < total; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const ph   = slice.map(() => "(?,?,?,?,?)").join(",");
      const vals = slice.flatMap(r => [r.code, importVersion.value, r.description_zh, r.description_en, r.category]);
      await dbWrite(
        `INSERT OR REPLACE INTO icd_codes (code,version,description_zh,description_en,category) VALUES ${ph}`,
        vals
      );
      importConfirmProgress.value = Math.round(Math.min(i + BATCH, total) / total * 100);
      await new Promise(res => setTimeout(res, 0));
    }
    showImport.value = false;
    importRows.value = [];
    await refresh();
    toast(`已匯入 ${total} 筆 ${importVersion.value} 代碼`);
  } catch (e) {
    console.error("[ICD import]", e);
    toast(`匯入失敗：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    importConfirming.value = false;
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h1 class="text-xl font-bold text-white">ICD 查詢</h1>
        <p class="text-xs text-gray-500 mt-0.5">共 {{ totalCount.toLocaleString() }} 筆 {{ activeVer }}</p>
      </div>
      <div class="flex gap-2">
        <button @click="startPullFromCloud" :disabled="icdSyncing"
          class="px-3 py-1.5 rounded-lg bg-blue-800/60 text-blue-200 text-xs hover:bg-blue-700/60 disabled:opacity-40 transition-colors whitespace-nowrap">
          {{ icdSyncing ? `↓ ${icdProgress.toLocaleString()} / ${icdTotal.toLocaleString()}` : "↓ 雲端同步" }}
        </button>
        <button @click="pushToCloud" :disabled="icdSyncing"
          class="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 disabled:opacity-40 transition-colors whitespace-nowrap">
          ↑ 上傳
        </button>
        <label class="px-3 py-1.5 rounded-lg bg-green-800/60 text-green-200 text-xs cursor-pointer hover:bg-green-700/60 transition-colors">
          📥 Excel 匯入
          <input type="file" accept=".xlsx,.xls" class="hidden" @change="handleFileImport" />
        </label>
        <button @click="openAdd" class="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs hover:bg-blue-600 transition-colors">
          ＋ 新增
        </button>
      </div>
    </div>

    <!-- Version tabs + star filter -->
    <div class="flex items-center gap-1 mb-3">
      <button v-for="v in (['ICD10', 'ICD9'] as const)" :key="v"
        @click="activeVer = v"
        class="px-4 py-1.5 rounded-lg text-sm transition-colors"
        :class="activeVer === v ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'">
        {{ v }}
      </button>
      <div class="flex-1" />
      <button @click="starFilter = !starFilter"
        class="px-3 py-1.5 rounded-lg text-xs transition-colors"
        :class="starFilter ? 'bg-yellow-600/30 text-yellow-300 border border-yellow-600/50' : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'">
        ★ 常用<span v-if="starredCount"> ({{ starredCount }})</span>
      </button>
    </div>

    <!-- 同步進度條 -->
    <div v-if="icdSyncing" class="mb-3 rounded-lg bg-gray-800 border border-gray-700 p-3 space-y-1.5">
      <div class="flex items-center justify-between text-xs text-gray-400">
        <span>ICD 雲端同步中…</span>
        <span class="font-mono text-blue-300">{{ icdProgress.toLocaleString() }} / {{ icdTotal.toLocaleString() }}</span>
      </div>
      <div class="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
        <div class="bg-blue-500 h-1.5 rounded-full transition-all duration-150"
          :style="{ width: icdTotal > 0 ? `${Math.round(icdProgress / icdTotal * 100)}%` : '0%' }" />
      </div>
      <div class="text-[11px] text-gray-600 text-right">
        {{ icdTotal > 0 ? Math.round(icdProgress / icdTotal * 100) : 0 }}%
      </div>
    </div>

    <!-- Search -->
    <div class="relative mb-3">
      <input v-model="searchQ" placeholder="輸入代碼（J18）或中英文病名…"
        class="w-full px-3 py-2 pr-8 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500" />
      <span v-if="isSearching" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs animate-pulse">搜尋中…</span>
      <button v-else-if="searchQ" @click="searchQ = ''"
        class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-lg leading-none">×</button>
    </div>

    <!-- List -->
    <div class="space-y-1">
      <!-- 提示：未輸入且無 filter -->
      <div v-if="!searchQ && !starFilter" class="text-center py-16 space-y-2">
        <p class="text-gray-600 text-sm">輸入代碼或病名開始搜尋</p>
        <p class="text-gray-700 text-xs">例：J18、肺炎、pneumonia</p>
      </div>
      <!-- 搜尋中 -->
      <div v-else-if="isSearching" class="text-gray-600 text-sm text-center py-10">搜尋中…</div>
      <!-- 無結果 -->
      <div v-else-if="!results.length" class="text-gray-600 text-sm text-center py-10">
        {{ starFilter && !searchQ ? '尚無常用標記，點擊代碼旁的 ☆ 加入' : '無符合結果' }}
      </div>
      <!-- 結果列表 -->
      <template v-else>
        <p v-if="results.length === 200" class="text-xs text-yellow-700 text-center pb-1">顯示前 200 筆，請縮小搜尋範圍</p>
        <div v-for="c in results" :key="c.code"
        class="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-gray-700 hover:bg-gray-800/50 transition-colors cursor-pointer"
        @click="copyCode(c.code)">
        <!-- Star -->
        <button @click.stop="toggleStar(c.code, c.is_starred)"
          class="shrink-0 text-base leading-none transition-colors"
          :class="c.is_starred ? 'text-yellow-400' : 'text-gray-700 hover:text-gray-400'">
          {{ c.is_starred ? '★' : '☆' }}
        </button>
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
      </template>
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
        <div class="flex items-center justify-between shrink-0">
          <h2 class="text-white font-semibold">匯入預覽</h2>
          <div class="flex gap-1">
            <button v-for="v in (['ICD10', 'ICD9'] as const)" :key="v"
              @click="importVersion = v"
              class="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
              :class="importVersion === v ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'">
              {{ v }}
            </button>
          </div>
        </div>
        <p class="text-sm text-gray-400 shrink-0">共 <span class="text-white font-semibold">{{ importRows.length }}</span> 筆 <span class="text-blue-300 font-semibold">{{ importVersion }}</span> 代碼，確認後寫入（重複代碼以新資料覆蓋）</p>
        <div class="flex-1 overflow-y-auto space-y-1 min-h-0">
          <div v-for="r in importRows.slice(0, 50)" :key="r.code" class="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-gray-800/60 text-sm">
            <span class="font-mono text-blue-300 w-20 shrink-0">{{ r.code }}</span>
            <span class="text-gray-300 truncate">{{ r.description_zh }}</span>
            <span v-if="r.category" class="text-gray-600 text-xs shrink-0">{{ r.category }}</span>
          </div>
          <p v-if="importRows.length > 50" class="text-xs text-gray-600 text-center py-2">…還有 {{ importRows.length - 50 }} 筆</p>
        </div>
        <div v-if="importConfirming" class="shrink-0 space-y-1">
          <div class="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div class="h-2 bg-green-500 rounded-full transition-all duration-150"
              :style="{ width: importConfirmProgress + '%' }"></div>
          </div>
          <p class="text-xs text-gray-500 text-right">{{ importConfirmProgress }}%</p>
        </div>
        <div class="flex gap-3 justify-end shrink-0 pt-1">
          <button @click="showImport = false" :disabled="importConfirming"
            class="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-40">取消</button>
          <button @click="confirmImport" :disabled="importConfirming"
            class="px-5 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-600 disabled:opacity-60">
            {{ importConfirming ? `匯入中… ${importConfirmProgress}%` : '確認匯入' }}
          </button>
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
