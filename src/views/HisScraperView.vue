<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { getDb } from "@/db";
import {
  hisScraping, hisProgress, hisTotal, hisMessage, hisLastSyncAt,
  loadHisSettings, saveHisSettings, testHisLogin, fetchHisPatientList,
  scrapeHisNotes, fetchHisRaw,
  type HisPatient, type HisScrapeResult, type HisSettings,
} from "@/composables/useHisScraper";

// ── 介面定義 ──────────────────────────────────────────────────────
interface Physician {
  id: number;
  name: string;
  department: string;
  his_account: string;
}

interface HisNote {
  id: number;
  account_no: string;
  chart_no: string;
  patient_name: string;
  bed_no: string;
  ward: string;
  note_text: string;
  scraped_at: string;
  status: string;
  error_msg: string | null;
}

// ── 狀態 ──────────────────────────────────────────────────────────

// 設定
const settings      = ref<HisSettings | null>(null);
const settingsOpen  = ref(false);
const settingsSaved = ref(false);

// 醫師
const physicians     = ref<Physician[]>([]);
const selectedPhyId  = ref<number | null>(null);

// 病人清單
const patients       = ref<HisPatient[]>([]);
const selectedPtIds  = ref<Set<string>>(new Set());
const csvInput       = ref("");
const loadingList    = ref(false);

// 擷取結果（本次）
const scrapeResults  = ref<HisScrapeResult[]>([]);

// 歷史紀錄（DB）
const historyNotes   = ref<HisNote[]>([]);
const historySearch  = ref("");

// Modal
const modalNote      = ref<HisNote | null>(null);
const modalOpen      = ref(false);

// 探索模式
const exploreOpen    = ref(false);
const explorePath    = ref("");
const exploreParams  = ref("");
const exploreHtml    = ref("");
const exploreLoading = ref(false);

// 登入測試
const loginTesting   = ref(false);
const loginResult    = ref<{ success: boolean; redirect_url: string } | null>(null);

// Toast
const toast     = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 3000);
}

// ── 計算 ──────────────────────────────────────────────────────────

const selectedPatients = computed<HisPatient[]>(() =>
  patients.value.filter(p => selectedPtIds.value.has(p.account_no + "|" + p.chart_no))
);

const allSelected = computed(() =>
  patients.value.length > 0 && patients.value.every(p => selectedPtIds.value.has(p.account_no + "|" + p.chart_no))
);

const filteredHistory = computed(() => {
  const q = historySearch.value.trim().toLowerCase();
  if (!q) return historyNotes.value;
  return historyNotes.value.filter(n =>
    n.account_no.toLowerCase().includes(q) ||
    n.chart_no.toLowerCase().includes(q) ||
    n.patient_name.toLowerCase().includes(q) ||
    n.ward.toLowerCase().includes(q)
  );
});

const progressPct = computed(() =>
  hisTotal.value ? Math.round((hisProgress.value / hisTotal.value) * 100) : 0
);

// ── 生命週期 ──────────────────────────────────────────────────────

onMounted(async () => {
  settings.value = await loadHisSettings();
  const db = await getDb();
  physicians.value = await db.select<Physician[]>(
    "SELECT id, name, department, his_account FROM physicians WHERE his_account != '' AND his_account IS NOT NULL ORDER BY name"
  );
  await loadHistory();
});

async function loadHistory() {
  const db = await getDb();
  historyNotes.value = await db.select<HisNote[]>(
    "SELECT id, account_no, chart_no, patient_name, bed_no, ward, note_text, scraped_at, status, error_msg FROM his_notes ORDER BY scraped_at DESC LIMIT 200"
  );
}

// ── 設定 ──────────────────────────────────────────────────────────

async function onSaveSettings() {
  if (!settings.value) return;
  await saveHisSettings(settings.value);
  settingsSaved.value = true;
  setTimeout(() => { settingsSaved.value = false; }, 2000);
}

// ── 登入測試 ──────────────────────────────────────────────────────

