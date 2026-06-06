<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import { useRoute } from "vue-router";
import { useActiveSyncBanners } from "@/composables/useCloudSync";
import {
  pendingTables,
  checkCloudVersions,
  fetchCloudTable,
  saveSyncTimestamp,
  hasConflict,
  logPullResult,
  startPolling,
  stopPolling,
  SYNC_TABLE_META,
  syncRequest,
} from "@/composables/useSyncMonitor";
import { useCloudSettings } from "@/stores/cloudSettings";
import Sidebar from "@/components/layout/Sidebar.vue";
import TopBar from "@/components/layout/TopBar.vue";
import OmniSearch from "@/components/OmniSearch.vue";
import DebugPanel from "@/components/DebugPanel.vue";
import CompactPanel from "@/components/CompactPanel.vue";
import SyncDiffModal from "@/components/SyncDiffModal.vue";
import { useUiSettings } from "@/stores/uiSettings";
import { useLogger } from "@/composables/useLogger";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { startXlsxWatchFromSettings } from "@/composables/useXlsxSync";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { getDb } from "@/db";

const searchOpen  = ref(false);
const debugOpen   = ref(false);
const compactMode = ref(false);
const uiSettings  = useUiSettings();
const route       = useRoute();
const cloud       = useCloudSettings();
const activeSyncLabels = useActiveSyncBanners(computed(() => route.path));

// ── 雲端同步衝突 Modal ────────────────────────────────────────────────────
interface SyncConflict {
  table: string;
  localRows: Record<string, unknown>[];
  cloudRows: Record<string, unknown>[];
  resolve: (merged: Record<string, unknown>[]) => void;
  reject: () => void;
}
const syncConflict = ref<SyncConflict | null>(null);

// ── 背景自動 pull（輪詢偵測到更新後觸發）───────────────────────────────
async function syncPendingTables() {
  const tables = [...pendingTables.value];
  if (!tables.length || !cloud.gasUrl) return;

  const syncedLabels: string[] = [];
  const conflictLabels: string[] = [];

  for (const table of tables) {
    try {
      const conflict = await hasConflict(table);
      const cloudRows = await fetchCloudTable(table, cloud.gasUrl);
      if (!cloudRows) continue;

      if (conflict) {
        // 需要使用者介入
        const db = await getDb();
        const localRows = await db.select<Record<string, unknown>[]>(`SELECT * FROM ${getTableName(table)}`);
        const merged = await new Promise<Record<string, unknown>[] | null>((res) => {
          syncConflict.value = {
            table,
            localRows,
            cloudRows: cloudRows as Record<string, unknown>[],
            resolve: (m) => { syncConflict.value = null; res(m); },
            reject:  () => { syncConflict.value = null; res(null); },
          };
        });
        if (!merged) { conflictLabels.push(SYNC_TABLE_META[table]?.label ?? table); continue; }
        await applyCloudData(table, merged);
      } else {
        await applyCloudData(table, cloudRows as Record<string, unknown>[]);
        syncedLabels.push(SYNC_TABLE_META[table]?.label ?? table);
      }

      await saveSyncTimestamp(table);
      logPullResult(table, cloudRows.length, 0);
      pendingTables.value = pendingTables.value.filter(t => t !== table);
    } catch { /* 單筆失敗不阻斷其餘 */ }
  }

  if (syncedLabels.length > 0) {
    showToast(`☁ ${syncedLabels.join("、")} 已自動同步最新雲端資料`);
  }
  if (conflictLabels.length > 0) {
    showToast(`⚠ ${conflictLabels.join("、")} 資料有衝突，已取消同步`);
  }
}

function getTableName(table: string): string {
  const MAP: Record<string, string> = {
    items: "items", physicians: "physicians", prescriptions: "prescriptions",
    surgery: "surgery", examination: "examination", disease: "disease",
    contacts: "contacts", shiftMemos: "shift_memos",
  };
  return MAP[table] ?? table;
}

