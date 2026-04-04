<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { getDb } from "@/db";

interface StaffMember { code: string; name: string; role?: string }
interface Shift        { code: string; color: string }

const COLOR_PALETTE = [
  { key: "blue",    bg: "#1e3a5f", text: "#93c5fd" },
  { key: "violet",  bg: "#2e1065", text: "#c4b5fd" },
  { key: "emerald", bg: "#064e3b", text: "#6ee7b7" },
  { key: "gray",    bg: "#374151", text: "#9ca3af" },
  { key: "red",     bg: "#7f1d1d", text: "#fca5a5" },
  { key: "orange",  bg: "#431407", text: "#fb923c" },
  { key: "yellow",  bg: "#422006", text: "#fcd34d" },
  { key: "pink",    bg: "#500724", text: "#f9a8d4" },
  { key: "cyan",    bg: "#0c4a6e", text: "#7dd3fc" },
];

const props = defineProps<{
  staff:  StaffMember[];
  shifts: Shift[];
  year:   number;
  month:  number;
  gasUrl: string;
}>();

// ── Types ─────────────────────────────────────────────────────────────
interface DayChoice    { v1: string | null; v2: string | null; v3: string | null }
interface BookingDraft { code: string; name: string; days: DayChoice[] }

// ── Computed ──────────────────────────────────────────────────────────
const yyyyMM = computed(() =>
  `${props.year}${String(props.month).padStart(2, "0")}`
);

const daysInMonth = computed(() => new Date(props.year, props.month, 0).getDate());
const dayLabels   = computed(() =>
  Array.from({ length: daysInMonth.value }, (_, i) => {
    const d   = i + 1;
    const dow = new Date(props.year, props.month - 1, d).getDay();
    return { d, dow, isSat: dow === 6, isSun: dow === 0 };
  })
);
const DOW = ["日", "一", "二", "三", "四", "五", "六"];

// ── Draft state ───────────────────────────────────────────────────────
const drafts    = ref<Record<string, BookingDraft>>({});
const isLoading = ref(false);
const isSyncing = ref(false);
const toastMsg  = ref("");

// ── Selection state ───────────────────────────────────────────────────
const activeCodes = ref<Set<string>>(new Set());

function toggleActive(code: string) {
  const s = new Set(activeCodes.value);
  if (s.has(code)) s.delete(code); else s.add(code);
  activeCodes.value = s;
}
function selectAll()     { activeCodes.value = new Set(props.staff.map(s => s.code)); }
function clearSelection() { activeCodes.value = new Set(); }

// ── Helpers ───────────────────────────────────────────────────────────
function colorOf(key: string) {
  return COLOR_PALETTE.find(c => c.key === key) ?? COLOR_PALETTE[3];
}
function shiftStyle(code: string | null): Record<string, string> {
  if (!code) return {};
  const shift = props.shifts.find(s => s.code === code);
  const c     = colorOf(shift?.color ?? "gray");
  return { backgroundColor: c.bg, color: c.text };
}

function ensureDraft(code: string) {
  if (!drafts.value[code]) {
    const member = props.staff.find(s => s.code === code);
    drafts.value[code] = {
      code,
      name: member?.name ?? code,
      days: Array.from({ length: 31 }, () => ({ v1: null, v2: null, v3: null })),
    };
  }
}

function getDraftDay(code: string, di: number): DayChoice {
  return drafts.value[code]?.days[di] ?? { v1: null, v2: null, v3: null };
}

function hasAnyChoice(code: string): boolean {
  return drafts.value[code]?.days.some(d => d.v1 || d.v2 || d.v3) ?? false;
}

const pendingCount = computed(() =>
  Object.values(drafts.value).filter(d => d.days.some(x => x.v1 || x.v2 || x.v3)).length
);

// ── Cell picker ───────────────────────────────────────────────────────
interface ActiveCell { code: string; dayIdx: number; px: number; py: number }
const activeCell = ref<ActiveCell | null>(null);

function openCell(code: string, dayIdx: number, e: MouseEvent) {
  if (!activeCodes.value.has(code)) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  activeCell.value = {
    code, dayIdx,
    px: Math.min(rect.left + rect.width / 2 - 108, window.innerWidth  - 230),
    py: Math.min(rect.bottom + 4,                  window.innerHeight - 160),
  };
}

