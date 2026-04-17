<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { getDb } from "@/db";
import MedicationModal, { type MedicationForm } from "@/components/medications/MedicationModal.vue";
import NhiImportModal from "@/components/medications/NhiImportModal.vue";
import TfdaSearchModal from "@/components/medications/TfdaSearchModal.vue";
import { useCloudSettings } from "@/stores/cloudSettings";
import { useLogger } from "@/composables/useLogger";

interface Medication {
  id: number;
  name: string;
  generic_name: string;
  synonyms: string;
  category: string;
  route: string;
  dose: string;
  iv_rate: string;
  warnings: string;
  notes: string;
}

const results    = ref<Medication[]>([]);
const totalCount = ref(0);
const isSearching = ref(false);
const search     = ref("");
const selected   = ref<Medication | null>(null);

// --- 雲端備份 ---
const cloud      = useCloudSettings();
const isSyncing  = ref(false);

// Modal states
const showCrudModal = ref(false);
const crudMode = ref<"add" | "edit">("add");
const editingForm = ref<MedicationForm | null>(null);
const showNhiImport = ref(false);
const showTfda = ref(false);

// NHI import modal ref to access mapping
const nhiImportRef = ref<InstanceType<typeof NhiImportModal> | null>(null);

onMounted(async () => {
  cloud.load();
  await loadCount();
  await doSearch();
});

async function loadCount() {
  const db = await getDb();
  const r = await db.select<{ c: number }[]>("SELECT COUNT(*) as c FROM medications");
  totalCount.value = r[0]?.c ?? 0;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 300);
});