async function applyCloudData(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (table === "ahk" || table === "sets") return; // complex tables: skip auto-apply
  const db = await getDb();
  const tableName = getTableName(table);
  if (!tableName) return;
  await db.execute(`DELETE FROM ${tableName}`, []);
  for (const row of rows) {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => "?").join(", ");
    const vals = cols.map(c => row[c] ?? null);
    await db.execute(
      `INSERT OR REPLACE INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders})`,
      vals
    );
  }
}

// ── 設定頁「立即完整同步」觸發 ──────────────────────────────────────────
watch(syncRequest, async (val) => {
  if (!val || !cloud.gasUrl) return;
  await checkCloudVersions(cloud.gasUrl);
  await syncPendingTables();
});

// ── 定時自動同步 ─────────────────────────────────────────────────────────
let scheduleTimer: ReturnType<typeof setInterval> | null = null;
const todaySynced = new Set<string>();

async function startScheduleTimer() {
  if (scheduleTimer) clearInterval(scheduleTimer);

  let lastMinute = -1;
  scheduleTimer = setInterval(async () => {
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (currentMinute === lastMinute) return;
    lastMinute = currentMinute;

    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    try {
      const db = await getDb();
      // 時段模式
      const windowsRow = await db.select<{ value: string }[]>(
        "SELECT value FROM app_settings WHERE key = 'sync_schedule_windows'"
      );
      if (windowsRow[0]?.value) {
        const windows: { from: string; to: string }[] = JSON.parse(windowsRow[0].value);
        for (const w of windows) {
          if (hhmm >= w.from && hhmm <= w.to) {
            const key = `window_${w.from}`;
            const todayKey = `${now.toDateString()}_${key}`;
            if (!todaySynced.has(todayKey)) {
              todaySynced.add(todayKey);
              if (cloud.gasUrl) await checkCloudVersions(cloud.gasUrl);
              await syncPendingTables();
            }
          }
        }
      }
      // 間隔模式
      const intervalRow = await db.select<{ value: string }[]>(
        "SELECT value FROM app_settings WHERE key = 'sync_interval_hours'"
      );
      const intervalH = Number(intervalRow[0]?.value ?? 0);
      if (intervalH > 0) {
        const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
        if (minutesSinceMidnight % (intervalH * 60) === 0) {
          if (cloud.gasUrl) await checkCloudVersions(cloud.gasUrl);
          await syncPendingTables();
        }
      }
    } catch { /* 靜默 */ }
  }, 60_000);
}

onMounted(async () => {
  uiSettings.load();
  await cloud.load();
  useLogger().initClickTracking(() => route.path);
  startXlsxWatchFromSettings().catch(() => {/* 找不到路徑，靜默跳過 */});
  startPolling(() => cloud.gasUrl);
  await startScheduleTimer();
});

onUnmounted(() => {
  stopPolling();
  if (scheduleTimer) clearInterval(scheduleTimer);
});

// ── 精簡模式 ─────────────────────────────────────────────────────────
const COMPACT_W    = 360;   // 總視窗寬（含把手）
const HANDLE_W     = 28;    // 把手條寬（隱藏時唯一可見部分）
const INSET_TOP    = 40;    // 避開頂部系統列 / 關閉按鈕
const INSET_BOTTOM = 56;    // 避開底部工具列（Windows 工作列約 48 px）
const prevSize  = ref({ w: 1280, h: 800 });
const prevPos   = ref({ x: 100,  y: 100 });
const panelVisible = ref(false);   // 是否已滑出（展開）

let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let blurHideTimer:   ReturnType<typeof setTimeout> | null = null;
let unlistenFocus:   (() => void) | null = null;
let isAnimating = false;

function clearCompactTimers() {
  if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  if (blurHideTimer)   { clearTimeout(blurHideTimer);   blurHideTimer   = null; }
}