async function onTestLogin() {
  if (!selectedPhyId.value) { showToast("請先選擇醫師"); return; }
  loginTesting.value = true;
  loginResult.value  = null;
  try {
    const result = await testHisLogin(selectedPhyId.value);
    loginResult.value = result;
    showToast(result.success ? "登入成功！" : "登入失敗，請確認帳號密碼");
  } catch (e: unknown) {
    showToast("錯誤：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    loginTesting.value = false;
  }
}

// ── 病人清單 ──────────────────────────────────────────────────────

function ptKey(p: HisPatient) { return p.account_no + "|" + p.chart_no; }

function togglePt(p: HisPatient) {
  const k = ptKey(p);
  if (selectedPtIds.value.has(k)) selectedPtIds.value.delete(k);
  else selectedPtIds.value.add(k);
  selectedPtIds.value = new Set(selectedPtIds.value);
}

function toggleAll() {
  if (allSelected.value) {
    selectedPtIds.value = new Set();
  } else {
    selectedPtIds.value = new Set(patients.value.map(ptKey));
  }
}

async function onLoadList() {
  if (!selectedPhyId.value) { showToast("請先選擇醫師"); return; }
  loadingList.value = true;
  try {
    patients.value = await fetchHisPatientList(selectedPhyId.value);
    selectedPtIds.value = new Set(patients.value.map(ptKey));
    showToast(`載入 ${patients.value.length} 筆病人`);
  } catch (e: unknown) {
    showToast("錯誤：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    loadingList.value = false;
  }
}

function onParseCsv() {
  const lines = csvInput.value.trim().split("\n").filter(l => l.trim());
  const parsed: HisPatient[] = [];
  for (const line of lines) {
    const parts = line.split(",").map(s => s.trim());
    if (parts.length >= 2) {
      parsed.push({
        account_no:   parts[0],
        chart_no:     parts[1],
        patient_name: parts[2],
        bed_no:       parts[3],
        ward:         parts[4],
      });
    }
  }
  if (!parsed.length) { showToast("解析失敗，請確認格式"); return; }
  patients.value = parsed;
  selectedPtIds.value = new Set(parsed.map(ptKey));
  showToast(`解析 ${parsed.length} 筆病人`);
}

// ── 擷取 ──────────────────────────────────────────────────────────

async function onScrape() {
  if (!selectedPhyId.value) { showToast("請選擇醫師"); return; }
  if (!selectedPatients.value.length) { showToast("請勾選要擷取的病人"); return; }
  scrapeResults.value = [];
  try {
    const results = await scrapeHisNotes(selectedPhyId.value, selectedPatients.value);
    scrapeResults.value = results;
    await loadHistory();
    showToast(hisMessage.value);
  } catch (e: unknown) {
    showToast("擷取失敗：" + (e instanceof Error ? e.message : String(e)));
  }
}

// ── 探索模式 ──────────────────────────────────────────────────────

async function onExplore() {
  if (!selectedPhyId.value) { showToast("請先選擇醫師"); return; }
  exploreLoading.value = true;
  exploreHtml.value = "";
  try {
    exploreHtml.value = await fetchHisRaw(selectedPhyId.value, explorePath.value, exploreParams.value);
  } catch (e: unknown) {
    exploreHtml.value = "錯誤：" + (e instanceof Error ? e.message : String(e));
  } finally {
    exploreLoading.value = false;
  }
}

// ── Modal ─────────────────────────────────────────────────────────

function openModal(note: HisNote) {
  modalNote.value = note;
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  modalNote.value = null;
}

async function copyNote() {
  if (!modalNote.value) return;
  await navigator.clipboard.writeText(modalNote.value.note_text);
  showToast("已複製到剪貼簿");
}

// ── 狀態色 ────────────────────────────────────────────────────────
function statusColor(status: string) {
  if (status === "ok")              return "text-emerald-400";
  if (status === "partial")        return "text-yellow-400";
  if (status === "session_expired") return "text-amber-400";
  return "text-red-400";
}
function statusLabel(status: string) {
  if (status === "ok")              return "成功";
  if (status === "partial")        return "部分成功";
  if (status === "session_expired") return "Session過期";
  return "失敗";
}
</script>

<template>
  <div class="flex flex-col h-full bg-zinc-950 text-zinc-100 text-sm overflow-y-auto">

    <!-- 頂部標題列 -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
      <h1 class="text-base font-semibold tracking-wide">HIS 病歷擷取</h1>
      <span v-if="hisLastSyncAt" class="text-xs text-zinc-500">最後同步：{{ hisLastSyncAt }}</span>
    </div>

    <div class="flex-1 p-4 space-y-4 min-h-0">

      <!-- ── A 設定區（可摺疊）───────────────────────────────────── -->
      <div class="border border-zinc-800 rounded-lg overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-2 bg-zinc-900 hover:bg-zinc-800 transition-colors"
          @click="settingsOpen = !settingsOpen"
        >
          <span class="font-medium">⚙ HIS 連線設定</span>
          <span class="text-zinc-400 text-xs">{{ settingsOpen ? "收合 ▲" : "展開 ▼" }}</span>
        </button>

        <div v-if="settingsOpen && settings" class="p-4 bg-zinc-900 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-zinc-400 mb-1">Base URL</label>
              <input v-model="settings.base_url" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-xs text-zinc-400 mb-1">登入路徑</label>
              <input v-model="settings.login_path" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-xs text-zinc-400 mb-1">帳號欄位名（POST key）</label>
              <input v-model="settings.login_username_field" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-xs text-zinc-400 mb-1">密碼欄位名（POST key）</label>
              <input v-model="settings.login_password_field" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-xs text-zinc-400 mb-1">病摘頁路徑</label>
              <input v-model="settings.note_view_path" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-xs text-zinc-400 mb-1">登出路徑</label>
              <input v-model="settings.logout_path" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
            </div>
            <div class="col-span-2">
              <label class="block text-xs text-zinc-400 mb-1">病人清單路徑（選填，不填可手動輸入 CSV）</label>
              <input v-model="settings.patient_list_path" placeholder="例：/servlet/HttpDispatcher/Ins010201/inpatientList" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div class="flex gap-2">
            <button @click="onSaveSettings" class="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs font-medium">
              {{ settingsSaved ? "已儲存 ✓" : "儲存設定" }}
            </button>
          </div>

          <!-- 探索模式 -->
          <div class="border-t border-zinc-700 pt-3">
            <button class="text-xs text-zinc-400 hover:text-zinc-200 mb-2" @click="exploreOpen = !exploreOpen">
              {{ exploreOpen ? "▲ 收合探索模式" : "▼ 探索模式（找病人清單端點）" }}
            </button>
            <div v-if="exploreOpen" class="space-y-2">
              <div class="flex gap-2">
                <input v-model="explorePath" placeholder="/servlet/HttpDispatcher/..." class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none" />
                <input v-model="exploreParams" placeholder="?param=value" class="w-40 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none" />
                <button @click="onExplore" :disabled="exploreLoading" class="px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 text-xs disabled:opacity-50">
                  {{ exploreLoading ? "請求中…" : "送出" }}
                </button>
              </div>
              <textarea v-if="exploreHtml" readonly :value="exploreHtml" class="w-full h-40 bg-zinc-950 border border-zinc-700 rounded p-2 text-xs font-mono text-zinc-300 resize-none" />
            </div>
          </div>
        </div>
      </div>

      <!-- ── B 醫師選擇 ──────────────────────────────────────────── -->
      <div class="border border-zinc-800 rounded-lg p-4 bg-zinc-900 space-y-3">
        <h2 class="font-medium text-zinc-300">醫師帳號</h2>
        <div class="flex items-center gap-3">
          <select
            v-model="selectedPhyId"
            class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
          >
            <option :value="null" disabled>選擇要使用的 HIS 帳號…</option>
            <option v-for="p in physicians" :key="p.id" :value="p.id">
              {{ p.name }}（{{ p.department }}）— {{ p.his_account }}
            </option>
          </select>
          <button
            @click="onTestLogin"
            :disabled="!selectedPhyId || loginTesting"
            class="px-3 py-1.5 rounded bg-teal-700 hover:bg-teal-600 text-xs disabled:opacity-50 whitespace-nowrap"
          >
            {{ loginTesting ? "測試中…" : "測試登入" }}
          </button>
        </div>
        <p v-if="loginResult !== null" :class="loginResult.success ? 'text-emerald-400' : 'text-red-400'" class="text-xs">
          {{ loginResult.success ? "✓ 登入成功" : "✗ 登入失敗" }}
          <span class="text-zinc-500 ml-2">→ {{ loginResult.redirect_url }}</span>
        </p>
      </div>

      <!-- ── C 病人清單 ─────────────────────────────────────────── -->
      <div class="border border-zinc-800 rounded-lg p-4 bg-zinc-900 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-medium text-zinc-300">病人清單</h2>
          <span class="text-xs text-zinc-500">已選 {{ selectedPtIds.size }} / 共 {{ patients.length }} 位</span>
        </div>

        <!-- 載入按鈕（需設定清單路徑） -->
        <div class="flex gap-2">
          <button
            @click="onLoadList"
            :disabled="!selectedPhyId || loadingList || !settings?.patient_list_path"
            class="px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-xs disabled:opacity-40"
            :title="!settings?.patient_list_path ? '請先在設定中填入病人清單路徑' : ''"
          >
            {{ loadingList ? "載入中…" : "從 HIS 載入清單" }}
          </button>
          <span class="text-zinc-600 text-xs self-center">或</span>
          <span class="text-xs text-zinc-400 self-center">手動貼入 CSV ↓</span>
        </div>

        <!-- CSV 手動輸入 -->
        <div class="space-y-1">
          <p class="text-xs text-zinc-500">格式：收費帳號,病歷號,姓名,床號,病房（每行一筆）</p>
          <div class="flex gap-2">
            <textarea
              v-model="csvInput"
              rows="3"
              placeholder="I11500006445,0704867325,王大明,12A,外科&#10;I11500006446,0704867326,李小花,12B,內科"
              class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono resize-none focus:outline-none focus:border-blue-500"
            />
            <button @click="onParseCsv" class="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs self-start">解析</button>
          </div>
        </div>

        <!-- 病人表格 -->
        <div v-if="patients.length" class="border border-zinc-700 rounded overflow-hidden">
          <table class="w-full text-xs">
            <thead class="bg-zinc-800 text-zinc-400">
              <tr>
                <th class="px-2 py-1.5 text-left w-8">
                  <input type="checkbox" :checked="allSelected" @change="toggleAll" class="accent-blue-500" />
                </th>
                <th class="px-2 py-1.5 text-left">收費帳號</th>
                <th class="px-2 py-1.5 text-left">病歷號</th>
                <th class="px-2 py-1.5 text-left">姓名</th>
                <th class="px-2 py-1.5 text-left">床號</th>
                <th class="px-2 py-1.5 text-left">病房</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in patients" :key="ptKey(p)"
                @click="togglePt(p)"
                class="border-t border-zinc-800 hover:bg-zinc-800 cursor-pointer"
                :class="selectedPtIds.has(ptKey(p)) ? 'bg-blue-950/30' : ''"
              >
                <td class="px-2 py-1">
                  <input type="checkbox" :checked="selectedPtIds.has(ptKey(p))" @click.stop="togglePt(p)" class="accent-blue-500" />
                </td>
                <td class="px-2 py-1 font-mono">{{ p.account_no }}</td>
                <td class="px-2 py-1 font-mono">{{ p.chart_no }}</td>
                <td class="px-2 py-1">{{ p.patient_name ?? "—" }}</td>
                <td class="px-2 py-1">{{ p.bed_no ?? "—" }}</td>
                <td class="px-2 py-1">{{ p.ward ?? "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── D 擷取控制 & 結果 ───────────────────────────────────── -->
      <div class="border border-zinc-800 rounded-lg p-4 bg-zinc-900 space-y-3">
        <div class="flex items-center gap-3">
          <button
            @click="onScrape"
            :disabled="hisScraping || !selectedPhyId || !selectedPtIds.size"
            class="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 font-medium text-xs disabled:opacity-40"
          >
            {{ hisScraping ? "擷取中…" : "開始擷取病歷" }}
          </button>
          <span class="text-xs text-zinc-400">{{ hisMessage }}</span>
        </div>

        <!-- 進度條 -->
        <div v-if="hisScraping" class="space-y-1">
          <div class="flex justify-between text-xs text-zinc-400">
            <span>{{ hisProgress }} / {{ hisTotal }}</span>
            <span>{{ progressPct }}%</span>
          </div>
          <div class="w-full bg-zinc-800 rounded-full h-2">
            <div class="bg-emerald-500 h-2 rounded-full transition-all" :style="{ width: progressPct + '%' }" />
          </div>
        </div>

        <!-- 本次擷取結果摘要 -->
        <div v-if="scrapeResults.length" class="border border-zinc-700 rounded overflow-hidden">
          <div class="bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 font-medium">本次擷取結果</div>
          <table class="w-full text-xs">
            <thead class="bg-zinc-800/50 text-zinc-500">
              <tr>
                <th class="px-3 py-1 text-left">收費帳號</th>
                <th class="px-3 py-1 text-left">病歷號</th>
                <th class="px-3 py-1 text-left">狀態</th>
                <th class="px-3 py-1 text-left">備註</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in scrapeResults" :key="r.account_no + r.chart_no" class="border-t border-zinc-800">
                <td class="px-3 py-1 font-mono">{{ r.account_no }}</td>
                <td class="px-3 py-1 font-mono">{{ r.chart_no }}</td>
                <td class="px-3 py-1" :class="statusColor(r.status)">{{ statusLabel(r.status) }}</td>
                <td class="px-3 py-1 text-zinc-500 truncate max-w-xs">{{ r.error_msg ?? "" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── E 歷史記錄 ─────────────────────────────────────────── -->
      <div class="border border-zinc-800 rounded-lg p-4 bg-zinc-900 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="font-medium text-zinc-300">擷取歷史</h2>
          <input
            v-model="historySearch"
            placeholder="搜尋帳號/病歷/姓名/病房…"
            class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div v-if="filteredHistory.length" class="border border-zinc-700 rounded overflow-hidden">
          <table class="w-full text-xs">
            <thead class="bg-zinc-800 text-zinc-400">
              <tr>
                <th class="px-3 py-1.5 text-left">收費帳號</th>
                <th class="px-3 py-1.5 text-left">病歷號</th>
                <th class="px-3 py-1.5 text-left">姓名</th>
                <th class="px-3 py-1.5 text-left">病房/床</th>
                <th class="px-3 py-1.5 text-left">狀態</th>
                <th class="px-3 py-1.5 text-left">擷取時間</th>
                <th class="px-3 py-1.5 text-left"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="note in filteredHistory" :key="note.id"
                class="border-t border-zinc-800 hover:bg-zinc-800/50"
              >
                <td class="px-3 py-1.5 font-mono">{{ note.account_no }}</td>
                <td class="px-3 py-1.5 font-mono">{{ note.chart_no }}</td>
                <td class="px-3 py-1.5">{{ note.patient_name || "—" }}</td>
                <td class="px-3 py-1.5">{{ [note.ward, note.bed_no].filter(Boolean).join(" / ") || "—" }}</td>
                <td class="px-3 py-1.5" :class="statusColor(note.status)">{{ statusLabel(note.status) }}</td>
                <td class="px-3 py-1.5 text-zinc-500">{{ note.scraped_at }}</td>
                <td class="px-3 py-1.5">
                  <button
                    v-if="note.note_text"
                    @click="openModal(note)"
                    class="px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-xs"
                  >查看</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="text-xs text-zinc-600">尚無擷取記錄</p>
      </div>

    </div><!-- end main content -->

    <!-- ── 筆記 Modal ──────────────────────────────────────────── -->
    <Transition name="fade">
      <div v-if="modalOpen" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" @click.self="closeModal">
        <div class="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-700">
            <div class="text-sm font-semibold">
              {{ modalNote?.patient_name || "病人" }} ·
              <span class="font-mono text-zinc-400 text-xs">{{ modalNote?.account_no }}</span>
            </div>
            <div class="flex gap-2">
              <button @click="copyNote" class="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs">複製</button>
              <button @click="closeModal" class="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs">關閉</button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-5">
            <pre class="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed font-mono">{{ modalNote?.note_text }}</pre>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="fade">
      <div v-if="toast" class="fixed bottom-4 right-4 bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-4 py-2 text-xs shadow-xl z-50">
        {{ toast }}
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
