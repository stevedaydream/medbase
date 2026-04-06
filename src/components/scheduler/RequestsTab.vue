<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import QRCode from "qrcode";
import { getDb } from "@/db";
import type { RequestEntry } from "@/views/SchedulerView.vue";
import { useCloudSettings } from "@/stores/cloudSettings";

interface StaffMember { code: string; name: string; role?: string }
interface ScheduleRow { name: string; days: (string | null)[] }
interface Shift { code: string; color: string }
interface SessionUser { code: string; name: string; role: string }

const props = defineProps<{
  requests:     RequestEntry[];
  staff:        StaffMember[];
  scheduleData: ScheduleRow[];
  session:      SessionUser;
  year:         number;
  month:        number;
  shifts:       Shift[];
}>();

const cloud = useCloudSettings();

const emit = defineEmits<{
  "pull-done": [requests: RequestEntry[]];
  "adopt":    [code: string];
  "ignore":   [code: string];
}>();

const canEdit = computed(() =>
  ["super", "admin", "scheduler"].includes(props.session.role)
);

// ── Booking window settings ───────────────────────────────────────────
const bookingOpen    = ref(false);
const bookingMonth   = ref(`${props.year}${String(props.month).padStart(2, "0")}`);
const bookingFrom    = ref("");
const bookingUntil   = ref("");
const isSavingConfig = ref(false);

const yyyyMM = computed(() => `${props.year}${String(props.month).padStart(2, "0")}`);

async function loadBookingSettings() {
  try {
    const db = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>(
      `SELECT key, value FROM app_settings WHERE key IN (
        'scheduler_booking_open','scheduler_booking_month',
        'scheduler_booking_from','scheduler_booking_until'
      )`
    );
    const m = Object.fromEntries(rows.map(r => [r.key.replace("scheduler_", ""), r.value]));
    bookingOpen.value  = m.booking_open  === "true";
    if (m.booking_month) bookingMonth.value = m.booking_month;
    if (m.booking_from)  bookingFrom.value  = m.booking_from;
    if (m.booking_until) bookingUntil.value = m.booking_until;
  } catch { /* ignore */ }
}

async function saveBookingConfig() {
  isSavingConfig.value = true;
  const db = await getDb();
  const pairs: [string, string][] = [
    ["scheduler_booking_open",  bookingOpen.value ? "true" : "false"],
    ["scheduler_booking_month", bookingMonth.value],
    ["scheduler_booking_from",  bookingFrom.value],
    ["scheduler_booking_until", bookingUntil.value],
  ];
  for (const [k, v] of pairs)
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)", [k, v]);

  // Sync to GAS Config sheet
  if (cloud.gasUrl) {
    for (const [k, v] of pairs) {
      await fetch(cloud.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "saveConfig", key: k.replace("scheduler_", ""), value: v }),
        mode: "no-cors",
      }).catch(() => {});
    }
  }
  isSavingConfig.value = false;
  toast("預約設定已儲存");
}

async function toggleBooking() {
  bookingOpen.value = !bookingOpen.value;
  await saveBookingConfig();
}

// ── Mobile App URL (Netlify PWA) ──────────────────────────────────────
const mobileAppUrl  = ref("");   // e.g. https://your-app.netlify.app
const isSavingUrl   = ref(false);

async function loadMobileAppUrl() {
  try {
    const db   = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = 'scheduler_mobile_app_url'"
    );
    if (rows[0]?.value) mobileAppUrl.value = rows[0].value;
  } catch { /* ignore */ }
}

async function saveMobileAppUrl() {
  isSavingUrl.value = true;
  try {
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      ["scheduler_mobile_app_url", mobileAppUrl.value.trim()]
    );
    toast("手機端連結已儲存");
  } finally { isSavingUrl.value = false; }
}

// Full URL sent to employees = base + ?month=YYYYMM
const mobileUrl = computed(() => {
  const base = mobileAppUrl.value.trim().replace(/\/$/, "");
  if (!base) return "";
  return `${base}?month=${bookingMonth.value}`;
});

const urlCopied = ref(false);
const showQr    = ref(false);
const qrDataUrl = ref("");

function copyUrl() {
  if (!mobileUrl.value) return;
  navigator.clipboard.writeText(mobileUrl.value).then(() => {
    urlCopied.value = true;
    setTimeout(() => { urlCopied.value = false; }, 2000);
  });
}