function resetInactivity() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => slideIn(), 120_000);
}

async function animateTo(targetX: number) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const win    = getCurrentWindow();
    const sf     = await win.scaleFactor();
    const pos    = await win.outerPosition();
    const startX = Math.round(pos.x / sf);
    const STEPS  = 16;
    for (let i = 1; i <= STEPS; i++) {
      await win.setPosition(new LogicalPosition(
        Math.round(startX + (targetX - startX) * i / STEPS), INSET_TOP
      ));
      if (i < STEPS) await new Promise(r => setTimeout(r, 10));
    }
  } finally { isAnimating = false; }
}

async function slideOut() {
  if (!compactMode.value || panelVisible.value || isAnimating) return;
  await animateTo(window.screen.width - COMPACT_W);
  panelVisible.value = true;
  resetInactivity();
}

async function slideIn() {
  if (!compactMode.value || !panelVisible.value || isAnimating) return;
  clearCompactTimers();
  await animateTo(window.screen.width - HANDLE_W);
  panelVisible.value = false;
}

function onCompactActivity() {
  if (!panelVisible.value) return;
  if (blurHideTimer) { clearTimeout(blurHideTimer); blurHideTimer = null; }
  resetInactivity();
}

async function enterCompact() {
  try {
    const win = getCurrentWindow();
    const [size, pos] = await Promise.all([win.outerSize(), win.outerPosition()]);
    const sf = await win.scaleFactor();
    prevSize.value = { w: Math.round(size.width / sf),  h: Math.round(size.height / sf) };
    prevPos.value  = { x: Math.round(pos.x / sf),       y: Math.round(pos.y / sf) };
    const sh         = window.screen.height;
    const compactH   = sh - INSET_TOP - INSET_BOTTOM;
    await win.setMinSize(new LogicalSize(COMPACT_W, 200));
    await win.setSize(new LogicalSize(COMPACT_W, compactH));
    await win.setPosition(new LogicalPosition(window.screen.width - HANDLE_W, INSET_TOP));
    await win.setAlwaysOnTop(true);
    compactMode.value  = true;
    panelVisible.value = false;
    // 失焦 3 秒後自動收起
    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
      if (!focused && panelVisible.value) {
        blurHideTimer = setTimeout(() => slideIn(), 1200);
      } else if (focused) {
        if (blurHideTimer) { clearTimeout(blurHideTimer); blurHideTimer = null; }
      }
    });
  } catch (e) { console.error("[compact] enterCompact failed", e); }
}

async function exitCompact() {
  try {
    if (unlistenFocus) { unlistenFocus(); unlistenFocus = null; }
    clearCompactTimers();
    const win = getCurrentWindow();
    await win.setAlwaysOnTop(false);
    await win.setMinSize(new LogicalSize(900, 600));
    await win.setSize(new LogicalSize(prevSize.value.w, prevSize.value.h));
    await win.setPosition(new LogicalPosition(prevPos.value.x, prevPos.value.y));
    compactMode.value  = false;
    panelVisible.value = false;
  } catch (e) { console.error("[compact] exitCompact failed", e); }
}

useEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    searchOpen.value = !searchOpen.value;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
    e.preventDefault();
    debugOpen.value = !debugOpen.value;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "M") {
    e.preventDefault();
    if (!compactMode.value) enterCompact();
    else if (panelVisible.value) slideIn();
    else slideOut();
  }
  if (e.key === "Escape") {
    searchOpen.value = false;
    debugOpen.value = false;
  }
});

// ── 啟動自動更新檢查 ──────────────────────────────────────────────────
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string, ms = 3000) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, ms);
}

const updateDialogOpen   = ref(false);
const updateVersion      = ref("");
const updateNotes        = ref("");
const updateDownloading  = ref(false);
let _updateObj: Awaited<ReturnType<typeof checkUpdate>> | null = null;

