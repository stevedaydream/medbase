<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { getDb } from "@/db";
import * as XLSX from "xlsx";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import LoginModal, { type SessionUser } from "@/components/scheduler/LoginModal.vue";
import RotationTab  from "@/components/scheduler/RotationTab.vue";
import RequestsTab  from "@/components/scheduler/RequestsTab.vue";
import BookingTab   from "@/components/scheduler/BookingTab.vue";
import { runProjection, DEFAULT_POOLS, type RotationPool } from "@/utils/rotationEngine";
import { useShifts, isDerived, type Shift, type ShiftTargets } from "@/composables/useShifts";
import { useStaff } from "@/composables/useStaff";

// ── Types ─────────────────────────────────────────────────────────────
interface ScheduleRow {
  name: string;
  days: (string | null)[]; // length 31, index 0 = day 1
}
export interface RequestEntry {
  code: string;
  name: string;
  submittedAt: string;
  status: "pending" | "adopted" | "ignored";
  days: Array<{ v1: string | null; v2: string | null; v3: string | null }>;
}

// ── Settings ──────────────────────────────────────────────────────────
const settings = ref({
  spreadsheetId: "",
  apiKey: "",
  gasUrl: "",
  localPath: "",
  sheetPrefix: "Schedule_",
});
const showGasHelp   = ref(false);
const showGuide     = ref(false);
const guideStep     = ref<1|2|3>(1);
const lastSync      = ref("");
const newMonthMsg   = ref("");
const scheduleStatus = ref<"draft" | "published">("draft");

// ── Rotation Pools ────────────────────────────────────────────────────
const rotationPools       = ref<RotationPool[]>([]);
const projectionBasePools = ref<RotationPool[]>([]); // previous-month snapshot

// ── Requests ──────────────────────────────────────────────────────────
const requests = ref<RequestEntry[]>([]);

// ── Session & Tabs ────────────────────────────────────────────────────
// TODO: 開發模式，移除前記得改回 null
const session = ref<SessionUser | null>({ code: "super", name: "系統管理員", role: "super" });

type TabKey = "schedule" | "rotation" | "requests" | "booking" | "staff" | "settings";
const activeTab = ref<TabKey>("schedule");

const ROLE_LABELS: Record<string, string> = {
  super: "超級管理員", admin: "管理者", scheduler: "排班者", employee: "員工",
};

const ALL_TABS: { key: TabKey; label: string; roles: string[] }[] = [
  { key: "schedule",  label: "班表",  roles: ["super", "admin", "scheduler", "employee"] },
  { key: "rotation",  label: "輪序",  roles: ["super", "admin", "scheduler"] },
  { key: "requests",  label: "請求",  roles: ["super", "admin", "scheduler"] },
  { key: "booking",   label: "預約",  roles: ["super", "admin", "scheduler", "employee"] },
  { key: "staff",     label: "人員",  roles: ["super", "admin"] },
  { key: "settings",  label: "設定",  roles: ["super", "admin", "scheduler"] },
];

const visibleTabs = computed(() =>
  session.value
    ? ALL_TABS.filter(t => t.roles.includes(session.value!.role))
    : []
);

// ── Schedule State ────────────────────────────────────────────────────
const now          = new Date();
const currentYear  = ref(now.getFullYear());
const currentMonth = ref(now.getMonth() + 1);
const scheduleData = ref<ScheduleRow[]>([]);
const isLoading    = ref(false);
const newNameInput = ref("");
const showAddRow   = ref(false);

// ── Holiday List ──────────────────────────────────────────────────────
interface HolidayEntry { date: string; description?: string; type?: "holiday" | "a0" | "b0" }
const holidayList = ref<HolidayEntry[]>([]);
// Only real government holidays (not regular Sat/Sun weekends) drive the orange colour
const holidaySet  = computed(() => new Set(
  holidayList.value.filter(h => !h.type || h.type === "holiday").map(h => h.date)
));
const isHolidayLoading = ref(false);
const newHolidayInput  = ref("");
const expandedShiftIdx = ref<number | null>(null);
const expandedShift    = computed(() =>
  expandedShiftIdx.value !== null ? shifts.value[expandedShiftIdx.value] : null
);

// ── Toast ─────────────────────────────────────────────────────────────
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer);
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
});

// ── Data Freshness ────────────────────────────────────────────────────
type DataSource = "cloud" | "local" | "manual" | null;
const isDirty      = ref(false);
const lastImport   = ref("");   // last local XLSX import time
const lastAutoSave = ref("");   // last auto-save to SQLite time
const dataSource   = ref<DataSource>(null);

// Suppress dirty flag during programmatic loads (pull/import/restore)
let _suppressDirty = false;

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

watch(scheduleData, () => {
  if (_suppressDirty) return;
  isDirty.value = true;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(autoSave, 2000);
}, { deep: true });

async function autoSave() {
  if (!scheduleData.value.length) return;
  const t = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  await setSetting(`schedule_data_${yyyyMM.value}`,    JSON.stringify(scheduleData.value));
  await setSetting(`schedule_source_${yyyyMM.value}`,  dataSource.value ?? "manual");
  await setSetting(`schedule_saved_at_${yyyyMM.value}`, t);
  lastAutoSave.value = t;
}

async function loadScheduleFromDb() {
  try {
    const db   = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM app_settings WHERE key IN (?, ?, ?, ?)",
      [
        `scheduler_schedule_data_${yyyyMM.value}`,
        `scheduler_schedule_source_${yyyyMM.value}`,
        `scheduler_schedule_saved_at_${yyyyMM.value}`,
        `scheduler_schedule_import_at_${yyyyMM.value}`,
      ]
    );
    const kv = Object.fromEntries(rows.map(r => [r.key.replace("scheduler_", ""), r.value]));
    const raw = kv[`schedule_data_${yyyyMM.value}`];
    if (raw) {
      _suppressDirty     = true;
      scheduleData.value = JSON.parse(raw);
      _suppressDirty     = false;
      dataSource.value   = (kv[`schedule_source_${yyyyMM.value}`] as DataSource) ?? null;
      lastAutoSave.value = kv[`schedule_saved_at_${yyyyMM.value}`] ?? "";
      lastImport.value   = kv[`schedule_import_at_${yyyyMM.value}`] ?? "";
      isDirty.value      = false;
    } else {
      scheduleData.value = [];
      dataSource.value   = null;
      lastAutoSave.value = "";
      lastImport.value   = "";
      isDirty.value      = false;
    }
  } catch {
    scheduleData.value = [];
  }
}
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

// ── Computed ──────────────────────────────────────────────────────────
const yyyyMM = computed(() =>
  `${currentYear.value}${String(currentMonth.value).padStart(2, "0")}`
);
const sheetName    = computed(() => `${settings.value.sheetPrefix}${yyyyMM.value}`);
const daysInMonth  = computed(() => new Date(currentYear.value, currentMonth.value, 0).getDate());

// 每月 XLSX 實際路徑：從儲存的基準路徑提取目錄，加上月份檔名
const effectiveXlsxPath = computed((): string => {
  const p = settings.value.localPath;
  if (!p) return "";
  const lastSep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const dir = lastSep >= 0 ? p.substring(0, lastSep + 1) : "";
  return `${dir}schedule_${yyyyMM.value}.xlsx`;
});

// ── Rotation projection ───────────────────────────────────────────────
const codeByName = computed(() => new Map(staff.value.map(s => [s.name, s.code])));

/** key: `${staffCode}-${dayIdx0}` → { shiftCode, fromPool } */
const projectedCells = computed((): Map<string, { shiftCode: string; fromPool: string }> => {
  // Phase F: prefer snapshot from previous month for cross-month continuity
  const basePools = projectionBasePools.value.length ? projectionBasePools.value : rotationPools.value;
  if (!basePools.length) return new Map();
  const projection = runProjection(basePools, currentYear.value, currentMonth.value);
  const m = new Map<string, { shiftCode: string; fromPool: string }>();
  for (const [key, assignments] of projection) {
    const day = parseInt(key.split("-")[0]);
    for (const a of assignments) {
      m.set(`${a.code}-${day - 1}`, { shiftCode: a.shiftCode, fromPool: a.fromPool });
    }
  }
  return m;
});

function getProjectedCell(rowName: string, dayIdx: number) {
  const code = codeByName.value.get(rowName);
  if (!code) return undefined;
  return projectedCells.value.get(`${code}-${dayIdx}`);
}

function projectedStyleObj(shiftCode: string): Record<string, string> {
  const shift = shifts.value.find(s => s.code === shiftCode);
  const color = colorOf(shift?.color ?? "gray");
  return {
    backgroundColor: color.bg,
    color: color.text,
    opacity: "0.55",
    border: `1.5px dashed ${color.text}80`,
  };
}

// ── Request map (for grid badges) ─────────────────────────────────────
const requestMap = computed((): Map<string, { v1: string | null; v2: string | null; v3: string | null; status: string }> => {
  const m = new Map<string, { v1: string|null; v2: string|null; v3: string|null; status: string }>();
  for (const req of requests.value) {
    req.days.forEach((day, di) => {
      if (day.v1 || day.v2 || day.v3)
        m.set(`${req.code}-${di}`, { ...day, status: req.status });
    });
  }
  return m;
});

function getRequestBadge(rowName: string, dayIdx: number) {
  const code = codeByName.value.get(rowName);
  if (!code) return null;
  const entry = requestMap.value.get(`${code}-${dayIdx}`);
  if (!entry || (!entry.v1 && !entry.v2 && !entry.v3)) return null;
  const actual = scheduleData.value.find(r => r.name === rowName)?.days[dayIdx] ?? null;
  const parts = [
    entry.v1 && `第1志願：${entry.v1}`,
    entry.v2 && `第2志願：${entry.v2}`,
    entry.v3 && `第3志願：${entry.v3}`,
  ].filter(Boolean).join("，");
  if (actual) {
    return actual === entry.v1
      ? { text: "✓", cls: "bg-emerald-700 text-emerald-200", tip: parts }
      : { text: entry.v1 ?? "?", cls: "bg-gray-700 text-gray-400", tip: parts };
  }
  const vn = entry.v1 ? "1" : entry.v2 ? "2" : "3";
  return { text: vn, cls: "bg-orange-700 text-orange-200", tip: parts };
}