async function doSearch() {
  isSearching.value = true;
  try {
    const db = await getDb();
    const q = search.value.trim();
    if (!q) {
      results.value = await db.select<Medication[]>("SELECT * FROM medications ORDER BY name LIMIT 500");
      return;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    let tokenSql = "";
    const params: string[] = [];
    for (const token of tokens) {
      tokenSql += " AND (name LIKE ? OR generic_name LIKE ? OR synonyms LIKE ? OR category LIKE ?)";
      params.push(`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`);
    }
    results.value = await db.select<Medication[]>(
      `SELECT * FROM medications WHERE 1=1${tokenSql} ORDER BY name LIMIT 100`,
      params
    );
  } finally {
    isSearching.value = false;
  }
}

async function loadMedications() {
  await loadCount();
  await doSearch();
}

function parseJson(s: string | null): string[] {
  try { return JSON.parse(s ?? "[]") ?? []; } catch { return []; }
}

// --- CRUD ---
function openAdd() {
  crudMode.value = "add";
  editingForm.value = null;
  showCrudModal.value = true;
}

function openEdit() {
  if (!selected.value) return;
  crudMode.value = "edit";
  editingForm.value = {
    id: selected.value.id,
    name: selected.value.name,
    generic_name: selected.value.generic_name ?? "",
    synonyms: parseJson(selected.value.synonyms).join(", "),
    category: selected.value.category ?? "",
    route: selected.value.route ?? "PO",
    dose: selected.value.dose ?? "",
    iv_rate: selected.value.iv_rate ?? "",
    warnings: parseJson(selected.value.warnings).join("\n"),
    notes: selected.value.notes ?? "",
  };
  showCrudModal.value = true;
}

async function saveMedication(form: MedicationForm) {
  const db = await getDb();
  const synonyms = JSON.stringify(form.synonyms.split(",").map((s) => s.trim()).filter(Boolean));
  const warnings = JSON.stringify(form.warnings.split("\n").map((s) => s.trim()).filter(Boolean));

  if (crudMode.value === "add") {
    await db.execute(
      `INSERT INTO medications (name, generic_name, synonyms, category, route, dose, iv_rate, warnings, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
      [form.name, form.generic_name, synonyms, form.category, form.route, form.dose, form.iv_rate, warnings, form.notes]
    );
  } else {
    await db.execute(
      `UPDATE medications SET name=?, generic_name=?, synonyms=?, category=?, route=?, dose=?, iv_rate=?, warnings=?, notes=? WHERE id=?`,
      [form.name, form.generic_name, synonyms, form.category, form.route, form.dose, form.iv_rate, warnings, form.notes, form.id]
    );
  }
  showCrudModal.value = false;
  await loadMedications();
  selected.value = results.value.find((m) => m.name === form.name) ?? null;
}

async function deleteMedication() {
  if (!selected.value) return;
  if (!confirm(`確定刪除「${selected.value.name}」？`)) return;
  const db = await getDb();
  await db.execute("DELETE FROM medications WHERE id = ?", [selected.value.id]);
  selected.value = null;
  await loadMedications();
}

async function pushMedicationsToCloud() {
  if (!cloud.gasUrl) { alert("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true;
  try {
    const db   = await getDb();
    const data = await db.select<Medication[]>("SELECT * FROM medications ORDER BY name");
    await fetch(cloud.gasUrl, {
      method:  "POST",
      headers: { "Content-Type": "text/plain" },
      body:    JSON.stringify({ action: "saveMedications", data }),
      mode:    "no-cors",
    });
    alert(`✓ 已備份 ${data.length} 筆藥物至雲端`);
  } catch (e) { alert(`備份失敗：${(e as Error).message}`); }
  finally { isSyncing.value = false; }
}

async function pullMedicationsFromCloud() {
  if (!cloud.gasUrl) { alert("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true;
  try {
    const res  = await fetch(cloud.gasUrl, {
      method:  "POST",
      headers: { "Content-Type": "text/plain" },
      body:    JSON.stringify({ action: "getMedications" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const rows: Medication[] = json.data || [];
    if (!rows.length) { alert("雲端無藥物資料"); return; }
    const db = await getDb();
    await db.execute("BEGIN TRANSACTION");
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      const res2 = await db.execute(
        `INSERT OR IGNORE INTO medications (name, generic_name, synonyms, category, route, dose, iv_rate, warnings, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [r.name, r.generic_name||"", r.synonyms||"", r.category||"", r.route||"", r.dose||"", r.iv_rate||"", r.warnings||"", r.notes||""]
      );
      if (res2.rowsAffected > 0) inserted++; else skipped++;
    }
    await db.execute("COMMIT");
    await loadMedications();
    const msg = skipped > 0
      ? `✓ 新增 ${inserted} 筆，跳過 ${skipped} 筆（已存在）`
      : `✓ 已還原 ${inserted} 筆藥物`;
    alert(msg);
  } catch (e) {
    try { const db = await getDb(); await db.execute("ROLLBACK"); } catch {}
    alert(`還原失敗：${(e as Error).message}`);
  }
  finally { isSyncing.value = false; }
}

// --- Copy first word of generic_name ---
const copiedId  = ref<number | null>(null);
const copiedWord = ref("");
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function firstGenericWord(m: Medication): string {
  const src = (m.generic_name?.trim() || m.name?.trim() || "");
  return src.split(/\s+/)[0] ?? "";
}

async function copyFirstWord(m: Medication) {
  const word = firstGenericWord(m);
  if (!word) return;
  await navigator.clipboard.writeText(word);
  copiedId.value  = m.id;
  copiedWord.value = word;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copiedId.value = null; }, 1200);
}

// --- NHI XLSX import ---
function cellStr(row: Record<string, unknown>, col: string): string {
  const v = row[col];
  return v == null ? "" : String(v).trim();
}

const importProgress = ref({ active: false, current: 0, total: 0, inserted: 0, skipped: 0 });