onMounted(async () => {
  try {
    const update = await checkUpdate();
    if (update?.available) {
      _updateObj          = update;
      updateVersion.value = update.version ?? "";
      updateNotes.value   = update.body ?? "";
      updateDialogOpen.value = true;
    } else {
      showToast("已是最新版本");
    }
  } catch {
    // 開發模式或網路失敗：靜默略過，不打擾使用者
  }
});

async function installUpdate() {
  if (!_updateObj) return;
  updateDownloading.value = true;
  try {
    await _updateObj.downloadAndInstall();
    await relaunch();
  } catch {
    showToast("更新安裝失敗");
    updateDownloading.value = false;
  }
}

function dismissUpdate() {
  updateDialogOpen.value = false;
}
</script>

<template>
  <!-- 精簡模式 -->
  <CompactPanel
    v-if="compactMode"
    :panel-visible="panelVisible"
    @exit="exitCompact"
    @slide-out="slideOut"
    @slide-in="slideIn"
    @activity="onCompactActivity"
  />

  <!-- 正常模式 -->
  <div v-else class="flex h-screen overflow-hidden bg-gray-950">
    <Sidebar @enter-compact="enterCompact" />

    <div class="flex flex-col flex-1 overflow-hidden">
      <TopBar @open-search="searchOpen = true" />


      <!-- 其他雲端同步背景 banner -->
      <Transition name="toast">
        <div v-if="activeSyncLabels.length > 0"
          class="flex items-center gap-3 px-4 py-2 bg-violet-950/80 border-b border-violet-800/60 text-violet-200 text-xs flex-shrink-0">
          <span class="animate-pulse">⟳</span>
          <span>{{ activeSyncLabels.join('、') }} 雲端同步背景執行中…</span>
        </div>
      </Transition>

      <main
        class="flex-1 min-h-0"
        :class="$route.meta.fullHeight ? 'overflow-hidden' : 'overflow-y-auto p-5'"
      >
        <RouterView />
      </main>
    </div>

    <!-- Omnibar overlay -->
    <OmniSearch v-if="searchOpen" @close="searchOpen = false" />

    <!-- Debug panel -->
    <DebugPanel v-if="debugOpen" />

    <!-- 啟動更新確認對話框 -->
    <Transition name="modal">
      <div v-if="updateDialogOpen"
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="dismissUpdate">
        <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[420px] max-w-[90vw] p-6 space-y-4">
          <!-- Header -->
          <div class="flex items-start gap-3">
            <div class="text-2xl leading-none">🎉</div>
            <div>
              <p class="text-white font-semibold text-base">發現新版本</p>
              <p class="text-emerald-400 font-mono text-sm font-bold mt-0.5">v{{ updateVersion }}</p>
            </div>
          </div>

          <!-- Release notes -->
          <pre v-if="updateNotes"
            class="text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed bg-gray-800 rounded-lg p-3 max-h-48 overflow-y-auto">{{ updateNotes }}</pre>

          <!-- Actions -->
          <div class="flex gap-3 justify-end pt-1">
            <button @click="dismissUpdate" :disabled="updateDownloading"
              class="text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 rounded-lg transition-colors">
              稍後再說
            </button>
            <button @click="installUpdate" :disabled="updateDownloading"
              class="text-sm px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors flex items-center gap-2">
              <span v-if="updateDownloading" class="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {{ updateDownloading ? '安裝中…' : '立即更新' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 雲端同步衝突解決 Modal -->
    <SyncDiffModal
      v-if="syncConflict"
      :table="syncConflict.table"
      :local-rows="syncConflict.localRows"
      :cloud-rows="syncConflict.cloudRows"
      @confirm="(merged) => syncConflict?.resolve(merged)"
      @cancel="syncConflict?.reject()"
    />

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-[9999] pointer-events-none">
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>


<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

.modal-enter-active, .modal-leave-active { transition: opacity .2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