interface DayMeta { d: number; dow: number; isSat: boolean; isSun: boolean; isHoliday: boolean }
const dayLabels = computed<DayMeta[]>(() =>
  Array.from({ length: daysInMonth.value }, (_, i) => {
    const d   = i + 1;
    const dow = new Date(currentYear.value, currentMonth.value - 1, d).getDay();
    const ds  = `${currentYear.value}-${String(currentMonth.value).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return { d, dow, isSat: dow === 6, isSun: dow === 0, isHoliday: holidaySet.value.has(ds) };
  })
);
const DOW = ["日", "一", "二", "三", "四", "五", "六"];

// ── Shift System ──────────────────────────────────────────────────────
const {
  shifts, newShiftCode,
  colorOf, shiftStyleObj, saveShifts, addShift, removeShift, cycleShiftColor,
} = useShifts(setSetting);

function countShift(row: ScheduleRow, code: string) {
  return row.days.filter(d => d === code).length;
}
function quotaStatus(row: ScheduleRow, shift: Shift): "over" | "under" | "met" | "none" {
  if (!shift.target) return "none";
  const actual = countShift(row, shift.code);
  if (actual > shift.target) return "over";
  if (actual < shift.target) return "under";
  return "met";
}
function totalShiftStaff(di: number, code: string) {
  return scheduleData.value.filter(r => r.days[di] === code).length;
}

// ── Daily Quota System ────────────────────────────────────────────────
const DAY_TYPE_LABELS = [
  { key: "weekday",  label: "平日"     },
  { key: "saturday", label: "週六"     },
  { key: "sunday",   label: "週日"     },
  { key: "holiday",  label: "國定假日" },
] as const;
type DayTypeKey = typeof DAY_TYPE_LABELS[number]["key"];

function toDateStr(dayIdx: number): string {
  const d = dayIdx + 1;
  return `${currentYear.value}-${String(currentMonth.value).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dayTypeOf(dayIdx: number): DayTypeKey {
  const ds  = toDateStr(dayIdx);
  if (holidaySet.value.has(ds)) return "holiday";
  const dow = new Date(currentYear.value, currentMonth.value - 1, dayIdx + 1).getDay();
  if (dow === 6) return "saturday";
  if (dow === 0) return "sunday";
  return "weekday";
}

function resolveTarget(shift: Shift, dayIdx: number): number | null {
  const t = shift.targets;
  if (!t) return null;
  const dt  = dayTypeOf(dayIdx);
  const raw = t[dt] ?? t.weekday;
  if (raw === undefined) return null;
  if (isDerived(raw)) {
    const total    = scheduleData.value.length;
    const subtract = raw.subtract.reduce(
      (sum, code) => sum + scheduleData.value.filter(r => r.days[dayIdx] === code).length,
      0
    );
    return Math.max(0, total - subtract);
  }
  return raw as number;
}

function dayQuotaStatus(shift: Shift, dayIdx: number): "over" | "under" | "met" | "none" {
  const target = resolveTarget(shift, dayIdx);
  if (target === null) return "none";
  const actual = totalShiftStaff(dayIdx, shift.code);
  if (actual > target) return "over";
  if (actual < target) return "under";
  return "met";
}

async function loadHolidays() {
  try {
    const db   = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = ?",
      [`scheduler_holidays_${currentYear.value}`]
    );
    if (rows[0]?.value) {
      const parsed = JSON.parse(rows[0].value);
      // backward compat: old format was plain string[]
      if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0] === "string")) {
        holidayList.value = (parsed as string[]).map(d => ({ date: d }));
      } else {
        holidayList.value = parsed as HolidayEntry[];
      }
    } else {
      holidayList.value = [];
    }
  } catch { holidayList.value = []; }
}

async function saveHolidays() {
  await setSetting(`holidays_${currentYear.value}`, JSON.stringify(holidayList.value));
}