async function onNhiImported(rows: Record<string, unknown>[]) {
  const { addLog } = useLogger();
  if (!nhiImportRef.value) {
    addLog('error', 'NHI 匯入失敗：modal ref 為 null');
    return;
  }
  const m = nhiImportRef.value.mapping;
  showNhiImport.value = false;
  importProgress.value = { active: true, current: 0, total: rows.length, inserted: 0, skipped: 0 };
  try {
    const db = await getDb();
    await db.execute("BEGIN TRANSACTION");
    let inserted = 0;
    let skipped  = 0;
    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i];
      const name = m.name ? cellStr(row, m.name) : "";
      importProgress.value.current = i + 1;
      if (!name) continue;
      const synonyms = JSON.stringify([m.synonyms ? cellStr(row, m.synonyms) : ""].filter(Boolean));
      const warnings = JSON.stringify([m.warnings ? cellStr(row, m.warnings) : ""].filter(Boolean));
      const res = await db.execute(
        `INSERT OR IGNORE INTO medications (name, generic_name, synonyms, category, route, dose, iv_rate, warnings, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          name,
          m.generic_name ? cellStr(row, m.generic_name) : "",
          synonyms,
          m.category    ? cellStr(row, m.category)     : "",
          m.route       ? cellStr(row, m.route)        : "",
          m.dose        ? cellStr(row, m.dose)         : "",
          "",
          warnings,
          m.notes       ? cellStr(row, m.notes)        : "",
        ]
      );
      if (res.rowsAffected > 0) inserted++; else skipped++;
      importProgress.value.inserted = inserted;
      importProgress.value.skipped  = skipped;
    }
    await db.execute("COMMIT");
    importProgress.value.active = false;
    await loadMedications();
    const msg = skipped > 0
      ? `✓ 新增 ${inserted} 筆，跳過 ${skipped} 筆（已存在）`
      : `✓ 已匯入 ${inserted} 筆藥品`;
    addLog('info', msg);
    alert(msg);
  } catch (err) {
    try { const db = await getDb(); await db.execute("ROLLBACK"); } catch {}
    importProgress.value.active = false;
    const errMsg = `匯入失敗：${(err as Error).message}`;
    addLog('error', errMsg, (err as Error).stack);
    alert(errMsg);
  }
}

</script>

<template>
  <div class="flex gap-4 h-full">
    <!-- Left panel -->
    <div class="flex flex-col w-72 shrink-0">
      <!-- Search -->
      <input
        v-model="search"
        placeholder="搜尋藥名 / 學名 / 同義詞…"
        class="mb-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />

      <!-- Action buttons -->
      <div class="flex gap-1.5 mb-1.5">
        <button @click="openAdd" class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors cursor-pointer">
          ＋ 新增
        </button>
        <button @click="showNhiImport = true" class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-green-800 text-green-100 text-xs hover:bg-green-700 transition-colors cursor-pointer" title="匯入健保藥典 XLSX">
          📥 健保匯入
        </button>
        <button @click="showTfda = true" class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-indigo-800 text-indigo-100 text-xs hover:bg-indigo-700 transition-colors cursor-pointer" title="食藥署線上查詢">
          🔍 食藥署
        </button>
      </div>
      <!-- Cloud sync buttons -->
      <div class="flex gap-1.5 mb-3">
        <button @click="pushMedicationsToCloud" :disabled="isSyncing"
          class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 disabled:opacity-40 transition-colors cursor-pointer"
          title="備份藥物字典至 Google Sheets">
          {{ isSyncing ? '…' : '☁ 上傳備份' }}
        </button>
        <button @click="pullMedicationsFromCloud" :disabled="isSyncing"
          class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 disabled:opacity-40 transition-colors cursor-pointer"
          title="從 Google Sheets 還原藥物字典">
          {{ isSyncing ? '…' : '☁ 下載還原' }}
        </button>
      </div>

      <!-- Count -->
      <p class="text-gray-600 text-xs mb-2">共 {{ totalCount }} 筆<span v-if="search && results.length < totalCount">，顯示 {{ results.length }} 筆</span></p>

      <!-- List -->
      <div class="flex-1 overflow-y-auto space-y-0.5">
        <div v-if="isSearching" class="text-gray-500 text-sm text-center py-8">搜尋中…</div>
        <div v-else-if="results.length === 0" class="text-gray-500 text-sm text-center py-8">
          {{ totalCount === 0 ? '尚無資料，請新增或匯入' : '無符合結果' }}
        </div>
        <button
          v-for="m in results"
          :key="m.id"
          @click="selected = m"
          class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors"
          :class="selected?.id === m.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'"
        >
          <div
            class="font-medium truncate hover:underline cursor-copy"
            :class="copiedId === m.id ? 'text-green-400' : ''"
            :title="`複製：${firstGenericWord(m)}`"
            @click="copyFirstWord(m)"
          >
            {{ copiedId === m.id ? `✓ ${copiedWord}` : m.name }}
          </div>
          <div class="text-xs opacity-60 mt-0.5">{{ m.route }} · {{ m.category || '未分類' }}</div>
        </button>
      </div>
    </div>

    <!-- Right panel: detail -->
    <div class="flex-1 rounded-xl bg-gray-900 border border-gray-800 p-5 overflow-y-auto">
      <div v-if="!selected" class="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
        <span class="text-4xl">💊</span>
        <p class="text-sm">選擇藥物查看詳情，或點擊「新增」建立藥品</p>
      </div>

      <div v-else>
        <!-- Header -->
        <div class="flex items-start justify-between mb-5">
          <div>
            <h2 class="text-xl font-semibold text-white">{{ selected.name }}</h2>
            <p class="text-gray-400 text-sm mt-0.5 italic">{{ selected.generic_name || '' }}</p>
          </div>
          <div class="flex gap-2">
            <button @click="openEdit" class="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs hover:bg-gray-700 transition-colors cursor-pointer">✏️ 編輯</button>
            <button @click="deleteMedication" class="px-3 py-1.5 rounded-lg bg-red-950 text-red-400 text-xs hover:bg-red-900 transition-colors cursor-pointer">🗑 刪除</button>
          </div>
        </div>

        <!-- Warnings -->
        <div v-if="parseJson(selected.warnings).length" class="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-900">
          <p class="text-red-400 text-xs font-semibold mb-2">⚠ 防呆警示</p>
          <ul class="space-y-1">
            <li v-for="w in parseJson(selected.warnings)" :key="w" class="text-red-300 text-sm">• {{ w }}</li>
          </ul>
        </div>

        <!-- Info grid -->
        <div class="grid grid-cols-2 gap-3 text-sm mb-3">
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">給藥途徑</p>
            <p class="text-gray-100 font-semibold">{{ selected.route || '—' }}</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">分類</p>
            <p class="text-gray-100">{{ selected.category || '—' }}</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">劑量</p>
            <p class="text-gray-100">{{ selected.dose || '—' }}</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-1">IV 速度</p>
            <p class="text-gray-100">{{ selected.iv_rate || '—' }}</p>
          </div>
        </div>

        <!-- Synonyms -->
        <div class="bg-gray-800 rounded-lg p-3 mb-3">
          <p class="text-gray-500 text-xs mb-2">同義詞 / 別名</p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="s in parseJson(selected.synonyms)"
              :key="s"
              class="px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 text-xs"
            >{{ s }}</span>
            <span v-if="!parseJson(selected.synonyms).length" class="text-gray-600 text-xs">—</span>
          </div>
        </div>

        <!-- Notes -->
        <div v-if="selected.notes" class="bg-gray-800 rounded-lg p-3">
          <p class="text-gray-500 text-xs mb-1">備註</p>
          <p class="text-gray-300 text-sm whitespace-pre-line">{{ selected.notes }}</p>
        </div>
      </div>
    </div>
  </div>

  <!-- CRUD Modal -->
  <MedicationModal
    v-if="showCrudModal"
    :mode="crudMode"
    :model-value="editingForm"
    @save="saveMedication"
    @close="showCrudModal = false"
  />

  <!-- NHI Import Modal -->
  <NhiImportModal
    v-if="showNhiImport"
    ref="nhiImportRef"
    @imported="onNhiImported"
    @close="showNhiImport = false"
  />

  <!-- TFDA Search Modal -->
  <TfdaSearchModal
    v-if="showTfda"
    @close="showTfda = false"
  />

  <!-- Import progress overlay -->
  <Teleport to="body">
    <div v-if="importProgress.active"
      class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-80 p-6 space-y-4">
        <p class="text-white font-semibold text-sm">匯入中…</p>
        <!-- progress bar -->
        <div class="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
          <div class="h-full bg-blue-500 rounded-full transition-all duration-100"
            :style="{ width: importProgress.total ? `${Math.round(importProgress.current / importProgress.total * 100)}%` : '0%' }" />
        </div>
        <div class="flex justify-between text-xs text-gray-400">
          <span>{{ importProgress.current }} / {{ importProgress.total }} 筆</span>
          <span class="text-green-400">+{{ importProgress.inserted }} 新增</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