function setChoice(vn: 1 | 2 | 3, code: string | null) {
  if (!activeCell.value) return;
  const { code: staffCode, dayIdx } = activeCell.value;
  ensureDraft(staffCode);
  const key = `v${vn}` as "v1" | "v2" | "v3";
  drafts.value[staffCode].days[dayIdx][key] = code;
  // If v2/v3 cleared, shift up
  if (vn === 1 && !code) {
    drafts.value[staffCode].days[dayIdx].v2 = null;
    drafts.value[staffCode].days[dayIdx].v3 = null;
  }
  saveDraftDebounced();
}

function clearDay() {
  if (!activeCell.value) return;
  const { code, dayIdx } = activeCell.value;
  ensureDraft(code);
  drafts.value[code].days[dayIdx] = { v1: null, v2: null, v3: null };
  saveDraftDebounced();
  activeCell.value = null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveDraftDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistDrafts, 800);
}

function onDocKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") activeCell.value = null;
}
onMounted(() => document.addEventListener("keydown", onDocKeydown));
onUnmounted(() => {
  document.removeEventListener("keydown", onDocKeydown);
  if (saveTimer) clearTimeout(saveTimer);
});

// ── Persistence ───────────────────────────────────────────────────────
async function loadDrafts() {
  isLoading.value = true;
  try {
    const db   = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = ?",
      [`scheduler_booking_drafts_${yyyyMM.value}`]
    );
    drafts.value = rows[0]?.value ? JSON.parse(rows[0].value) : {};
  } catch { drafts.value = {}; }
  finally   { isLoading.value = false; }
}

async function persistDrafts() {
  try {
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [`scheduler_booking_drafts_${yyyyMM.value}`, JSON.stringify(drafts.value)]
    );
  } catch { /* silent */ }
}

async function clearPersonDraft(code: string, e: MouseEvent) {
  e.stopPropagation();
  if (!confirm(`確定清除「${props.staff.find(s => s.code === code)?.name ?? code}」的所有草稿？`)) return;
  delete drafts.value[code];
  await persistDrafts();
  toast("草稿已清除");
}

// ── Cloud sync ────────────────────────────────────────────────────────
async function syncToCloud() {
  if (!props.gasUrl) { toast("請先在設定填入 GAS Web App URL"); return; }
  const toSync = Object.values(drafts.value).filter(d =>
    d.days.some(x => x.v1 || x.v2 || x.v3)
  );
  if (!toSync.length) { toast("無草稿可同步"); return; }
  isSyncing.value = true;
  let ok = 0;
  try {
    for (const draft of toSync) {
      await fetch(props.gasUrl, {
        method:  "POST",
        headers: { "Content-Type": "text/plain" },
        body:    JSON.stringify({
          action: "saveRequest",
          code:   draft.code,
          name:   draft.name,
          yyyyMM: yyyyMM.value,
          days:   draft.days,
        }),
        mode: "no-cors",
      });
      ok++;
    }
    toast(`已同步 ${ok} 人的預約至雲端`);
  } catch (e) {
    toast(`同步失敗：${(e as Error).message}`);
  } finally { isSyncing.value = false; }
}

// ── Toast ─────────────────────────────────────────────────────────────
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2500);
}