async function fetchHolidaysFromApi() {
  isHolidayLoading.value = true;
  try {
    const url = `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${currentYear.value}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: Array<{ date: string; isHoliday: boolean; description?: string }> = await res.json();
    const newEntries: HolidayEntry[] = data
      .filter(d => d.isHoliday)
      .map(d => {
        const s    = String(d.date);
        const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        const desc = d.description ?? "";
        const type: HolidayEntry["type"] =
          desc === "休息日" ? "a0" : desc === "例假日" ? "b0" : "holiday";
        return { date, description: desc || undefined, type };
      });
    const dateMap = new Map(holidayList.value.map(h => [h.date, h]));
    for (const e of newEntries) dateMap.set(e.date, e);
    holidayList.value = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    await saveHolidays();
    showToast(`已匯入 ${newEntries.length} 個國定假日（${currentYear.value}年）`);
  } catch (e) {
    showToast(`取得假日失敗：${(e as Error).message}`);
  } finally { isHolidayLoading.value = false; }
}

async function importHolidaysFromCsv() {
  try {
    const picked = await openDialog({
      title: "選擇假日 CSV 檔案",
      filters: [{ name: "CSV 檔案", extensions: ["csv"] }],
    }) as string | null;
    if (!picked) return;
    const raw  = await readFile(picked);
    const text = new TextDecoder().decode(raw);
    const newEntries: HolidayEntry[] = [];
    for (const line of text.split("\n")) {
      const cols = line.split(",");
      const col0 = cols[0]?.trim();
      const col1 = cols[1]?.trim(); // holiday name
      const col2 = cols[2]?.trim();
      if (col0 && /^\d{8}$/.test(col0) && col2 === "2") {
        newEntries.push({
          date: `${col0.slice(0, 4)}-${col0.slice(4, 6)}-${col0.slice(6, 8)}`,
          description: col1 || undefined,
        });
      }
    }
    const dateMap = new Map(holidayList.value.map(h => [h.date, h]));
    for (const e of newEntries) dateMap.set(e.date, e);
    holidayList.value = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    await saveHolidays();
    showToast(`已匯入 ${newEntries.length} 個假日`);
  } catch (e) {
    showToast(`匯入失敗：${(e as Error).message}`);
  }
}

function addHoliday() {
  const d = newHolidayInput.value.trim();
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { showToast("格式需為 YYYY-MM-DD"); return; }
  if (!holidayList.value.some(h => h.date === d)) {
    holidayList.value = [...holidayList.value, { date: d }]
      .sort((a, b) => a.date.localeCompare(b.date));
    saveHolidays();
  }
  newHolidayInput.value = "";
}

function removeHoliday(d: string) {
  holidayList.value = holidayList.value.filter(h => h.date !== d);
  saveHolidays();
}

// Shift daily-target editing helpers
function toggleTargetMode(si: number, key: DayTypeKey) {
  const shift = shifts.value[si];
  if (!shift.targets) shift.targets = {} as ShiftTargets;
  const cur = shift.targets[key];
  shift.targets[key] = isDerived(cur) ? 0 : { subtract: [] };
  saveShifts();
}

function setFixedTarget(si: number, key: DayTypeKey, e: Event) {
  const val   = (e.target as HTMLInputElement).value;
  const shift = shifts.value[si];
  if (!shift.targets) shift.targets = {} as ShiftTargets;
  shift.targets[key] = val === "" ? undefined : parseInt(val);
  saveShifts();
}

function toggleSubtract(si: number, key: DayTypeKey, code: string, e: Event) {
  const shift = shifts.value[si];
  if (!shift.targets) return;
  const cur = shift.targets[key];
  if (!isDerived(cur)) return;
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) {
    if (!cur.subtract.includes(code)) cur.subtract.push(code);
  } else {
    const idx = cur.subtract.indexOf(code);
    if (idx >= 0) cur.subtract.splice(idx, 1);
  }
  saveShifts();
}

// ── Settings Persistence ──────────────────────────────────────────────
onMounted(async () => { await loadSettings(); });

async function loadSettings() {
  try {
    const db   = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM app_settings WHERE key LIKE 'scheduler_%'"
    );
    const m = Object.fromEntries(rows.map(r => [r.key.replace("scheduler_", ""), r.value]));
    if (m.spreadsheet_id)  settings.value.spreadsheetId = m.spreadsheet_id;
    if (m.api_key)         settings.value.apiKey        = m.api_key;
    if (m.gas_url)         settings.value.gasUrl        = m.gas_url;
    if (m.local_path)      settings.value.localPath     = m.local_path;
    if (m.sheet_prefix)    settings.value.sheetPrefix   = m.sheet_prefix || "Schedule_";
    if (m.last_sync)       lastSync.value               = m.last_sync;
    if (m.shifts)          shifts.value                 = JSON.parse(m.shifts);
    if (m.staff)           staff.value                  = JSON.parse(m.staff);
    if (m.rotation_pools)  rotationPools.value          = JSON.parse(m.rotation_pools);
    else                   rotationPools.value          = DEFAULT_POOLS.map(p => ({ ...p }));
  } catch { /* first launch */ }
  await loadMonthStatus();
  await loadProjectionBase();
  await loadScheduleFromDb();
  await loadHolidays();
}

watch(yyyyMM, () => { loadMonthStatus(); loadProjectionBase(); loadScheduleFromDb(); });
watch(() => currentYear.value, loadHolidays);

async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
    [`scheduler_${key}`, value]
  );
}

async function saveAllSettings() {
  await setSetting("spreadsheet_id", settings.value.spreadsheetId);
  await setSetting("api_key",        settings.value.apiKey);
  await setSetting("gas_url",        settings.value.gasUrl);
  await setSetting("local_path",     settings.value.localPath);
  await setSetting("sheet_prefix",   settings.value.sheetPrefix);
  showToast("設定已儲存");
}

async function saveRotationPools() {
  await setSetting("rotation_pools", JSON.stringify(rotationPools.value));
}

async function onPoolsUpdate(newPools: RotationPool[]) {
  rotationPools.value = newPools;
  await saveRotationPools();
}

// ── Request handlers ──────────────────────────────────────────────────
function onRequestsPulled(newRequests: RequestEntry[]) {
  requests.value = newRequests;
}

function onAdoptRequest(code: string) {
  const req    = requests.value.find(r => r.code === code);
  const member = staff.value.find(s => s.code === code);
  if (!req || !member) return;
  const row = scheduleData.value.find(r => r.name === member.name);
  if (!row) { showToast(`找不到 ${member.name} 的班表列`); return; }
  let applied = 0;
  req.days.forEach((day, di) => {
    if (row.days[di] === null && day.v1) { row.days[di] = day.v1; applied++; }
  });
  req.status = "adopted";
  showToast(applied ? `已採納 ${member.name} 的 ${applied} 格志願` : `${member.name} 無新志願可採納`);
}

function onIgnoreRequest(code: string) {
  const req = requests.value.find(r => r.code === code);
  if (req) req.status = "ignored";
}

// ── Phase F: cross-month projection base ─────────────────────────────
async function loadProjectionBase() {
  const m = currentMonth.value;
  const y = currentYear.value;
  const prevMM = m === 1
    ? `${y - 1}12`
    : `${y}${String(m - 1).padStart(2, "0")}`;
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = ?",
      [`scheduler_proposed_pools_${prevMM}`]
    );
    projectionBasePools.value = rows[0]?.value ? JSON.parse(rows[0].value) : [];
  } catch { projectionBasePools.value = []; }
}

function applyRotationToSchedule() {
  let applied = 0;
  for (const row of scheduleData.value) {
    for (let di = 0; di < daysInMonth.value; di++) {
      if (row.days[di] === null) {
        const proj = getProjectedCell(row.name, di);
        if (proj) {
          row.days[di] = proj.shiftCode;
          applied++;
        }
      }
    }
  }
  showToast(applied ? `已套用 ${applied} 格輪序` : "無可套用的輪序投影");
}

// ── Parse Sheets / XLSX values → ScheduleRow[] ───────────────────────
function parseValues(values: string[][]): ScheduleRow[] {
  if (!values || values.length < 2) return [];

  // Detect new multi-header format: look for a "姓名" row in the first 10 rows
  let dataStart = -1;
  let dayCol    = 1; // column index where day 1 lives (old=1, new=2)

  for (let i = 0; i < Math.min(values.length, 10); i++) {
    if (values[i][0]?.toString().trim() === "姓名") {
      dataStart = i + 1;
      dayCol    = 1;
      break;
    }
  }

  if (dataStart < 0) {
    // Old / Google Sheets format: single header row
    const first   = values[0][0]?.toLowerCase() ?? "";
    const isHeader = /id|name|姓名|userId/.test(first) || !/^[DN]$|off|am/i.test(first);
    dataStart = isHeader ? 1 : 0;
    dayCol    = 1;
  }

  // Reverse-lookup map: code+name → bare name (for reimporting our own exports)
  const nameByFull = new Map(staff.value.map(s => [`${s.code}${s.name}`, s.name]));
  const shiftMap   = new Map(shifts.value.map(s => [s.code.toUpperCase(), s.code]));
  const stopNames  = new Set(["放假人數"]);

  return values.slice(dataStart)
    .filter(row => {
      const v = row[0]?.toString().trim();
      return v && !stopNames.has(v);
    })
    .map(row => {
      const raw  = row[0].toString().trim();
      const name = nameByFull.get(raw) ?? raw;
      return {
        name,
        days: Array.from({ length: 31 }, (_, i) => {
          const v = row[dayCol + i]?.toString().trim().toUpperCase();
          if (!v) return null;
          return shiftMap.get(v) ?? row[dayCol + i]?.toString().trim() ?? null;
        }),
      };
    });
}

// ── Pull from Google Sheets ───────────────────────────────────────────
async function pullFromCloud() {
  if (!settings.value.spreadsheetId || !settings.value.apiKey) {
    activeTab.value = "settings";
    showToast("請先設定 Spreadsheet ID 與 API Key");
    return;
  }
  isLoading.value = true;
  try {
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${settings.value.spreadsheetId}` +
      `/values/${encodeURIComponent(sheetName.value)}?key=${settings.value.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      const msg: string = err?.error?.message ?? "";
      // Google Sheets returns 400 when the sheet tab doesn't exist
      if (res.status === 400 && msg.toLowerCase().includes("unable to parse range")) {
        await createNewMonthSheet();
        return;
      }
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const json = await res.json();
    _suppressDirty     = true;
    scheduleData.value = parseValues(json.values ?? []);
    _suppressDirty     = false;
    dataSource.value   = "cloud";
    lastImport.value   = "";
    isDirty.value      = false;
    await recordSync();
    await autoSave();
    showToast(`雲端同步完成，共 ${scheduleData.value.length} 人`);
    if (settings.value.localPath) await doWriteXlsx(false);
  } catch (e) {
    showToast(`雲端同步失敗：${(e as Error).message}`);
  } finally {
    isLoading.value = false;
  }
}

async function createNewMonthSheet() {
  const label = `${currentYear.value}/${String(currentMonth.value).padStart(2, "0")}`;
  showToast(`雲端找不到 ${sheetName.value}，正在建立新月份…`);
  // Init rows from staff list (or empty)
  scheduleData.value = staff.value.length
    ? staff.value.map(s => ({ name: s.name, days: Array(31).fill(null) as (string|null)[] }))
    : [];
  // Push to GAS — GAS will create the sheet tab
  if (settings.value.gasUrl) {
    await fetch(settings.value.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "batchSaveShifts",
        yyyyMM: yyyyMM.value,
        sheetName: sheetName.value,
        data: scheduleData.value.map(r => ({ name: r.name, days: r.days })),
      }),
      mode: "no-cors",
    });
  }
  if (settings.value.localPath) await doWriteXlsx(false);
  await recordSync();
  newMonthMsg.value = `已為 ${label} 建立新班表` +
    (scheduleData.value.length ? `，已套用 ${scheduleData.value.length} 位人員` : "，人員名單為空");
  setTimeout(() => { newMonthMsg.value = ""; }, 6000);
}

// ── Export to local XLSX ──────────────────────────────────────────────
async function exportXlsx() {
  if (!settings.value.localPath) {
    const path = await saveDialog({
      title: "選擇本地 XLSX 儲存位置",
      defaultPath: `schedule_${yyyyMM.value}.xlsx`,
      filters: [{ name: "Excel 活頁簿", extensions: ["xlsx"] }],
    }) as string | null;
    if (!path) return;
    settings.value.localPath = path;
    await setSetting("local_path", path);
  }
  await doWriteXlsx(true);
}

async function doWriteXlsx(notify: boolean) {
  const target = effectiveXlsxPath.value;
  if (!target) return;

  const days = daysInMonth.value;
  const y    = currentYear.value;
  const m    = currentMonth.value;
  const roc  = y - 1911;

  // Excel serial: days since Dec 30, 1899
  const toSerial = (day: number) => {
    const ms    = new Date(Date.UTC(y, m - 1, day)).getTime();
    const epoch = new Date(Date.UTC(1899, 11, 30)).getTime();
    return Math.round((ms - epoch) / 86400000);
  };

  // Column layout:
  //   col 0         : name (code+name)
  //   col 1..days   : shifts for days 1..N
  //   col days+1    : separator (AG for 31-day month)
  //   col days+2..  : per-shift counts (AH for 31-day month → matches COUNTIF formula)
  const sepIdx     = 1 + days;
  const totIdx     = sepIdx + 1;   // first shift-count column
  const shiftCodes = shifts.value.map(s => s.code);
  const totalCols  = totIdx + shiftCodes.length;

  // Helper: count occurrences of a shift code in a days array (first N days)
  const countCode = (dayArr: (string | null)[], code: string) =>
    dayArr.slice(0, days).filter(v => v === code).length;

  // ── Row 0: department + shift averages ──────────────────────────────
  const empCount = scheduleData.value.length || 1;
  const row0: (string | number | null)[] = Array(totalCols).fill(null);
  shiftCodes.slice(0, 3).forEach((code, i) => {
    const total = scheduleData.value.reduce((s, r) => s + countCode(r.days, code), 0);
    row0[3 + i * 3]     = `${code}平均=`;
    row0[3 + i * 3 + 1] = null;
    row0[3 + i * 3 + 2] = Math.round((total / empCount) * 10) / 10;
  });

  // ── Row 1: year / month ─────────────────────────────────────────────
  // Year at col 5 (F2 = $F$2), month at col 8 (I2 = $I$2)
  const row1: (string | number | null)[] = Array(totalCols).fill(null);
  row1[2] = "密碼";
  row1[3] = "0000";
  row1[5] = y;
  row1[6] = `(${roc} 年 )`;
  row1[8] = m;
  row1[9] = "月";

  // ── Row 2: column label row ─────────────────────────────────────────
  const row2: (string | number | null)[] = Array(totalCols).fill("");
  row2[0] = "特殊日期標註";
  for (let d = 1; d <= days; d++) {
    const ds    = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow   = new Date(y, m - 1, d).getDay();
    const entry = holidayList.value.find(h => h.date === ds);
    if (entry?.description) {
      row2[d] = entry.description;
    } else if (dow === 6) {
      row2[d] = "休息日";
    } else if (dow === 0) {
      row2[d] = "例假日";
    } else {
      row2[d] = "";
    }
  }
  row2[sepIdx] = 0;
  shiftCodes.forEach((code, i) => { row2[totIdx + i] = code; });

  // ── Row 3: date serial row ──────────────────────────────────────────
  const row3: (string | number | null)[] = Array(totalCols).fill(null);
  row3[0] = "日期";
  for (let d = 1; d <= days; d++) row3[d] = toSerial(d);
  row3[sepIdx] = "";
  shiftCodes.forEach((code, i) => { row3[totIdx + i] = code; });

  // ── Row 4: day-of-week / 姓名 row ───────────────────────────────────
  const row4: (string | number | null)[] = Array(totalCols).fill(null);
  row4[0] = "姓名";
  for (let d = 1; d <= days; d++) {
    const w = new Date(y, m - 1, d).getDay();
    row4[d] = w === 0 ? "日" : w;
  }
  row4[sepIdx] = "";

  // ── Employee rows ───────────────────────────────────────────────────
  const staffByName = new Map(staff.value.map(s => [s.name, s]));
  const empRows = scheduleData.value.map(row => {
    const member  = staffByName.get(row.name);
    const colName = member ? `${member.code}${row.name}` : row.name;

    const r: (string | number | null)[] = Array(totalCols).fill(null);
    r[0] = colName;
    for (let d = 0; d < days; d++) r[1 + d] = row.days[d] ?? "";
    r[sepIdx] = null;
    shiftCodes.forEach((code, i) => { r[totIdx + i] = countCode(row.days, code); });
    return r;
  });

  // ── 放假人數 row ────────────────────────────────────────────────────
  const leaveRow: (string | number | null)[] = Array(totalCols).fill(null);
  leaveRow[0] = "放假人數";
  for (let d = 0; d < days; d++) {
    leaveRow[1 + d] = scheduleData.value.filter(r => !r.days[d]).length;
  }
  leaveRow[sepIdx] = "";
  shiftCodes.forEach((code, i) => {
    leaveRow[totIdx + i] = scheduleData.value.reduce(
      (sum, r) => sum + countCode(r.days, code), 0
    );
  });

  const aoa = [row0, row1, row2, row3, row4, ...empRows, leaveRow];
  const ws  = XLSX.utils.aoa_to_sheet(aoa);

  // ── COUNTIF formulas for employee shift-count columns ────────────────
  // Employee rows: SheetJS r=5..5+N-1  →  Excel rows 6..5+N
  // Day range: col B (1) to col <lastDay> (days)
  // e.g. 31-day month: =COUNTIF(B6:AF6,"D")  at AH6
  const dayRangeEnd = XLSX.utils.encode_col(days); // "AF" for 31 days
  scheduleData.value.forEach((row, ei) => {
    const r      = 5 + ei;
    const xlRow  = r + 1;
    shiftCodes.forEach((code, i) => {
      ws[XLSX.utils.encode_cell({ r, c: totIdx + i })] = {
        t: "n",
        f: `COUNTIF(B${xlRow}:${dayRangeEnd}${xlRow},"${code}")`,
        v: countCode(row.days, code),
      };
    });
  });

  // ── SUM formulas for 放假人數 shift totals ───────────────────────────
  const leaveR   = 5 + scheduleData.value.length;
  const empFirst = 6;
  const empLast  = 5 + scheduleData.value.length;
  shiftCodes.forEach((code, i) => {
    const col = XLSX.utils.encode_col(totIdx + i);
    ws[XLSX.utils.encode_cell({ r: leaveR, c: totIdx + i })] = {
      t: "n",
      f: `SUM(${col}${empFirst}:${col}${empLast})`,
      v: scheduleData.value.reduce((s, r) => s + countCode(r.days, code), 0),
    };
  });

  // Override date row (Excel row 4, SheetJS r=3) with formulas + format "d" (day only).
  // Year at $F$2 (row1[5]), month at $I$2 (row1[8]).
  // B4 = =DATE($F$2,$I$2,1) ; C4 = =B4+1 ; D4 = =C4+1 ; …
  const dateR = 3;
  ws[XLSX.utils.encode_cell({ r: dateR, c: 1 })] = {
    t: "n", f: "DATE($F$2,$I$2,1)", v: toSerial(1), z: "d",
  };
  for (let d = 1; d < days; d++) {
    const prev = XLSX.utils.encode_cell({ r: dateR, c: 1 + d - 1 });
    ws[XLSX.utils.encode_cell({ r: dateR, c: 1 + d })] = {
      t: "n", f: `${prev}+1`, v: toSerial(d + 1), z: "d",
    };
  }

  // Override day-of-week row (Excel row 5, SheetJS r=4) with formulas.
  // =IFERROR(MID("一二三四五六日",WEEKDAY(B4,2),1),"")
  const dowR   = 4;
  const chiDow = ["日", "一", "二", "三", "四", "五", "六"];
  for (let d = 0; d < days; d++) {
    const dateCell = XLSX.utils.encode_cell({ r: dateR, c: 1 + d });
    const preCalc  = chiDow[new Date(y, m - 1, d + 1).getDay()];
    ws[XLSX.utils.encode_cell({ r: dowR, c: 1 + d })] = {
      t: "s",
      f: `IFERROR(MID("一二三四五六日",WEEKDAY(${dateCell},2),1),"")`,
      v: preCalc,
    };
  }

  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.value);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  await writeFile(target, buf);
  if (notify) {
    isDirty.value = false;
    await autoSave();
    showToast(`已儲存：schedule_${yyyyMM.value}.xlsx`);
  }
}

// ── Import from local XLSX ────────────────────────────────────────────
async function importXlsx() {
  // 優先嘗試當月 XLSX，沒有再開對話框
  let path = effectiveXlsxPath.value || settings.value.localPath;
  if (!path) {
    const picked = await openDialog({
      title: "選擇 XLSX 班表檔案",
      filters: [{ name: "Excel 活頁簿", extensions: ["xlsx", "xls"] }],
    }) as string | null;
    if (!picked) return;
    path = picked;
    settings.value.localPath = path;
    await setSetting("local_path", path);
  }
  try {
    const data = await readFile(path);
    const wb   = XLSX.read(data, { type: "array" });
    // Try current month sheet, fall back to first sheet
    const ws   = wb.Sheets[sheetName.value] ?? wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("找不到對應班表分頁");
    const values = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" }) as string[][];
    _suppressDirty     = true;
    scheduleData.value = parseValues(values);
    _suppressDirty     = false;
    const t            = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    dataSource.value   = "local";
    lastImport.value   = t;
    isDirty.value      = false;
    await setSetting(`schedule_import_at_${yyyyMM.value}`, t);
    await autoSave();
    showToast(`已從本地匯入 ${scheduleData.value.length} 人資料`);
  } catch (e) {
    showToast(`匯入失敗：${(e as Error).message}`);
  }
}

// ── Push to Google Sheets via GAS ────────────────────────────────────
async function pushToCloud() {
  if (!settings.value.gasUrl) {
    activeTab.value = "settings";
    showToast("請先設定 GAS Web App URL");
    return;
  }
  if (scheduleData.value.length === 0) { showToast("尚無資料"); return; }
  isLoading.value = true;
  try {
    // First sync local XLSX
    if (settings.value.localPath) await doWriteXlsx(false);
    await fetch(settings.value.gasUrl, {
      method:  "POST",
      headers: { "Content-Type": "text/plain" }, // avoid preflight
      body:    JSON.stringify({
        action:    "batchSaveShifts",
        yyyyMM:    yyyyMM.value,
        sheetName: sheetName.value,
        data:      scheduleData.value.map(r => ({ name: r.name, days: r.days })),
      }),
      mode: "no-cors",
    });
    await recordSync();
    isDirty.value = false;
    await autoSave();
    showToast("已上傳至 Google Sheets");
  } catch (e) {
    showToast(`上傳失敗：${(e as Error).message}`);
  } finally {
    isLoading.value = false;
  }
}

async function recordSync() {
  const t   = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  lastSync.value = t;
  await setSetting("last_sync", t);
}

// ── Schedule Status ───────────────────────────────────────────────────
async function loadMonthStatus() {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = ?",
      [`scheduler_status_${yyyyMM.value}`]
    );
    scheduleStatus.value = rows[0]?.value === "published" ? "published" : "draft";
  } catch { scheduleStatus.value = "draft"; }
}

async function publishSchedule() {
  if (scheduleData.value.length === 0) { showToast("尚無資料"); return; }
  if (!confirm("確定發布班表？發布後預約視窗將自動關閉。")) return;
  isLoading.value = true;
  try {
    if (settings.value.localPath) await doWriteXlsx(false);
    if (settings.value.gasUrl) {
      await fetch(settings.value.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action: "batchSaveShifts",
          yyyyMM: yyyyMM.value,
          sheetName: sheetName.value,
          data: scheduleData.value.map(r => ({ name: r.name, days: r.days })),
        }),
        mode: "no-cors",
      });
      await fetch(settings.value.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "saveConfig", key: "booking_open", value: "false" }),
        mode: "no-cors",
      });
    }
    scheduleStatus.value = "published";
    await setSetting(`status_${yyyyMM.value}`, "published");
    // Phase F: save pool snapshot so next month can continue from correct position
    await setSetting(`proposed_pools_${yyyyMM.value}`, JSON.stringify(rotationPools.value));
    await recordSync();
    showToast("班表已發布");
  } catch (e) {
    showToast(`發布失敗：${(e as Error).message}`);
  } finally {
    isLoading.value = false;
  }
}

// ── Staff Management ──────────────────────────────────────────────────
const {
  staff, newStaffCode, newStaffName, staffFilter, isStaffLoading,
  resetPwTarget, resetPwInput, filteredStaff,
  saveStaffLocal, addStaff, removeStaff, importStaffFromSchedule,
  pullStaffFromCloud, pushStaffToCloud, resetUserPassword,
  addRowFromStaff, initScheduleFromStaff,
  onStaffNameFocus, onStaffNameBlur,
} = useStaff({ settings, setSetting, showToast, scheduleData, yyyyMM });

// ── Month Navigation ──────────────────────────────────────────────────
function prevMonth() {
  if (currentMonth.value === 1) { currentYear.value--; currentMonth.value = 12; }
  else currentMonth.value--;
  // loadScheduleFromDb is triggered via watch(yyyyMM)
}
function nextMonth() {
  if (currentMonth.value === 12) { currentYear.value++; currentMonth.value = 1; }
  else currentMonth.value++;
  // loadScheduleFromDb is triggered via watch(yyyyMM)
}

// ── Drag Multi-select ─────────────────────────────────────────────────
let dragStarted       = false;           // plain bool — NOT reactive
const isDragging      = ref(false);      // true only after entering 2nd cell
const dragStart       = ref<{ rowIdx: number; dayIdx: number } | null>(null);
const dragEnd         = ref<{ rowIdx: number; dayIdx: number } | null>(null);
const showDragPicker  = ref(false);
const pickerPos       = ref({ x: 0, y: 0 });
const pickerLeft      = computed(() => Math.min(pickerPos.value.x, window.innerWidth - 280));

const selectedCells = computed((): Set<string> => {
  if (!dragStart.value || !dragEnd.value) return new Set();
  const r1 = Math.min(dragStart.value.rowIdx, dragEnd.value.rowIdx);
  const r2 = Math.max(dragStart.value.rowIdx, dragEnd.value.rowIdx);
  const d1 = Math.min(dragStart.value.dayIdx,  dragEnd.value.dayIdx);
  const d2 = Math.max(dragStart.value.dayIdx,  dragEnd.value.dayIdx);
  const set = new Set<string>();
  for (let r = r1; r <= r2; r++)
    for (let d = d1; d <= d2; d++)
      set.add(`${r}-${d}`);
  return set;
});

function isCellSelected(ri: number, di: number) {
  return selectedCells.value.has(`${ri}-${di}`);
}

function onCellMousedown(e: MouseEvent, rowIdx: number, dayIdx: number) {
  e.preventDefault();
  dragStarted          = true;
  isDragging.value     = false;
  showDragPicker.value = false;
  activeCell.value     = null;
  dragStart.value      = { rowIdx, dayIdx };
  dragEnd.value        = { rowIdx, dayIdx };
}

function onCellMouseenter(rowIdx: number, dayIdx: number) {
  if (!dragStarted) return;
  isDragging.value = true;
  dragEnd.value    = { rowIdx, dayIdx };
}

function onDocumentMouseup(e: MouseEvent) {
  if (!dragStarted) return;
  dragStarted = false;

  if (isDragging.value && selectedCells.value.size > 1) {
    pickerPos.value      = { x: e.clientX, y: e.clientY };
    showDragPicker.value = true;
    setTimeout(() => { isDragging.value = false; }, 50);
  } else {
    isDragging.value = false;
    // Single click → radial menu
    const td = (e.target as HTMLElement).closest("[data-cell]") as HTMLElement | null;
    dragStart.value = null;
    dragEnd.value   = null;
    if (td) {
      const ri   = parseInt(td.dataset.ri!);
      const di   = parseInt(td.dataset.di!);
      const rect = td.getBoundingClientRect();
      activeCell.value = { rowIdx: ri, dayIdx: di, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }
}

function applyBatchShift(code: string | null) {
  if (!dragStart.value || !dragEnd.value) return;
  const r1 = Math.min(dragStart.value.rowIdx, dragEnd.value.rowIdx);
  const r2 = Math.max(dragStart.value.rowIdx, dragEnd.value.rowIdx);
  const d1 = Math.min(dragStart.value.dayIdx,  dragEnd.value.dayIdx);
  const d2 = Math.max(dragStart.value.dayIdx,  dragEnd.value.dayIdx);
  for (let r = r1; r <= r2; r++)
    for (let d = d1; d <= d2; d++)
      scheduleData.value[r].days[d] = code;
  clearDragSelection();
}

function clearDragSelection() {
  dragStart.value      = null;
  dragEnd.value        = null;
  showDragPicker.value = false;
}

onMounted(() => document.addEventListener("mouseup", onDocumentMouseup));
onUnmounted(() => document.removeEventListener("mouseup", onDocumentMouseup));

// ── Radial Shift Menu (single cell) ──────────────────────────────────
interface ActiveCell { rowIdx: number; dayIdx: number; x: number; y: number }
const activeCell = ref<ActiveCell | null>(null);

function selectShift(code: string | null) {
  if (activeCell.value) {
    scheduleData.value[activeCell.value.rowIdx].days[activeCell.value.dayIdx] = code;
  }
  activeCell.value = null;
}

function radialPos(i: number, total: number, radius = 40) {
  const angle = (2 * Math.PI * i) / total - Math.PI / 2;
  return {
    left: `${Math.cos(angle) * radius - 18}px`,
    top:  `${Math.sin(angle) * radius - 18}px`,
  };
}

// ── Add / Remove Row ──────────────────────────────────────────────────
function addRow() {
  const name = newNameInput.value.trim();
  if (!name) return;
  scheduleData.value.push({ name, days: Array(31).fill(null) });
  newNameInput.value = "";
  showAddRow.value   = false;
}
function removeRow(idx: number) {
  if (!confirm(`確定移除「${scheduleData.value[idx].name}」的班表列？`)) return;
  scheduleData.value.splice(idx, 1);
}

// ── Copy helpers ─────────────────────────────────────────────────────
const gasCopied = ref(false);
let gasCopyTimer: ReturnType<typeof setTimeout> | null = null;
onUnmounted(() => { if (gasCopyTimer) clearTimeout(gasCopyTimer); });

// 完整版請部署 gas/scheduler.gs（含 doGet 手機端）
// 以下為桌面端 doPost-only 精簡版
const GAS_CODE = `function doPost(e) {
  const p  = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    switch (p.action) {
      case 'saveStaff': {
        let sh = ss.getSheetByName('Staff') || ss.insertSheet('Staff');
        const hd = ['代號','姓名','角色','pw_hash','啟用'];
        const rw = p.data.map(r => [r.code,r.name,r.role||'employee',r.pw_hash||'',1]);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        break;
      }
      case 'batchSaveShifts':
      case 'saveSchedule': {
        let sh = ss.getSheetByName(p.sheetName) || ss.insertSheet(p.sheetName);
        const hd = ['姓名',...Array.from({length:31},(_,i)=>\`\${i+1}日\`)];
        const rw = p.data.map(r => [r.name,...r.days.map(d=>d||'')]);
        sh.clearContents();
        sh.getRange(1,1,1,hd.length).setValues([hd]);
        if (rw.length) sh.getRange(2,1,rw.length,hd.length).setValues(rw);
        break;
      }
      case 'saveConfig': {
        let cfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
        const vals = cfg.getDataRange().getValues();
        const ri = vals.findIndex(r => r[0] === p.key);
        if (ri >= 0) cfg.getRange(ri+1,2).setValue(p.value);
        else cfg.appendRow([p.key, p.value]);
        break;
      }
      case 'saveRequest': {
        const sn = 'Requests_' + p.yyyyMM;
        let sh = ss.getSheetByName(sn) || ss.insertSheet(sn);
        if (sh.getLastRow() === 0) {
          const hd = ['代號','姓名','提交時間'];
          for (let d=1;d<=31;d++) hd.push(d+'日_v1',d+'日_v2',d+'日_v3');
          sh.getRange(1,1,1,hd.length).setValues([hd]);
        }
        const vals = sh.getDataRange().getValues();
        const ri = vals.findIndex((r,i) => i>0 && r[0]===p.code);
        const now = new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
        const row = [p.code,p.name,now];
        for (let di=0;di<31;di++) { const d=p.days[di]||{}; row.push(d.v1||'',d.v2||'',d.v3||''); }
        if (ri>=0) sh.getRange(ri+1,1,1,row.length).setValues([row]);
        else sh.appendRow(row);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}`;

function copyGasCode() {
  navigator.clipboard.writeText(GAS_CODE).then(() => {
    gasCopied.value = true;
    if (gasCopyTimer) clearTimeout(gasCopyTimer);
    gasCopyTimer = setTimeout(() => { gasCopied.value = false; }, 2000);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────
async function pickLocalPath() {
  const p = await openDialog({
    title: "選擇本地 XLSX 班表檔案",
    filters: [{ name: "Excel 活頁簿", extensions: ["xlsx", "xls"] }],
  }) as string | null;
  if (p) settings.value.localPath = p;
}

async function createTemplate() {
  const path = await saveDialog({
    title: "建立班表範本 XLSX",
    defaultPath: `schedule_${yyyyMM.value}.xlsx`,
    filters: [{ name: "Excel 活頁簿", extensions: ["xlsx"] }],
  }) as string | null;
  if (!path) return;
  const headers = ["姓名", ...Array.from({ length: 31 }, (_, i) => `${i + 1}日`)];
  const ws  = XLSX.utils.aoa_to_sheet([headers]);
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.value);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  await writeFile(path, buf);
  settings.value.localPath = path;
  await setSetting("local_path", path);
  showToast("範本已建立，路徑已設定");
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden select-none">

    <!-- ── Login Modal ─────────────────────────────────────────────── -->
    <LoginModal v-if="!session" @logged-in="session = $event" />

    <!-- ── Authenticated Shell ─────────────────────────────────────── -->
    <template v-if="session">

    <!-- ── Header ─────────────────────────────────────────────────── -->
    <div class="flex items-center justify-between px-6 py-3 border-b border-gray-800 flex-shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold">排班表</h1>
        <span v-if="activeTab === 'schedule'"
          class="text-xs px-2 py-0.5 rounded-full font-medium"
          :class="scheduleStatus === 'published'
            ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-800'
            : 'bg-gray-800 text-gray-500 border border-gray-700'">
          {{ scheduleStatus === 'published' ? '已發布' : '草稿' }}
        </span>
        <span v-if="activeTab === 'schedule'" class="flex items-center gap-2 text-xs">
          <span v-if="isDirty" class="text-amber-400 font-medium">● 有未儲存變更</span>
          <span v-else-if="dataSource" class="text-emerald-500">✓ 已同步</span>
          <span v-if="lastAutoSave" class="text-gray-600">存檔 {{ lastAutoSave }}</span>
        </span>
        <p v-else class="text-xs text-gray-600">
          {{ lastSync ? `上次同步：${lastSync}` : '尚未同步' }}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-500">
          {{ session.name }}
          <span class="ml-1 text-gray-700">{{ ROLE_LABELS[session.role] ?? session.role }}</span>
        </span>
        <button @click="session = null"
          class="text-xs px-2 py-1 text-gray-700 hover:text-gray-400 hover:bg-gray-800 rounded transition-colors">
          登出
        </button>
      </div>
    </div>

    <!-- ── Tab Bar ─────────────────────────────────────────────────── -->
    <div class="flex border-b border-gray-800 flex-shrink-0 px-4 bg-gray-950">
      <button
        v-for="tab in visibleTabs" :key="tab.key"
        @click="activeTab = tab.key"
        class="px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px"
        :class="activeTab === tab.key
          ? 'text-white border-blue-500'
          : 'text-gray-500 border-transparent hover:text-gray-300'"
      >{{ tab.label }}</button>
    </div>

    <!-- ── Tab: 輪序 ─────────────────────────────────────────────────── -->
    <RotationTab
      v-if="activeTab === 'rotation'"
      :pools="rotationPools"
      :staff="staff"
      :shifts="shifts"
      :session="session!"
      :year="currentYear"
      :month="currentMonth"
      @update:pools="onPoolsUpdate"
      class="flex-1 overflow-hidden"
    />

    <!-- ── Tab: 請求 ─────────────────────────────────────────────────── -->
    <RequestsTab
      v-else-if="activeTab === 'requests'"
      :requests="requests"
      :staff="staff"
      :schedule-data="scheduleData"
      :session="session!"
      :year="currentYear"
      :month="currentMonth"
      :shifts="shifts"
      :gas-url="settings.gasUrl"
      :spreadsheet-id="settings.spreadsheetId"
      :api-key="settings.apiKey"
      @pull-done="onRequestsPulled"
      @adopt="onAdoptRequest"
      @ignore="onIgnoreRequest"
      class="flex-1 overflow-hidden"
    />

    <!-- ── Tab: 預約 ─────────────────────────────────────────────────── -->
    <BookingTab
      v-else-if="activeTab === 'booking'"
      :staff="staff"
      :shifts="shifts"
      :year="currentYear"
      :month="currentMonth"
      :gas-url="settings.gasUrl"
      class="flex-1 overflow-hidden"
    />

    <!-- ── Tab: 人員 ─────────────────────────────────────────────────── -->
    <div v-else-if="activeTab === 'staff'" class="flex-1 overflow-y-auto bg-gray-900">
      <div class="px-6 py-4 space-y-3">
        <!-- Toolbar -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-semibold text-white mr-1">人員名單</span>
          <span class="text-xs text-gray-600 border border-gray-800 rounded px-1.5 py-0.5">{{ staff.length }} 人</span>
          <div class="flex-1"></div>
          <button @click="pullStaffFromCloud" :disabled="isStaffLoading"
            class="text-xs px-3 py-1.5 bg-blue-800/60 hover:bg-blue-700 text-blue-200 rounded disabled:opacity-40">
            {{ isStaffLoading ? '…' : '↓' }} 從雲端拉取
          </button>
          <button @click="pushStaffToCloud" :disabled="isStaffLoading || !staff.length"
            class="text-xs px-3 py-1.5 bg-emerald-800/60 hover:bg-emerald-700 text-emerald-200 rounded disabled:opacity-40">
            {{ isStaffLoading ? '…' : '↑' }} 上傳至雲端
          </button>
          <button @click="importStaffFromSchedule" :disabled="!scheduleData.length"
            class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded disabled:opacity-40">
            從現有班表匯入
          </button>
          <button @click="initScheduleFromStaff" :disabled="!staff.length"
            class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded disabled:opacity-40">
            套用至班表
          </button>
        </div>

        <!-- Search + Add -->
        <div class="flex gap-2">
          <input v-model="staffFilter" placeholder="搜尋姓名或代號…"
            class="flex-1 text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-300 outline-none focus:border-gray-500" />
        </div>

        <!-- Staff table -->
        <div class="rounded border border-gray-800 overflow-hidden">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-gray-800 text-gray-500">
                <th class="px-3 py-2 text-left font-medium w-28">代號</th>
                <th class="px-3 py-2 text-left font-medium">姓名</th>
                <th class="px-3 py-2 text-left font-medium w-28">角色</th>
                <th class="px-3 py-2 text-left font-medium w-28">密碼</th>
                <th class="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredStaff.length">
                <td colspan="5" class="px-3 py-4 text-center text-gray-700">尚無人員，請新增或從雲端拉取</td>
              </tr>
              <template v-for="member in filteredStaff" :key="member.code">
              <tr class="border-t border-gray-800 hover:bg-gray-800/50 group">
                <td class="px-3 py-2">
                  <input v-model="member.code" @change="saveStaffLocal"
                    class="font-mono text-blue-300 bg-transparent outline-none w-full focus:bg-gray-800 px-1 rounded" />
                </td>
                <td class="px-3 py-2">
                  <input v-model="member.name"
                    @focus="onStaffNameFocus(member)"
                    @blur="onStaffNameBlur(member)"
                    class="text-gray-200 bg-transparent outline-none w-full focus:bg-gray-800 px-1 rounded" />
                </td>
                <td class="px-3 py-2">
                  <select v-model="member.role" @change="saveStaffLocal"
                    class="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 outline-none focus:border-gray-500 w-full">
                    <option value="employee">員工</option>
                    <option value="scheduler">排班者</option>
                    <option value="admin">管理者</option>
                    <option v-if="session?.role === 'super'" value="super">超級管理員</option>
                  </select>
                </td>
                <td class="px-3 py-2">
                  <button @click="resetPwTarget = member.code; resetPwInput = ''"
                    class="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded transition-colors">
                    重設
                  </button>
                </td>
                <td class="px-3 py-2 text-center">
                  <button @click="removeStaff(staff.indexOf(member))"
                    class="opacity-0 group-hover:opacity-100 text-red-700 hover:text-red-500 transition-opacity">✕</button>
                </td>
              </tr>
              <!-- Inline password reset row -->
              <tr v-if="resetPwTarget === member.code"
                class="border-t border-gray-700 bg-gray-800/60">
                <td colspan="5" class="px-3 py-2">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-500">新密碼：</span>
                    <input v-model="resetPwInput" type="password" placeholder="輸入新密碼"
                      @keyup.enter="resetUserPassword" @keyup.escape="resetPwTarget = null"
                      class="text-xs px-2 py-1 bg-gray-900 border border-gray-600 rounded text-gray-200 outline-none focus:border-blue-500 w-48"
                      autofocus />
                    <button @click="resetUserPassword"
                      :disabled="!resetPwInput.trim()"
                      class="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded">確認</button>
                    <button @click="resetPwTarget = null"
                      class="text-xs text-gray-600 hover:text-gray-400">取消</button>
                  </div>
                </td>
              </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- Add new -->
        <div class="flex gap-2 items-center">
          <input v-model="newStaffCode" @keyup.enter="addStaff" placeholder="代號（英數）" maxlength="16"
            class="w-32 text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-blue-300 font-mono outline-none focus:border-blue-600" />
          <input v-model="newStaffName" @keyup.enter="addStaff" placeholder="姓名" maxlength="20"
            class="flex-1 text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500" />
          <button @click="addStaff" class="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded whitespace-nowrap">+ 新增</button>
        </div>

        <p class="text-xs text-gray-700">
          雲端人員名單儲存在 Google Sheets「Staff」分頁（代號 / 姓名兩欄）。代號和姓名可直接點擊編輯。
        </p>
      </div>
    </div>

    <!-- ── Tab: 設定 ─────────────────────────────────────────────────── -->
    <div v-else-if="activeTab === 'settings'" class="flex-1 overflow-y-auto bg-gray-900 px-6 py-4 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-gray-500 mb-1">Spreadsheet ID（讀取用）</label>
          <input v-model="settings.spreadsheetId" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Google API Key（讀取用）</label>
          <input v-model="settings.apiKey" type="password" placeholder="AIzaSy..."
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">GAS Web App URL（上傳用）</label>
          <input v-model="settings.gasUrl" placeholder="https://script.google.com/macros/s/.../exec"
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Sheet 前綴（預設 Schedule_）</label>
          <input v-model="settings.sheetPrefix" placeholder="Schedule_"
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs text-gray-500 mb-1">本地 XLSX 路徑</label>
          <div class="flex gap-2">
            <input :value="effectiveXlsxPath || '尚未設定'" readonly
              class="flex-1 text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-400 font-mono" />
            <button @click="createTemplate" class="text-xs px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-blue-200 rounded whitespace-nowrap">建立範本</button>
            <button @click="pickLocalPath" class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded whitespace-nowrap">選擇現有</button>
          </div>
          <p class="text-xs text-gray-600 mt-1">每月自動命名為 schedule_YYYYMM.xlsx，存於同一目錄</p>
        </div>
      </div>

      <!-- Shift Editor -->
      <div class="border-t border-gray-800 pt-3">
        <p class="text-xs text-gray-400 font-semibold mb-2">班別設定</p>
        <div class="flex flex-wrap gap-2 mb-2">
          <div v-for="(shift, si) in shifts" :key="si"
            class="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-800 border transition-colors"
            :class="expandedShiftIdx === si ? 'border-blue-700' : 'border-gray-700'">
            <input v-model="shift.code" @change="saveShifts"
              class="w-10 text-xs text-center font-semibold bg-transparent outline-none uppercase"
              :style="{ color: colorOf(shift.color).text }"
              maxlength="4" />
            <button @click="cycleShiftColor(si)"
              class="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0 transition-transform hover:scale-110"
              :style="{ backgroundColor: colorOf(shift.color).bg, borderColor: colorOf(shift.color).text }"
              title="點擊切換顏色" />
            <div class="flex items-center gap-0.5">
              <span class="text-gray-600 text-xs">月目標</span>
              <input
                :value="shift.target ?? ''"
                @change="shift.target = ($event.target as HTMLInputElement).value ? parseInt(($event.target as HTMLInputElement).value) : undefined; saveShifts()"
                type="number" min="0" max="31"
                placeholder="—"
                class="w-8 text-xs text-center bg-gray-900 border border-gray-700 rounded outline-none text-gray-400 focus:border-gray-500 focus:text-white px-0.5" />
            </div>
            <button @click="expandedShiftIdx = expandedShiftIdx === si ? null : si"
              class="text-xs px-1.5 py-0.5 rounded border transition-colors"
              :class="expandedShiftIdx === si
                ? 'bg-blue-900/60 border-blue-700 text-blue-300'
                : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'"
              title="每日目標設定">每日</button>
            <button @click="removeShift(si)" class="text-gray-700 hover:text-red-500 text-xs leading-none">✕</button>
          </div>
          <div class="flex items-center gap-1">
            <input v-model="newShiftCode" @keyup.enter="addShift"
              placeholder="新班別" maxlength="4"
              class="w-16 text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 font-semibold uppercase outline-none focus:border-blue-600" />
            <button @click="addShift" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded">+</button>
          </div>
        </div>
        <p class="text-xs text-gray-600 mb-2">點色點切換顏色；月目標 = 每人當月應排天數；每日 = 設定每日所需人數</p>

        <!-- Per-day-type target panel -->
        <div v-if="expandedShift" class="p-3 bg-gray-950 rounded border border-blue-900/60 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs text-white font-semibold">
              <span :style="{ color: colorOf(expandedShift.color).text }">{{ expandedShift.code }}</span>
              每日人力目標
            </span>
            <button @click="expandedShiftIdx = null" class="text-xs text-gray-600 hover:text-gray-400">✕ 關閉</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div v-for="dt in DAY_TYPE_LABELS" :key="dt.key" class="space-y-1.5">
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500 w-16 flex-shrink-0">{{ dt.label }}</span>
                <button @click="toggleTargetMode(expandedShiftIdx!, dt.key)"
                  class="text-xs px-2 py-0.5 rounded border transition-colors"
                  :class="isDerived(expandedShift.targets?.[dt.key])
                    ? 'bg-violet-900/60 border-violet-700 text-violet-300'
                    : expandedShift.targets?.[dt.key] !== undefined
                      ? 'bg-emerald-900/40 border-emerald-800 text-emerald-400'
                      : 'bg-gray-800 border-gray-700 text-gray-600 hover:text-gray-400'">
                  {{ isDerived(expandedShift.targets?.[dt.key]) ? '公式' : '固定' }}
                </button>
                <button v-if="expandedShift.targets?.[dt.key] !== undefined"
                  @click="shifts[expandedShiftIdx!].targets![dt.key] = undefined; saveShifts()"
                  class="text-xs text-gray-700 hover:text-red-500" title="清除">✕</button>
              </div>
              <!-- Fixed mode -->
              <template v-if="!isDerived(expandedShift.targets?.[dt.key])">
                <input type="number" min="0" max="99"
                  :value="(expandedShift.targets?.[dt.key] as number) ?? ''"
                  @change="setFixedTarget(expandedShiftIdx!, dt.key, $event)"
                  placeholder="未設定"
                  class="w-20 text-xs text-center bg-gray-900 border border-gray-700 rounded outline-none text-gray-300 focus:border-gray-500 px-1 py-0.5" />
              </template>
              <!-- Derived mode -->
              <template v-else>
                <div class="text-xs text-gray-600 leading-relaxed">
                  總人數 - (選取班別)
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-0.5">
                  <label v-for="s in shifts" :key="s.code" class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox"
                      :checked="(expandedShift.targets?.[dt.key] as any)?.subtract?.includes(s.code)"
                      @change="toggleSubtract(expandedShiftIdx!, dt.key, s.code, $event)"
                      class="accent-violet-500" />
                    <span class="text-xs font-semibold" :style="{ color: colorOf(s.color).text }">{{ s.code }}</span>
                  </label>
                </div>
                <div v-if="(expandedShift.targets?.[dt.key] as any)?.subtract?.length"
                  class="text-xs text-gray-500">
                  = 總人數 - {{ (expandedShift.targets?.[dt.key] as any).subtract.join(' - ') }}
                </div>
              </template>
            </div>
          </div>
          <p class="text-xs text-gray-700">固定：直接輸入數字；公式：自動計算（總人數減去指定班別人數）</p>
        </div>
      </div>

      <!-- Holiday Management -->
      <div class="border-t border-gray-800 pt-3">
        <div class="flex items-center gap-2 mb-2">
          <p class="text-xs text-gray-400 font-semibold">國定假日管理</p>
          <span class="text-xs text-gray-700 border border-gray-800 rounded px-1.5 py-0.5">{{ currentYear }} 年・{{ holidayList.filter(h => h.date.startsWith(String(currentYear))).length }} 個</span>
          <div class="flex-1"></div>
          <button @click="fetchHolidaysFromApi" :disabled="isHolidayLoading"
            class="text-xs px-3 py-1 bg-blue-800/60 hover:bg-blue-700 text-blue-200 rounded disabled:opacity-40">
            {{ isHolidayLoading ? '…' : '↓ 從 API 取得' }}
          </button>
          <button @click="importHolidaysFromCsv"
            class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded">
            匯入 CSV
          </button>
        </div>
        <p class="text-xs text-gray-700 mb-2">國定假日會套用 holiday 班別目標，並在班表格以橘色標示。API 來源：政府開放資料（TaiwanCalendar）</p>
        <!-- Manual add -->
        <div class="flex gap-2 mb-2">
          <input v-model="newHolidayInput" @keyup.enter="addHoliday" placeholder="手動新增 YYYY-MM-DD"
            class="w-40 text-xs px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-300 font-mono outline-none focus:border-blue-600" />
          <button @click="addHoliday"
            class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded">+ 新增</button>
          <button v-if="holidayList.filter(h => h.date.startsWith(String(currentYear))).length"
            @click="holidayList = holidayList.filter(h => !h.date.startsWith(String(currentYear))); saveHolidays()"
            class="text-xs px-2 py-1 bg-red-900/40 hover:bg-red-900/70 text-red-400 rounded ml-auto">
            清空 {{ currentYear }} 年
          </button>
        </div>
        <!-- Holiday list (current year only) -->
        <div class="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
          <span
            v-for="h in holidayList.filter(h => h.date.startsWith(String(currentYear)))" :key="h.date"
            class="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-orange-950/50 border border-orange-900/60 text-orange-300 rounded font-mono">
            {{ h.date }}<span v-if="h.description" class="text-orange-500 font-sans">{{ h.description }}</span>
            <button @click="removeHoliday(h.date)" class="text-orange-700 hover:text-orange-400 leading-none">✕</button>
          </span>
          <span v-if="!holidayList.filter(h => h.date.startsWith(String(currentYear))).length"
            class="text-xs text-gray-700">尚未設定 {{ currentYear }} 年假日</span>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button @click="saveAllSettings" class="text-xs px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded">儲存設定</button>
        <button @click="showGasHelp = !showGasHelp" class="text-xs text-gray-500 hover:text-gray-300">
          {{ showGasHelp ? '▲' : '▼' }} GAS 程式碼
        </button>
        <button @click="showGuide = !showGuide" class="text-xs text-gray-500 hover:text-gray-300">
          {{ showGuide ? '▲' : '▼' }} 建置說明
        </button>
      </div>

      <!-- GAS Code -->
      <div v-if="showGasHelp" class="bg-gray-950 rounded border border-gray-800 p-4">
        <p class="text-xs text-gray-400 mb-2">在 Google Sheets 的 <strong class="text-white">擴充功能 → Apps Script</strong> 貼入以下程式碼，部署為 Web App（執行身分：我、存取：任何人）：</p>
        <div class="relative">
          <pre class="text-xs font-mono text-gray-400 leading-relaxed overflow-x-auto pr-20">{{ GAS_CODE }}</pre>
          <button @click="copyGasCode"
            class="absolute top-0 right-0 text-xs px-2 py-1 rounded transition-colors"
            :class="gasCopied ? 'bg-emerald-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'">
            {{ gasCopied ? '✓ 已複製' : '複製' }}
          </button>
        </div>
      </div>

      <!-- Setup Guide (collapsible) -->
      <div v-if="showGuide" class="border-t border-gray-800 pt-3">
        <div class="flex gap-1 mb-5">
          <button v-for="n in [1,2,3]" :key="n" @click="guideStep = n as 1|2|3"
            class="text-xs px-4 py-1.5 rounded transition-colors"
            :class="guideStep === n ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'">
            步驟 {{ n }}
            <span class="ml-1.5 text-gray-400" v-if="n===1">取得 Spreadsheet ID</span>
            <span class="ml-1.5 text-gray-400" v-if="n===2">建立 Google API Key</span>
            <span class="ml-1.5 text-gray-400" v-if="n===3">部署 GAS Web App</span>
          </button>
        </div>

        <!-- Step 1 -->
        <div v-if="guideStep === 1" class="space-y-3 text-sm">
          <h3 class="font-semibold text-white">步驟 1：取得 Google Spreadsheet ID</h3>
          <p class="text-gray-400 text-xs leading-relaxed">
            Spreadsheet ID 用於<span class="text-blue-300">讀取</span>雲端班表。只需要 Google Sheet 公開或以 API Key 授權可讀即可。
          </p>
          <div class="bg-gray-950 border border-gray-800 rounded p-3 space-y-2">
            <p class="text-xs text-gray-300 font-semibold">① 建立或開啟 Google Sheet</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              前往
              <span class="font-mono text-blue-400 bg-gray-900 px-1 rounded cursor-text select-all">https://sheets.google.com</span>
              新建一個試算表作為班表使用。
            </p>
            <p class="text-xs text-gray-300 font-semibold mt-2">② 從網址列取得 ID</p>
            <p class="text-xs text-gray-500 leading-relaxed">網址格式如下，斜線之間的那串即為 ID：</p>
            <div class="font-mono text-xs bg-black rounded px-3 py-2 text-gray-400 leading-relaxed overflow-x-auto">
              https://docs.google.com/spreadsheets/d/<span class="text-yellow-400 font-bold">1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms</span>/edit
            </div>
            <p class="text-xs text-gray-300 font-semibold mt-2">③ 設定 Sheet 分頁名稱</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              每個月份對應一個分頁，命名規則為<span class="text-white font-semibold">前綴 + 年月</span>。<br>
              預設前綴 <span class="font-mono text-blue-300">Schedule_</span>，4月班表分頁名稱應為 <span class="font-mono text-blue-300">Schedule_202604</span>。
            </p>
          </div>
          <div class="flex justify-end mt-2">
            <button @click="guideStep = 2" class="text-xs px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded">
              下一步 →
            </button>
          </div>
        </div>

        <!-- Step 2 -->
        <div v-if="guideStep === 2" class="space-y-3 text-sm">
          <h3 class="font-semibold text-white">步驟 2：建立 Google API Key</h3>
          <p class="text-gray-400 text-xs leading-relaxed">
            API Key 用於<span class="text-blue-300">讀取</span>公開或授權的 Google Sheet 資料，不需要 OAuth。
          </p>
          <div class="bg-gray-950 border border-gray-800 rounded p-3 space-y-2">
            <p class="text-xs text-gray-300 font-semibold">① 開啟 Google Cloud Console</p>
            <p class="text-xs text-gray-500">
              前往
              <span class="font-mono text-blue-400 bg-gray-900 px-1 rounded cursor-text select-all">https://console.cloud.google.com</span>，
              登入並建立或選擇一個專案。
            </p>
            <p class="text-xs text-gray-300 font-semibold mt-2">② 啟用 Google Sheets API</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              左側選單 → <span class="text-white">API 和服務 → 程式庫</span>，搜尋 <span class="font-mono text-white">Google Sheets API</span>，點選並啟用。
            </p>
            <p class="text-xs text-gray-300 font-semibold mt-2">③ 建立 API 金鑰</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              左側 → <span class="text-white">API 和服務 → 憑證</span> → 上方「建立憑證」→ <span class="text-white">API 金鑰</span>。<br>
              建立後複製金鑰（格式：<span class="font-mono text-yellow-400">AIzaSy...</span>）貼到設定的「Google API Key」欄位。
            </p>
            <p class="text-xs text-gray-300 font-semibold mt-2">④ 限制金鑰用途（建議）</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              點選剛建立的金鑰 → API 限制 → 勾選 <span class="text-white">Google Sheets API</span>，防止金鑰被濫用。
            </p>
            <p class="text-xs text-gray-300 font-semibold mt-2">⑤ 設定試算表共用</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              回到 Google Sheet → 右上角「共用」→ 將存取權改為<span class="text-white">「知道連結的使用者」可以「檢視」</span>。<br>
              若班表屬敏感資料，可保持私人，但需改用 OAuth（較複雜，非此版本範圍）。
            </p>
          </div>
          <div class="flex justify-between mt-2">
            <button @click="guideStep = 1" class="text-xs px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded">← 上一步</button>
            <button @click="guideStep = 3" class="text-xs px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded">下一步 →</button>
          </div>
        </div>

        <!-- Step 3 -->
        <div v-if="guideStep === 3" class="space-y-3 text-sm">
          <h3 class="font-semibold text-white">步驟 3：部署 Google Apps Script (GAS) Web App</h3>
          <p class="text-gray-400 text-xs leading-relaxed">
            GAS Web App 用於<span class="text-emerald-300">回寫</span>班表資料到 Google Sheet（Sheets API 唯讀，無法直接寫入）。
          </p>
          <div class="bg-gray-950 border border-gray-800 rounded p-3 space-y-2">
            <p class="text-xs text-gray-300 font-semibold">① 開啟 Apps Script</p>
            <p class="text-xs text-gray-500">在目標 Google Sheet → 上方選單 <span class="text-white">擴充功能 → Apps Script</span>。</p>

            <p class="text-xs text-gray-300 font-semibold mt-2">② 貼入程式碼</p>
            <p class="text-xs text-gray-500 mb-1">若只需桌面端同步，貼入下方精簡版；若需手機 PWA，請改用專案內 <span class="font-mono text-blue-400">gas/scheduler.gs</span> 完整版：</p>
            <div class="relative group">
              <pre class="text-xs font-mono text-gray-400 leading-relaxed overflow-x-auto bg-black rounded px-3 py-2 pr-20">{{ GAS_CODE }}</pre>
              <button @click="copyGasCode"
                class="absolute top-2 right-2 text-xs px-2 py-1 rounded transition-colors"
                :class="gasCopied ? 'bg-emerald-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'">
                {{ gasCopied ? '✓ 已複製' : '複製' }}
              </button>
            </div>

            <p class="text-xs text-gray-300 font-semibold mt-2">③ 部署為 Web App</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              右上角 <span class="text-white">部署 → 新增部署</span>：<br>
              · 類型：<span class="text-white">Web 應用程式</span><br>
              · 執行身分：<span class="text-white">我</span>（以你的 Google 帳號執行）<br>
              · 誰可以存取：<span class="text-white">任何人</span><br>
              點選「部署」→ 授權 → 複製產生的 URL。
            </p>
            <p class="text-xs text-gray-300 font-semibold mt-2">④ 填入設定</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              複製的 URL 格式如 <span class="font-mono text-yellow-400">https://script.google.com/macros/s/…/exec</span>，<br>
              貼到設定面板的「GAS Web App URL」欄位後儲存。
            </p>
            <div class="mt-3 p-2 bg-yellow-950/40 border border-yellow-800/50 rounded">
              <p class="text-xs text-yellow-400 font-semibold">注意</p>
              <p class="text-xs text-yellow-600 leading-relaxed mt-1">
                每次修改 GAS 程式碼後需重新部署才會生效（「管理部署」→「編輯」→ 版本選「新版本」）。<br>
                上傳結果不會顯示回應（no-cors 限制），請至 Google Sheet 確認資料是否更新。
              </p>
            </div>
          </div>
          <div class="flex justify-between mt-2">
            <button @click="guideStep = 2" class="text-xs px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded">← 上一步</button>
            <button @click="showGuide = false" class="text-xs px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded">
              完成
            </button>
          </div>
        </div>
      </div><!-- end guide section -->
    </div><!-- end 設定 tab -->

    <!-- ── Tab: 班表 ─────────────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'schedule'">

    <!-- ── New Month Banner ─────────────────────────────────────────── -->
    <Transition name="toast">
      <div v-if="newMonthMsg"
        class="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-blue-950 border-b border-blue-800 text-blue-300 text-xs">
        <span class="text-base">🗓</span>
        {{ newMonthMsg }}
      </div>
    </Transition>

    <!-- ── Toolbar ────────────────────────────────────────────────── -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-800 flex-shrink-0 flex-wrap">
      <!-- Month switcher -->
      <div class="flex items-center gap-1 mr-2">
        <button @click="prevMonth" class="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded text-sm">‹</button>
        <span class="text-sm font-semibold text-white w-20 text-center">
          {{ currentYear }}/{{ String(currentMonth).padStart(2, '0') }}
        </span>
        <button @click="nextMonth" class="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded text-sm">›</button>
      </div>

      <div class="h-4 w-px bg-gray-800"></div>

      <!-- Sync actions -->
      <button @click="pullFromCloud" :disabled="isLoading"
        class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-800/60 hover:bg-blue-700 text-blue-200 rounded disabled:opacity-40">
        <span>{{ isLoading ? '…' : '↓' }}</span> 從雲端同步
      </button>
      <button @click="applyRotationToSchedule" :disabled="scheduleData.length === 0 || !rotationPools.length"
        class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-800/60 hover:bg-violet-700 text-violet-200 rounded disabled:opacity-40">
        套用輪序
      </button>
      <button @click="exportXlsx" :disabled="scheduleData.length === 0"
        class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-40">
        ↓ 存為 XLSX
      </button>
      <button @click="importXlsx"
        class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded">
        ↑ 讀取 XLSX
      </button>
      <button @click="pushToCloud" :disabled="isLoading || scheduleData.length === 0"
        class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-800/60 hover:bg-emerald-700 text-emerald-200 rounded disabled:opacity-40">
        <span>{{ isLoading ? '…' : '↑' }}</span> 上傳至雲端
      </button>
      <button @click="publishSchedule" :disabled="isLoading || scheduleData.length === 0 || scheduleStatus === 'published'"
        class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded font-semibold">
        {{ scheduleStatus === 'published' ? '✓ 已發布' : '發布班表' }}
      </button>

      <div class="h-4 w-px bg-gray-800"></div>

      <button @click="showAddRow = !showAddRow"
        class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded">
        + 新增人員
      </button>

      <!-- New row: staff picker or free input -->
      <div v-if="showAddRow" class="flex gap-1.5 items-start">
        <div v-if="staff.length" class="flex flex-col gap-1">
          <div class="flex flex-wrap gap-1 max-w-xs">
            <button
              v-for="member in staff.filter(s => !scheduleData.some(r => r.name === s.name))"
              :key="member.code"
              @click="addRowFromStaff(member); showAddRow = false"
              class="text-xs px-2 py-1 bg-gray-800 hover:bg-blue-800/60 border border-gray-700 hover:border-blue-600 text-gray-300 hover:text-blue-200 rounded transition-colors">
              <span class="font-mono text-gray-600 mr-1">{{ member.code }}</span>{{ member.name }}
            </button>
          </div>
          <div class="flex gap-1.5">
            <input v-model="newNameInput" @keyup.enter="addRow" placeholder="或自訂姓名…"
              class="text-xs px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-400 w-32 outline-none focus:border-gray-500" />
            <button v-if="newNameInput.trim()" @click="addRow"
              class="text-xs px-2 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded">確認</button>
          </div>
        </div>
        <div v-else class="flex gap-1.5 items-center">
          <input v-model="newNameInput" @keyup.enter="addRow" @keyup.escape="showAddRow = false"
            placeholder="輸入姓名" autofocus
            class="text-xs px-2 py-1.5 bg-gray-900 border border-gray-600 rounded text-gray-200 w-28 outline-none focus:border-blue-500" />
          <button @click="addRow" class="text-xs px-2 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded">確認</button>
        </div>
        <button @click="showAddRow = false" class="text-xs text-gray-600 hover:text-gray-400 px-1">✕</button>
      </div>

      <!-- Sheet name indicator -->
      <span class="ml-auto text-xs text-gray-700 font-mono">{{ sheetName }}</span>
    </div>

    <!-- ── Data Status Bar ───────────────────────────────────────── -->
    <div class="flex items-center gap-3 px-4 py-1.5 border-b border-gray-800/60 bg-gray-950/60 text-xs flex-shrink-0">
      <!-- Dirty / synced indicator -->
      <span v-if="isDirty" class="flex items-center gap-1 text-amber-400 font-medium">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400"></span>
        有未儲存變更
      </span>
      <span v-else-if="dataSource" class="flex items-center gap-1 text-emerald-500">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        已同步
      </span>
      <span v-else class="text-gray-700">尚無資料</span>

      <span class="text-gray-800">|</span>

      <!-- Source -->
      <span class="text-gray-500">
        來源：<span class="text-gray-400">{{
          dataSource === 'cloud' ? '雲端' :
          dataSource === 'local' ? '本地 XLSX' :
          dataSource === 'manual' ? '手動輸入' : '—'
        }}</span>
      </span>

      <!-- Timestamps -->
      <template v-if="lastSync">
        <span class="text-gray-800">|</span>
        <span class="text-gray-500">雲端同步：<span class="text-gray-400">{{ lastSync }}</span></span>
      </template>
      <template v-if="lastImport">
        <span class="text-gray-800">|</span>
        <span class="text-gray-500">本地匯入：<span class="text-gray-400">{{ lastImport }}</span></span>
      </template>
      <template v-if="lastAutoSave">
        <span class="text-gray-800">|</span>
        <span class="text-gray-500">自動存檔：<span class="text-gray-400">{{ lastAutoSave }}</span></span>
      </template>
    </div>

    <!-- ── Schedule Grid ──────────────────────────────────────────── -->
    <div class="flex-1 overflow-auto">

      <!-- Empty state -->
      <div v-if="scheduleData.length === 0 && !isLoading"
        class="flex flex-col items-center justify-center h-full text-gray-700 gap-3">
        <span class="text-4xl">📅</span>
        <p class="text-sm">點「從雲端同步」或「讀取 XLSX」載入班表</p>
        <p class="text-xs">或按「+ 新增人員」手動建立</p>
      </div>

      <!-- Loading -->
      <div v-else-if="isLoading" class="flex items-center justify-center h-full text-gray-600 text-sm">
        同步中…
      </div>

      <!-- Table -->
      <table v-else class="border-collapse text-xs" style="min-width: max-content">
        <thead>
          <!-- Date row -->
          <tr class="sticky top-0 z-20">
            <th class="sticky left-0 z-30 bg-gray-900 border-b border-r border-gray-800 px-3 py-2 text-left font-semibold text-gray-400 min-w-[7rem]">
              姓名
            </th>
            <th
              v-for="day in dayLabels" :key="day.d"
              class="sticky top-0 z-20 border-b border-gray-800 text-center font-semibold w-9 py-2"
              :class="[
                day.isHoliday ? 'bg-orange-950 text-orange-300' :
                day.isSat     ? 'bg-blue-950 text-blue-300'     :
                day.isSun     ? 'bg-red-950 text-red-300'       :
                                'bg-gray-900 text-gray-400'
              ]"
            >{{ day.d }}</th>
            <th v-for="(shift, si) in shifts" :key="shift.code"
              class="sticky top-0 z-20 bg-gray-900 border-b border-gray-800 text-center w-11 py-1 font-semibold leading-tight"
              :class="si === 0 ? 'border-l' : ''"
              :style="{ color: colorOf(shift.color).text }">
              <div>{{ shift.code }}</div>
              <div v-if="shift.target" class="text-gray-600 font-normal" style="font-size:10px">目標{{ shift.target }}</div>
            </th>
            <th class="sticky top-0 z-20 bg-gray-900 border-b border-gray-800 w-6 py-2"></th>
          </tr>
          <!-- Day-of-week row -->
          <tr class="sticky top-[33px] z-20">
            <th class="sticky left-0 z-30 bg-gray-900 border-b border-r border-gray-800 px-3 py-1 text-left text-gray-600 text-xs font-normal">
              {{ currentYear }}/{{ String(currentMonth).padStart(2,'0') }}
            </th>
            <th
              v-for="day in dayLabels" :key="day.d"
              class="border-b border-gray-800 text-center py-1 font-normal"
              :class="[
                day.isHoliday ? 'bg-orange-950/60 text-orange-400' :
                day.isSat     ? 'bg-blue-950/60 text-blue-400'     :
                day.isSun     ? 'bg-red-950/60 text-red-400'       :
                                'bg-gray-900 text-gray-600'
              ]"
            >{{ DOW[day.dow] }}</th>
            <th v-for="(shift, si) in shifts" :key="shift.code"
              class="bg-gray-900 border-b border-gray-800 py-1 text-center text-gray-600"
              :class="si === 0 ? 'border-l' : ''">—</th>
            <th class="bg-gray-900 border-b border-gray-800 py-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in scheduleData" :key="ri"
              class="hover:bg-gray-900/40 group">
            <!-- Name cell -->
            <td class="sticky left-0 z-10 bg-gray-950 group-hover:bg-gray-900 border-b border-r border-gray-800 px-3 py-1.5 font-medium text-gray-300 whitespace-nowrap min-w-[7rem]">
              {{ row.name }}
            </td>
            <!-- Day cells -->
            <td
              v-for="day in dayLabels" :key="day.d"
              @mousedown.prevent="onCellMousedown($event, ri, day.d - 1)"
              @mouseenter="onCellMouseenter(ri, day.d - 1)"
              data-cell
              :data-ri="ri"
              :data-di="day.d - 1"
              class="border-b border-gray-800/60 text-center py-1 cursor-pointer select-none relative"
              :class="[
                isCellSelected(ri, day.d - 1)
                  ? 'bg-blue-500/20 outline outline-1 outline-blue-400/60'
                  : day.isHoliday ? 'bg-orange-950/10 hover:bg-orange-950/30'
                  : day.isSat     ? 'bg-blue-950/10 hover:bg-blue-950/30'
                  : day.isSun     ? 'bg-red-950/10 hover:bg-red-950/30'
                  : 'hover:bg-gray-800/50'
              ]"
            >
              <span
                v-if="row.days[day.d - 1]"
                class="inline-block px-0.5 py-0.5 rounded text-xs font-semibold leading-tight w-7 text-center"
                :style="shiftStyleObj(row.days[day.d - 1])"
              >{{ row.days[day.d - 1] }}</span>
              <span
                v-else-if="getProjectedCell(row.name, day.d - 1)"
                class="inline-block px-0.5 py-0.5 rounded text-xs font-semibold leading-tight w-7 text-center"
                :style="projectedStyleObj(getProjectedCell(row.name, day.d - 1)!.shiftCode)"
                :title="`輪序投影：${getProjectedCell(row.name, day.d - 1)!.fromPool}`"
              >{{ getProjectedCell(row.name, day.d - 1)!.shiftCode }}</span>
              <span v-else class="inline-block w-7 text-gray-800 text-center">·</span>
              <!-- Request badge (top-right corner) -->
              <span
                v-if="getRequestBadge(row.name, day.d - 1)"
                class="absolute top-0 right-0 text-[9px] font-bold leading-none w-3.5 h-3.5 flex items-center justify-center rounded-bl"
                :class="getRequestBadge(row.name, day.d - 1)!.cls"
                :title="getRequestBadge(row.name, day.d - 1)!.tip"
              >{{ getRequestBadge(row.name, day.d - 1)!.text }}</span>
            </td>
            <!-- Stats -->
            <td v-for="(shift, si) in shifts" :key="shift.code"
              class="border-b border-gray-800 text-center py-1.5 font-semibold text-xs"
              :class="si === 0 ? 'border-l' : ''"
            >
              <span :class="{
                'text-emerald-400': quotaStatus(row, shift) === 'met',
                'text-red-400':     quotaStatus(row, shift) === 'over',
                'text-yellow-500':  quotaStatus(row, shift) === 'under',
              }" :style="quotaStatus(row, shift) === 'none' ? { color: colorOf(shift.color).text } : {}">
                {{ countShift(row, shift.code) || '—' }}
              </span>
              <span v-if="shift.target" class="text-gray-700 text-xs">/{{ shift.target }}</span>
            </td>
            <!-- Delete row -->
            <td class="border-b border-gray-800 text-center py-1.5">
              <button @click="removeRow(ri)"
                class="opacity-0 group-hover:opacity-100 text-red-700 hover:text-red-500 transition-opacity text-xs px-1">
                ✕
              </button>
            </td>
          </tr>

          <!-- Summary row: D/N count per day -->
          <tr class="sticky bottom-0 z-10 bg-gray-900 border-t border-gray-700">
            <td class="sticky left-0 z-20 bg-gray-900 px-3 py-1.5 text-xs text-gray-500 font-semibold border-r border-gray-800">
              每日人力
            </td>
            <td v-for="day in dayLabels" :key="day.d"
              class="text-center py-1 text-xs"
              :class="[
                day.isHoliday ? 'bg-orange-950/5' :
                day.isSat     ? 'bg-blue-950/5'   :
                day.isSun     ? 'bg-red-950/5'    : ''
              ]">
              <template v-for="(shift, si) in shifts" :key="shift.code">
                <template v-if="totalShiftStaff(day.d - 1, shift.code)">
                  <span
                    :style="dayQuotaStatus(shift, day.d - 1) === 'none' ? { color: colorOf(shift.color).text } : {}"
                    :class="{
                      'text-emerald-400': dayQuotaStatus(shift, day.d - 1) === 'met',
                      'text-red-400':     dayQuotaStatus(shift, day.d - 1) === 'over',
                      'text-yellow-500':  dayQuotaStatus(shift, day.d - 1) === 'under',
                    }"
                  >{{ totalShiftStaff(day.d - 1, shift.code) }}</span>
                  <span v-if="resolveTarget(shift, day.d - 1) !== null"
                    class="text-gray-700 text-[10px]">/{{ resolveTarget(shift, day.d - 1) }}</span>
                </template>
                <span v-if="si < shifts.length - 1 && totalShiftStaff(day.d - 1, shift.code) && shifts.slice(si+1).some(s => totalShiftStaff(day.d - 1, s.code))"
                  class="text-gray-700"> </span>
              </template>
              <span v-if="shifts.every(s => !totalShiftStaff(day.d - 1, s.code))" class="text-gray-800">·</span>
            </td>
            <td :colspan="shifts.length + 1" class="text-xs text-gray-700 px-2">
              {{ shifts.map(s => s.code).join('/') }} 人數
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    </template><!-- end 班表 tab -->

    </template><!-- end session wrapper -->

    <!-- ── Drag Batch Picker ─────────────────────────────────────────── -->
    <Transition name="toast">
      <div v-if="showDragPicker"
        class="fixed z-50 pointer-events-auto"
        :style="{ left: pickerLeft + 'px', top: (pickerPos.y - 52) + 'px' }">
        <div class="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl px-3 py-2">
          <span class="text-xs text-gray-500 pr-1.5 border-r border-gray-700">{{ selectedCells.size }} 格</span>
          <button
            v-for="shift in shifts" :key="shift.code"
            @click="applyBatchShift(shift.code)"
            class="text-xs font-bold px-2.5 py-1 rounded-lg transition-transform hover:scale-110"
            :style="{ backgroundColor: colorOf(shift.color).bg, color: colorOf(shift.color).text, border: `1px solid ${colorOf(shift.color).text}40` }"
          >{{ shift.code }}</button>
          <div class="w-px h-4 bg-gray-700 mx-0.5"></div>
          <button @click="applyBatchShift(null)"
            class="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-red-950 text-gray-500 hover:text-red-400 border border-gray-700 hover:border-red-800 transition-colors">
            清除
          </button>
          <button @click="clearDragSelection"
            class="text-xs px-2 py-1 rounded-lg text-gray-600 hover:text-gray-400 transition-colors">
            ✕
          </button>
        </div>
      </div>
    </Transition>

    <!-- ── Radial Shift Menu ────────────────────────────────────────── -->
    <Transition name="radial">
      <div v-if="activeCell" class="fixed inset-0 z-50" @click.self="activeCell = null">
        <div class="absolute" :style="{ left: activeCell.x + 'px', top: activeCell.y + 'px' }">
          <!-- Shift buttons arranged in circle -->
          <button
            v-for="(shift, i) in shifts" :key="shift.code"
            class="absolute w-9 h-9 rounded-full text-xs font-bold flex items-center justify-center shadow-lg transition-transform hover:scale-115 hover:brightness-125"
            :style="{
              ...radialPos(i, shifts.length),
              backgroundColor: colorOf(shift.color).bg,
              color: colorOf(shift.color).text,
              border: `1.5px solid ${colorOf(shift.color).text}`,
              width: '36px', height: '36px',
            }"
            @click="selectShift(shift.code)"
          >{{ shift.code }}</button>
          <!-- Center: clear cell -->
          <button
            class="absolute flex items-center justify-center rounded-full text-base font-bold bg-gray-900 border-2 border-gray-600 text-gray-500 hover:border-red-600 hover:text-red-500 transition-colors shadow-lg"
            style="width:32px; height:32px; left:-16px; top:-16px;"
            @click="selectShift(null)"
            title="清除"
          >×</button>
        </div>
      </div>
    </Transition>

    <!-- ── Toast ──────────────────────────────────────────────────── -->
    <Transition name="toast">
      <div v-if="toast"
        class="fixed bottom-5 right-5 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg shadow-lg pointer-events-none">
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }
.radial-enter-active { transition: opacity 0.12s; }
.radial-enter-active .absolute > button { transition: opacity 0.1s, transform 0.15s; }
.radial-enter-from { opacity: 0; }
.radial-enter-from .absolute > button { opacity: 0; transform: scale(0.5); }
.radial-leave-active { transition: opacity 0.1s; }
.radial-leave-to { opacity: 0; }
</style>