async function generateQr() {
  if (!mobileUrl.value) return;
  qrDataUrl.value = await QRCode.toDataURL(mobileUrl.value, {
    width: 200, margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

watch(showQr, (v) => { if (v) generateQr(); });
watch(mobileUrl, () => { if (showQr.value) generateQr(); });

// ── Pull requests from Sheets ─────────────────────────────────────────
const isLoading = ref(false);
const toastMsg  = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2500);
}

async function pullRequests() {
  if (!cloud.spreadsheetId || !cloud.apiKey) {
    toast("請先在設定填入 Spreadsheet ID 與 API Key"); return;
  }
  isLoading.value = true;
  try {
    const sheetName = `Requests_${yyyyMM.value}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${cloud.spreadsheetId}/values/${encodeURIComponent(sheetName)}?key=${cloud.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }
    const json = await res.json();
    const values: string[][] = json.values ?? [];
    if (values.length < 2) { toast("雲端尚無請求資料"); isLoading.value = false; return; }

    // columns: code, name, submitted_at, d1_v1, d1_v2, d1_v3, d2_v1, ... d31_v3
    const parsed: RequestEntry[] = values.slice(1).map(row => ({
      code: row[0]?.trim() ?? "",
      name: row[1]?.trim() ?? "",
      submittedAt: row[2]?.trim() ?? "",
      status: "pending" as const,
      days: Array.from({ length: 31 }, (_, di) => ({
        v1: row[3 + di * 3]?.trim() || null,
        v2: row[4 + di * 3]?.trim() || null,
        v3: row[5 + di * 3]?.trim() || null,
      })),
    })).filter(r => r.code);

    emit("pull-done", parsed);
    toast(`已載入 ${parsed.length} 筆請求`);
  } catch (e) {
    toast(`載入失敗：${(e as Error).message}`);
  } finally {
    isLoading.value = false;
  }
}

// ── Request list display ──────────────────────────────────────────────
const expandedCode = ref<string | null>(null);
const filterStatus = ref<"all" | "pending" | "adopted" | "ignored">("all");

const filteredRequests = computed(() => {
  if (filterStatus.value === "all") return props.requests;
  return props.requests.filter(r => r.status === filterStatus.value);
});

function toggleExpand(code: string) {
  expandedCode.value = expandedCode.value === code ? null : code;
}

// Count v1 choices per shift code
function summarize(req: RequestEntry) {
  const counts: Record<string, number> = {};
  for (const d of req.days) {
    if (d.v1) counts[d.v1] = (counts[d.v1] ?? 0) + 1;
  }
  return Object.entries(counts).map(([code, n]) => `${code}×${n}`).join(" ");
}

// Days in current month for compact grid display
const daysInMonth = computed(() => new Date(props.year, props.month, 0).getDate());
const dayLabels = computed(() =>
  Array.from({ length: daysInMonth.value }, (_, i) => {
    const d   = i + 1;
    const dow = new Date(props.year, props.month - 1, d).getDay();
    return { d, dow, isSat: dow === 6, isSun: dow === 0 };
  })
);

const DOW = ["日", "一", "二", "三", "四", "五", "六"];

// Adoption status for an expanded cell
function adoptionClass(req: RequestEntry, dayIdx: number): string {
  const member = props.staff.find(s => s.code === req.code);
  if (!member) return "";
  const actual = props.scheduleData.find(r => r.name === member.name)?.days[dayIdx] ?? null;
  const v1 = req.days[dayIdx]?.v1;
  if (!v1) return "";
  if (actual === v1) return "ring-1 ring-emerald-500";
  if (actual && actual !== v1) return "ring-1 ring-gray-600 opacity-60";
  return "";
}

onMounted(async () => {
  await loadBookingSettings();
  await loadMobileAppUrl();
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-gray-950">

    <!-- ── Booking window control ───────────────────────────────────── -->
    <div class="flex-shrink-0 border-b border-gray-800 px-4 py-3 space-y-3">
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs font-semibold text-gray-300">預約視窗控制</span>

        <!-- Status toggle -->
        <button v-if="canEdit" @click="toggleBooking" :disabled="isSavingConfig"
          class="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-semibold transition-colors"
          :class="bookingOpen
            ? 'bg-emerald-900/60 border-emerald-700 text-emerald-300 hover:bg-emerald-900'
            : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'">
          <span>{{ bookingOpen ? "● 預約開放中" : "○ 預約已關閉" }}</span>
        </button>
        <span v-else class="text-xs px-2 py-0.5 rounded-full border"
          :class="bookingOpen ? 'border-emerald-800 text-emerald-400' : 'border-gray-800 text-gray-600'">
          {{ bookingOpen ? "● 開放中" : "○ 已關閉" }}
        </span>

        <div class="flex items-center gap-1.5 ml-2">
          <span class="text-xs text-gray-600">預約月份</span>
          <input v-model="bookingMonth" :disabled="!canEdit" maxlength="6" placeholder="202606"
            class="w-20 text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded font-mono text-gray-300 outline-none focus:border-gray-500 disabled:opacity-50" />
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-gray-600">開放期間</span>
          <input v-model="bookingFrom" :disabled="!canEdit" type="date"
            class="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-300 outline-none focus:border-gray-500 disabled:opacity-50" />
          <span class="text-xs text-gray-700">至</span>
          <input v-model="bookingUntil" :disabled="!canEdit" type="date"
            class="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-300 outline-none focus:border-gray-500 disabled:opacity-50" />
        </div>
        <button v-if="canEdit" @click="saveBookingConfig" :disabled="isSavingConfig"
          class="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded">
          儲存設定
        </button>
      </div>

      <!-- Mobile PWA URL setting + QR -->
      <div class="flex flex-col gap-2 pt-1">
        <!-- URL input row -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-gray-500 flex-shrink-0">手機端站點</span>
          <input
            v-model="mobileAppUrl"
            :disabled="!canEdit"
            placeholder="https://your-app.netlify.app"
            class="flex-1 min-w-0 text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded font-mono text-gray-300 outline-none focus:border-blue-600 disabled:opacity-50"
          />
          <button v-if="canEdit" @click="saveMobileAppUrl" :disabled="isSavingUrl"
            class="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded flex-shrink-0">
            {{ isSavingUrl ? "…" : "儲存" }}
          </button>
        </div>

        <!-- Preview + copy + QR (only when URL is set) -->
        <div v-if="mobileUrl" class="flex items-center gap-2">
          <span class="text-xs text-gray-700 flex-shrink-0">預覽：</span>
          <span class="flex-1 text-xs font-mono text-gray-500 truncate">{{ mobileUrl }}</span>
          <button @click="copyUrl"
            class="text-xs px-2 py-0.5 rounded transition-colors flex-shrink-0"
            :class="urlCopied ? 'bg-emerald-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'">
            {{ urlCopied ? "✓ 已複製" : "複製" }}
          </button>
          <button @click="showQr = !showQr"
            class="text-xs px-2 py-0.5 rounded flex-shrink-0"
            :class="showQr ? 'bg-indigo-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'">
            QR
          </button>
        </div>
        <p v-else class="text-xs text-gray-700">貼入 Netlify 部署完成後的站點網址，儲存後可產生 QR Code 供員工掃描</p>

        <!-- QR code panel -->
        <div v-if="showQr && qrDataUrl" class="flex justify-center py-2">
          <div class="bg-white p-3 rounded-lg inline-block shadow-lg">
            <img :src="qrDataUrl" alt="手機端 QR Code" class="w-44 h-44 block" />
            <p class="text-center text-gray-600 text-xs mt-1.5 font-medium">{{ mobileUrl }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Request list header ──────────────────────────────────────── -->
    <div class="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-800">
      <button @click="pullRequests" :disabled="isLoading"
        class="text-xs px-3 py-1.5 bg-blue-800/60 hover:bg-blue-700 text-blue-200 rounded disabled:opacity-40">
        {{ isLoading ? "…" : "↓" }} 從雲端拉取請求
      </button>
      <span class="text-xs text-gray-600">{{ requests.length }} 筆</span>
      <div class="flex gap-1 ml-2">
        <button v-for="s in (['all','pending','adopted','ignored'] as const)" :key="s"
          @click="filterStatus = s"
          class="text-xs px-2 py-0.5 rounded transition-colors"
          :class="filterStatus === s ? 'bg-gray-700 text-gray-200' : 'text-gray-600 hover:text-gray-400'">
          {{ s === 'all' ? '全部' : s === 'pending' ? '待審' : s === 'adopted' ? '已採納' : '已忽略' }}
        </button>
      </div>
      <!-- Toast -->
      <span v-if="toastMsg" class="ml-auto text-xs text-gray-400 italic">{{ toastMsg }}</span>
    </div>

    <!-- ── Request list ──────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="!filteredRequests.length"
        class="flex flex-col items-center justify-center h-full text-gray-700 gap-2">
        <span class="text-3xl">📋</span>
        <p class="text-sm">尚無請求資料</p>
        <p class="text-xs">點「從雲端拉取請求」載入，或等員工提交</p>
      </div>

      <table v-else class="w-full text-xs border-collapse">
        <thead class="sticky top-0 bg-gray-900 z-10">
          <tr class="text-gray-600 border-b border-gray-800">
            <th class="px-3 py-2 text-left font-medium">代號</th>
            <th class="px-3 py-2 text-left font-medium">姓名</th>
            <th class="px-3 py-2 text-left font-medium w-36">提交時間</th>
            <th class="px-3 py-2 text-left font-medium">志願概覽</th>
            <th class="px-3 py-2 text-center font-medium w-20">狀態</th>
            <th v-if="canEdit" class="px-3 py-2 w-32"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="req in filteredRequests" :key="req.code">
            <!-- Summary row -->
            <tr class="border-b border-gray-800/60 hover:bg-gray-900/40 cursor-pointer"
              @click="toggleExpand(req.code)">
              <td class="px-3 py-2 font-mono text-blue-300">{{ req.code }}</td>
              <td class="px-3 py-2 text-gray-200">{{ req.name }}</td>
              <td class="px-3 py-2 text-gray-600">{{ req.submittedAt || "—" }}</td>
              <td class="px-3 py-2 text-gray-500">{{ summarize(req) || "（無志願）" }}</td>
              <td class="px-3 py-2 text-center">
                <span class="inline-block px-1.5 py-0.5 rounded text-xs font-medium"
                  :class="{
                    'bg-orange-900/60 text-orange-300': req.status === 'pending',
                    'bg-emerald-900/60 text-emerald-300': req.status === 'adopted',
                    'bg-gray-800 text-gray-600': req.status === 'ignored',
                  }">
                  {{ req.status === 'pending' ? '待審' : req.status === 'adopted' ? '已採納' : '已忽略' }}
                </span>
              </td>
              <td v-if="canEdit" class="px-3 py-2" @click.stop>
                <div class="flex gap-1 justify-end">
                  <button v-if="req.status !== 'adopted'" @click="emit('adopt', req.code)"
                    class="text-xs px-2 py-0.5 bg-emerald-800/60 hover:bg-emerald-700 text-emerald-200 rounded">採納</button>
                  <button v-if="req.status === 'pending'" @click="emit('ignore', req.code)"
                    class="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded">忽略</button>
                </div>
              </td>
            </tr>

            <!-- Expanded: 31-day compact grid -->
            <tr v-if="expandedCode === req.code" class="border-b border-gray-800">
              <td :colspan="canEdit ? 6 : 5" class="px-3 py-3 bg-gray-900/50">
                <div class="overflow-x-auto">
                  <table class="border-collapse text-xs" style="min-width: max-content">
                    <thead>
                      <tr>
                        <th class="w-6 py-1 text-gray-700">志願</th>
                        <th v-for="day in dayLabels" :key="day.d"
                          class="w-7 py-1 text-center font-normal"
                          :class="day.isSat ? 'text-blue-400' : day.isSun ? 'text-red-400' : 'text-gray-600'">
                          {{ day.d }}
                        </th>
                      </tr>
                      <tr>
                        <th class="text-gray-700"></th>
                        <th v-for="day in dayLabels" :key="day.d"
                          class="w-7 text-center font-normal text-gray-700">
                          {{ DOW[day.dow] }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="vn in [1,2,3] as const" :key="vn">
                        <td class="py-0.5 text-gray-700 text-center">v{{ vn }}</td>
                        <td v-for="day in dayLabels" :key="day.d"
                          class="py-0.5 text-center relative"
                          :class="[
                            day.isSat ? 'bg-blue-950/10' : day.isSun ? 'bg-red-950/10' : '',
                            vn === 1 ? adoptionClass(req, day.d - 1) : ''
                          ]">
                          <span v-if="req.days[day.d - 1]?.[`v${vn}` as 'v1'|'v2'|'v3']"
                            class="inline-block rounded text-xs font-semibold leading-tight w-6 text-center py-0.5"
                            :style="{ backgroundColor: '#374151', color: '#9ca3af' }">
                            {{ req.days[day.d - 1][`v${vn}` as 'v1'|'v2'|'v3'] }}
                          </span>
                          <span v-else class="text-gray-800">·</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p class="text-xs text-gray-700 mt-1">綠框 = 已採納；灰框 = 已採納但班別不同；橘角標 = 尚未排班</p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

  </div>
</template>