// ── Lifecycle ─────────────────────────────────────────────────────────
onMounted(loadDrafts);
watch(yyyyMM, () => { activeCodes.value = new Set(); loadDrafts(); });
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-gray-950 select-none">

    <!-- ── Toolbar ──────────────────────────────────────────────────── -->
    <div class="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-800 flex-wrap">
      <span class="text-sm font-semibold text-white">預約登記</span>
      <span class="text-xs text-gray-600 font-mono">
        {{ year }}/{{ String(month).padStart(2, '0') }}
      </span>
      <span class="text-xs text-gray-700 border border-gray-800 rounded px-1.5 py-0.5">
        {{ activeCodes.size }}/{{ staff.length }} 人選取
      </span>
      <span v-if="pendingCount" class="text-xs text-emerald-600 border border-emerald-900 rounded px-1.5 py-0.5">
        {{ pendingCount }} 人有草稿
      </span>
      <div class="flex-1"></div>
      <span v-if="toastMsg" class="text-xs text-gray-400 italic">{{ toastMsg }}</span>
      <button @click="syncToCloud" :disabled="isSyncing || !pendingCount"
        class="text-xs px-3 py-1.5 bg-emerald-800/60 hover:bg-emerald-700 text-emerald-200 rounded disabled:opacity-40">
        {{ isSyncing ? '…' : '↑' }} 同步至雲端
      </button>
    </div>

    <!-- ── Body: sidebar + grid ─────────────────────────────────────── -->
    <div class="flex flex-1 overflow-hidden">

      <!-- Left sidebar: staff list ────────────────────────────────── -->
      <div class="w-28 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        <!-- Select all / clear -->
        <div class="flex gap-1 px-2 py-1.5 border-b border-gray-800">
          <button @click="selectAll"
            class="flex-1 text-xs py-0.5 bg-gray-800 hover:bg-blue-800/60 text-gray-400 hover:text-blue-200 rounded transition-colors">
            全選
          </button>
          <button @click="clearSelection"
            class="flex-1 text-xs py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors">
            清除
          </button>
        </div>
        <!-- People -->
        <div class="flex-1 overflow-y-auto">
          <div v-for="member in staff" :key="member.code"
            @click="toggleActive(member.code)"
            class="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-xs border-l-2 transition-colors"
            :class="activeCodes.has(member.code)
              ? 'bg-blue-900/30 text-blue-300 border-blue-500 hover:bg-blue-900/50'
              : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800/40'">
            <span class="flex-1 truncate font-medium">{{ member.name }}</span>
            <!-- green dot / clear button -->
            <button v-if="hasAnyChoice(member.code)"
              @click="clearPersonDraft(member.code, $event)"
              class="w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold leading-none transition-colors"
              :class="activeCodes.has(member.code)
                ? 'bg-emerald-400 text-emerald-900 hover:bg-red-500 hover:text-white'
                : 'bg-emerald-700 text-emerald-200 hover:bg-red-700 hover:text-white'"
              title="清除草稿">✓</button>
          </div>
        </div>
        <!-- Sidebar footer: count -->
        <div class="px-2 py-1.5 border-t border-gray-800 text-xs text-gray-700 text-center">
          點名字選取編輯
        </div>
      </div>

      <!-- Main grid ─────────────────────────────────────────────────── -->
      <div class="flex-1 overflow-auto">

        <!-- Empty state -->
        <div v-if="!staff.length" class="flex items-center justify-center h-full text-gray-700 text-sm">
          尚無人員資料，請先在人員Tab新增
        </div>
        <div v-else-if="isLoading" class="flex items-center justify-center h-full text-gray-600 text-sm">
          載入中…
        </div>

        <table v-else class="border-collapse text-xs" style="min-width: max-content">
          <thead>
            <!-- Date row -->
            <tr class="sticky top-0 z-20">
              <th class="sticky left-0 z-30 bg-gray-900 border-b border-r border-gray-800 px-3 py-2 text-left font-semibold text-gray-400 min-w-[7rem]">
                姓名
              </th>
              <th v-for="day in dayLabels" :key="day.d"
                class="sticky top-0 z-20 border-b border-gray-800 text-center font-semibold w-9 py-2"
                :class="day.isSat ? 'bg-blue-950 text-blue-300'
                      : day.isSun ? 'bg-red-950 text-red-300'
                      :             'bg-gray-900 text-gray-400'">
                {{ day.d }}
              </th>
            </tr>
            <!-- DOW row -->
            <tr class="sticky top-[33px] z-20">
              <th class="sticky left-0 z-30 bg-gray-900 border-b border-r border-gray-800 px-3 py-1 text-xs text-gray-600 font-normal text-left">
                第1志願
              </th>
              <th v-for="day in dayLabels" :key="day.d"
                class="border-b border-gray-800 text-center py-1 font-normal"
                :class="day.isSat ? 'bg-blue-950/60 text-blue-400'
                      : day.isSun ? 'bg-red-950/60 text-red-400'
                      :             'bg-gray-900 text-gray-600'">
                {{ DOW[day.dow] }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in staff" :key="member.code" class="group">
              <!-- Name cell (click to toggle) -->
              <td
                @click="toggleActive(member.code)"
                class="sticky left-0 z-10 border-b border-r border-gray-800 px-3 py-1.5 font-medium whitespace-nowrap min-w-[7rem] cursor-pointer transition-colors border-l-2"
                :class="activeCodes.has(member.code)
                  ? 'bg-blue-900/40 text-blue-200 border-blue-500'
                  : 'bg-gray-950 group-hover:bg-gray-900/60 text-gray-400 border-transparent hover:text-gray-200'">
                <span class="flex items-center gap-1.5">
                  {{ member.name }}
                  <span v-if="hasAnyChoice(member.code) && !activeCodes.has(member.code)"
                    class="w-1.5 h-1.5 rounded-full bg-emerald-700 flex-shrink-0"></span>
                </span>
              </td>
              <!-- Day cells -->
              <td v-for="day in dayLabels" :key="day.d"
                class="border-b border-gray-800/60 text-center py-1 relative transition-colors"
                :class="[
                  activeCodes.has(member.code)
                    ? 'cursor-pointer hover:bg-blue-900/20'
                    : 'cursor-default',
                  day.isSat ? 'bg-blue-950/5' : day.isSun ? 'bg-red-950/5' : '',
                ]"
                @click="openCell(member.code, day.d - 1, $event)">

                <!-- v1 badge -->
                <span v-if="getDraftDay(member.code, day.d - 1).v1"
                  class="inline-block px-0.5 py-0.5 rounded text-xs font-semibold leading-tight w-7 text-center"
                  :style="shiftStyle(getDraftDay(member.code, day.d - 1).v1)">
                  {{ getDraftDay(member.code, day.d - 1).v1 }}
                </span>
                <span v-else
                  class="inline-block w-7 text-center"
                  :class="activeCodes.has(member.code) ? 'text-gray-700' : 'text-gray-900'">·</span>

                <!-- v2 dot (bottom-right) -->
                <span v-if="getDraftDay(member.code, day.d - 1).v2"
                  class="absolute bottom-0.5 right-0.5 w-1 h-1 rounded-full bg-violet-500"
                  :title="`v2: ${getDraftDay(member.code, day.d - 1).v2}`"></span>
                <!-- v3 dot (bottom-left) -->
                <span v-if="getDraftDay(member.code, day.d - 1).v3"
                  class="absolute bottom-0.5 left-0.5 w-1 h-1 rounded-full bg-amber-500"
                  :title="`v3: ${getDraftDay(member.code, day.d - 1).v3}`"></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Cell picker ───────────────────────────────────────────────── -->
    <Transition name="picker">
      <div v-if="activeCell"
        class="fixed inset-0 z-50"
        @click.self="activeCell = null">
        <div
          class="absolute bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 space-y-2 min-w-[210px]"
          :style="{ left: activeCell.px + 'px', top: activeCell.py + 'px' }">
          <!-- v1 / v2 / v3 rows -->
          <div v-for="vn in ([1, 2, 3] as const)" :key="vn"
            class="flex items-center gap-1.5">
            <span class="text-xs w-12 flex-shrink-0"
              :class="vn === 1 ? 'text-blue-400' : vn === 2 ? 'text-violet-400' : 'text-amber-400'">
              第{{ vn === 1 ? '1' : vn === 2 ? '2' : '3' }}志願
            </span>
            <button v-for="shift in shifts" :key="shift.code"
              @click="setChoice(vn, shift.code)"
              class="text-xs font-bold px-1.5 py-0.5 rounded transition-all hover:scale-110 hover:brightness-125"
              :style="shiftStyle(shift.code)"
              :class="getDraftDay(activeCell!.code, activeCell!.dayIdx)[`v${vn}` as 'v1'|'v2'|'v3'] === shift.code
                ? 'ring-2 ring-white/60 scale-105' : ''">
              {{ shift.code }}
            </button>
            <button
              @click="setChoice(vn, null)"
              class="text-xs px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-600 hover:text-gray-300 transition-colors">
              ×
            </button>
          </div>
          <!-- Footer: clear all + close -->
          <div class="flex items-center justify-between pt-1 border-t border-gray-800">
            <button @click="clearDay"
              class="text-xs text-red-700 hover:text-red-500 transition-colors">
              清除本日
            </button>
            <button @click="activeCell = null"
              class="text-xs text-gray-600 hover:text-gray-400 transition-colors">
              關閉
            </button>
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.picker-enter-active { transition: opacity 0.1s, transform 0.12s; }
.picker-enter-from   { opacity: 0; transform: scale(0.92); }
.picker-leave-active { transition: opacity 0.08s; }
.picker-leave-to     { opacity: 0; }
</style>
