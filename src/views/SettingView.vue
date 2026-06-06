<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { useUiSettings, FONT_SIZE_LABELS, type FontSize } from "@/stores/uiSettings";
import { checkCloudVersions, requestImmediateSync } from "@/composables/useSyncMonitor";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

const cloud = useCloudSettings();
onMounted(() => cloud.load());

const ui = useUiSettings();
const FONT_SIZES: FontSize[] = ["sm", "md", "lg", "xl"];

// ── Sheet Prefix（從 DB 載入，獨立存）─────────────────────────────────
const sheetPrefix = ref("Schedule_");
let prefixTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = ?",
      ["scheduler_sheet_prefix"]
    );
    if (rows[0]?.value) sheetPrefix.value = rows[0].value;
  } catch { /* first launch */ }
});

watch(sheetPrefix, (val) => {
  if (prefixTimer) clearTimeout(prefixTimer);
  prefixTimer = setTimeout(async () => {
    const db = await getDb();
    await db.execute(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      ["scheduler_sheet_prefix", val]
    );
  }, 800);
});

// ── Toast ─────────────────────────────────────────────────────────────
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

// ── GAS Code ──────────────────────────────────────────────────────────
const gasCopied = ref(false);
let gasCopyTimer: ReturnType<typeof setTimeout> | null = null;

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
        const target = p.spreadsheetId ? SpreadsheetApp.openById(p.spreadsheetId) : ss;
        let sh = target.getSheetByName(p.sheetName) || target.insertSheet(p.sheetName);
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

// ── Updater ───────────────────────────────────────────────────────────
const APP_VERSION = ref("…");
onMounted(async () => { APP_VERSION.value = await getVersion(); });

const updateChecking    = ref(false);
const updateAvailable   = ref(false);
const updateVersion     = ref("");
const updateNotes       = ref("");
const updateDownloading = ref(false);
let _updateObj: Awaited<ReturnType<typeof checkUpdate>> | null = null;

async function checkForUpdate() {
  updateChecking.value = true;
  try {
    const update = await checkUpdate();
    if (update?.available) {
      _updateObj          = update;
      updateVersion.value = update.version ?? "";
      updateNotes.value   = update.body ?? "";
      updateAvailable.value = true;
    } else {
      showToast("已是最新版本");
    }
  } catch (e) {
    const msg = String((e as any)?.message ?? e ?? "unknown");
    console.error("[updater]", msg);
    if (import.meta.env.DEV || msg.includes("cannot be used") || msg.toLowerCase().includes("dev mode")) {
      showToast("開發模式下無法檢查更新，請使用打包版本");
    } else if (msg.includes("Not Found") || msg.includes("404")) {
      showToast("尚未發布更新套件，請稍後再試");
    } else {
      showToast(`更新檢查失敗：${msg.slice(0, 80)}`);
    }
  } finally { updateChecking.value = false; }
}

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

// ── 更新日誌（從 GitHub Releases 抓取，快取於本地 DB）─────────────────
interface ChangelogEntry { version: string; date: string; body: string }

const changelog         = ref<ChangelogEntry[]>([]);
const changelogFetchedAt = ref("");
const changelogLoading  = ref(false);

onMounted(async () => {
  try {
    const db = await getDb();
    const rows = await db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
      ["changelog_cache", "changelog_fetched_at"]
    );
    for (const r of rows) {
      if (r.key === "changelog_cache")      changelog.value = JSON.parse(r.value);
      if (r.key === "changelog_fetched_at") changelogFetchedAt.value = r.value;
    }
  } catch { /* ignore */ }
});

async function fetchChangelog() {
  changelogLoading.value = true;
  try {
    const res = await fetch("https://api.github.com/repos/stevedaydream/medbase/releases", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const releases: { tag_name: string; published_at: string; body: string }[] = await res.json();
    const parsed: ChangelogEntry[] = releases.map(r => ({
      version: r.tag_name.replace(/^v/, ""),
      date:    r.published_at.slice(0, 10),
      body:    r.body ?? "",
    }));
    changelog.value = parsed;
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    changelogFetchedAt.value = now;
    const db = await getDb();
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["changelog_cache", JSON.stringify(parsed)]);
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["changelog_fetched_at", now]);
  } catch (e) {
    showToast(`無法取得日誌：${(e as Error).message}`);
  } finally { changelogLoading.value = false; }
}

// ── Gemini API Key ─────────────────────────────────────────────────────
const geminiApiKey      = ref("");
const geminiApiKeyInput = ref("");
const geminiKeySet      = ref(false);

onMounted(async () => {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_settings WHERE key = 'gemini_api_key'"
    );
    if (rows[0]?.value) {
      geminiApiKey.value  = rows[0].value;
      geminiKeySet.value  = true;
    }
  } catch { /* first launch */ }
});

async function saveGeminiKey() {
  const key = geminiApiKeyInput.value.trim();
  if (!key) return;
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["gemini_api_key", key]);
  geminiApiKey.value     = key;
  geminiApiKeyInput.value = "";
  geminiKeySet.value     = true;
  showToast("Gemini API Key 已儲存");
}

async function clearGeminiKey() {
  const db = await getDb();
  await db.execute("DELETE FROM app_settings WHERE key = 'gemini_api_key'");
  geminiApiKey.value  = "";
  geminiKeySet.value  = false;
  showToast("Gemini API Key 已清除");
}

// ── 管理員解鎖（Ctrl+Shift+L，session 等級，重新整理即鎖回）──────────
const adminUnlocked = ref(false);

function handleAdminKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.shiftKey && e.key === "L") {
    adminUnlocked.value = !adminUnlocked.value;
  }
}
onMounted(()  => window.addEventListener("keydown", handleAdminKey));
onUnmounted(() => window.removeEventListener("keydown", handleAdminKey));

// ── Guide ─────────────────────────────────────────────────────────────
const showGasHelp = ref(false);
const showGuide   = ref(false);
const guideStep   = ref<1|2|3>(1);

// ── 匯入設定 JSON ─────────────────────────────────────────────────────
const importingSettings = ref(false);
const settingsImportInput = ref<HTMLInputElement | null>(null);

async function handleSettingsImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!confirm("確定匯入設定？將覆蓋現有的所有程式設定（不影響臨床資料）。")) {
    if (settingsImportInput.value) settingsImportInput.value.value = "";
    return;
  }
  importingSettings.value = true;
  try {
    const text = await file.text();
    const rows: { key: string; value: string }[] = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error("格式錯誤：預期為陣列");
    const db = await getDb();
    for (const r of rows) {
      if (typeof r.key !== "string" || typeof r.value !== "string") continue;
      await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [r.key, r.value]);
    }
    await cloud.reload();
    showToast(`設定匯入完成，共匯入 ${rows.length} 筆。`);
  } catch (err: any) {
    console.error("[settings import]", err);
    showToast(`匯入失敗：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    importingSettings.value = false;
    if (settingsImportInput.value) settingsImportInput.value.value = "";
  }
}

// ── 雲端同步排程 ─────────────────────────────────────────────────────────
interface SyncWindow { from: string; to: string; }
const syncWindows      = ref<SyncWindow[]>([]);
const syncIntervalHours = ref(0);
const isSavingSchedule = ref(false);
const isCheckingVersions = ref(false);
const isTriggeringSync = ref(false);

onMounted(async () => {
  try {
    const db = await getDb();
    const wRows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", ["sync_schedule_windows"]);
    if (wRows[0]?.value) syncWindows.value = JSON.parse(wRows[0].value) as SyncWindow[];
    const iRows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key=?", ["sync_interval_hours"]);
    if (iRows[0]?.value) syncIntervalHours.value = Number(iRows[0].value) || 0;
  } catch { /* first launch */ }
});

async function saveSyncSchedule() {
  isSavingSchedule.value = true;
  try {
    const db = await getDb();
    await db.execute("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)", ["sync_schedule_windows", JSON.stringify(syncWindows.value)]);
    await db.execute("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)", ["sync_interval_hours", String(syncIntervalHours.value)]);
    showToast("同步排程已儲存");
  } catch (e) { showToast(`儲存失敗：${(e as Error).message}`); }
  finally { isSavingSchedule.value = false; }
}

function addSyncWindow() { syncWindows.value.push({ from: "07:00", to: "07:30" }); }
function removeSyncWindow(i: number) { syncWindows.value.splice(i, 1); }

async function triggerCheckVersions() {
  if (!cloud.gasUrl) { showToast("請先填入 GAS Web App URL"); return; }
  isCheckingVersions.value = true;
  try {
    const pending = await checkCloudVersions(cloud.gasUrl);
    showToast(pending.length ? `偵測到 ${pending.length} 個資料表有更新` : "雲端資料已是最新");
  } catch (e) { showToast(`檢查失敗：${(e as Error).message}`); }
  finally { isCheckingVersions.value = false; }
}

function triggerFullSync() {
  if (!cloud.gasUrl) { showToast("請先填入 GAS Web App URL"); return; }
  isTriggeringSync.value = true;
  requestImmediateSync();
  setTimeout(() => { isTriggeringSync.value = false; showToast("同步已觸發，將在背景執行"); }, 500);
}

// ── Save ──────────────────────────────────────────────────────────────
async function saveSettings() {
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_spreadsheet_id", cloud.spreadsheetId]);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_api_key",         cloud.apiKey]);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_gas_url",          cloud.gasUrl]);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_sheet_prefix",     sheetPrefix.value]);

  // 同步設定到 GAS Config（包含換電腦時需要的所有 key）
  if (cloud.gasUrl) {
    const configPairs: [string, string][] = [
      ["gas_url",              cloud.gasUrl],
      ["spreadsheet_id",       cloud.spreadsheetId],
      ["api_key",              cloud.apiKey],
      ["schedule_sheet_prefix", sheetPrefix.value],
    ];
    if (cloud.scheduleSpreadsheetId)
      configPairs.push(["schedule_spreadsheet_id", cloud.scheduleSpreadsheetId]);
    for (const [key, value] of configPairs) {
      fetch(cloud.gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "saveConfig", key, value }),
        mode: "no-cors",
      }).catch(() => {});
    }
  }

  showToast("設定已儲存");
}

// ── 從雲端還原設定（換電腦時：只需先填 GAS URL） ─────────────────────
const isPullingSettings = ref(false);
async function pullSettingsFromCloud() {
  if (!cloud.gasUrl) { showToast("請先填入 GAS Web App URL"); return; }
  isPullingSettings.value = true;
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getConfig" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { ok: boolean; data?: Record<string, string>; error?: string };
    if (!json.ok || !json.data) throw new Error(json.error ?? "GAS 回傳錯誤");
    const d = json.data;
    if (d.spreadsheet_id)        cloud.spreadsheetId         = d.spreadsheet_id;
    if (d.api_key)               cloud.apiKey                = d.api_key;
    if (d.schedule_spreadsheet_id) cloud.scheduleSpreadsheetId = d.schedule_spreadsheet_id;
    if (d.schedule_sheet_prefix) sheetPrefix.value           = d.schedule_sheet_prefix;
    await saveSettings();
    showToast("設定已從雲端還原");
  } catch (e) {
    showToast(`還原失敗：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    isPullingSettings.value = false;
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto bg-slate-950/20 px-8 py-6 space-y-6 text-slate-100 select-none">

    <!-- 頁首 -->
    <div class="flex items-center justify-between border-b border-white/5 pb-4">
      <div class="flex items-center gap-3">
        <span class="text-xl">⚙️</span>
        <h1 class="text-sm font-black text-slate-200 tracking-wider uppercase">系統整合與設定</h1>
      </div>
    </div>

    <!-- ── 外觀設定 ───────────────────────────────────────────────── -->
    <section class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 shadow-xl space-y-4">
      <h2 class="text-xs font-black text-slate-500 uppercase tracking-widest font-mono">外觀與字型控制 (Appearance)</h2>
      <div class="flex items-center gap-6">
        <p class="text-xs text-slate-400 font-bold w-16 shrink-0">介面字體</p>
        <div class="flex gap-1.5">
          <button
            v-for="size in FONT_SIZES" :key="size"
            @click="ui.fontSize = size"
            class="px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer"
            :class="ui.fontSize === size
              ? 'bg-indigo-600 border-indigo-500/30 text-white shadow-lg shadow-indigo-500/10'
              : 'bg-slate-800 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-slate-200'"
          >{{ FONT_SIZE_LABELS[size] }}</button>
        </div>
        <p class="text-xs text-slate-500 font-medium">調整系統側邊欄、卡片標題及主要內容面板的全域文字尺寸。</p>
      </div>
    </section>

    <!-- ── 班表相關後端設定（管理員解鎖）────────────────────────────── -->
    <!-- 鎖定提示 -->
    <div v-if="!adminUnlocked"
      class="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/5 bg-slate-900/40 backdrop-blur-md text-slate-400 text-xs select-none cursor-default w-fit shadow-md">
      <span>🔒</span>
      <span class="font-bold">系統管理員參數設定（已鎖定）</span>
      <span class="text-2xs text-slate-600 font-medium">(快速鍵 Ctrl+Shift+L 解鎖)</span>
    </div>

    <section v-if="adminUnlocked" class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="flex items-center gap-2.5 text-xs font-black text-slate-400 uppercase tracking-widest font-mono">
          <span>⚙️</span> 班表資料串接與後端設定
          <span class="text-3xs font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.05)]">管理員模式</span>
        </h2>
        <button @click="adminUnlocked = false" class="text-2xs text-slate-500 hover:text-slate-300 font-bold cursor-pointer">🔒 鎖定設定</button>
      </div>

      <div class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-xl space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-2xs font-bold text-slate-500 uppercase mb-1">主試算表 ID (Google Spreadsheet ID)</label>
            <input v-model="cloud.spreadsheetId" placeholder="請輸入試算表 ID..."
              class="w-full text-xs px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 font-mono outline-none focus:border-indigo-500/50" />
          </div>
          <div>
            <label class="block text-2xs font-bold text-slate-500 uppercase mb-1">Google API Key (金鑰憑證)</label>
            <input v-model="cloud.apiKey" type="password" placeholder="請輸入 API Key..."
              class="w-full text-xs px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 font-mono outline-none focus:border-indigo-500/50" />
          </div>
          <div>
            <label class="block text-2xs font-bold text-slate-500 uppercase mb-1">GAS Web App URL (回寫閘道連結)</label>
            <input v-model="cloud.gasUrl" placeholder="https://script.google.com/macros/s/.../exec"
              class="w-full text-xs px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 font-mono outline-none focus:border-indigo-500/50" />
          </div>
          <div>
            <label class="block text-2xs font-bold text-slate-500 uppercase mb-1">班表 Sheet 分頁前綴</label>
            <input v-model="sheetPrefix" placeholder="Schedule_"
              class="w-full text-xs px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 font-mono outline-none focus:border-indigo-500/50" />
          </div>
          <div class="col-span-2">
            <label class="block text-2xs font-bold text-slate-500 uppercase mb-1">獨立班表試算表 ID（留空則寫入上方主試算表）</label>
            <input v-model="cloud.scheduleSpreadsheetId" placeholder="選填：指定寫入專屬的月度班表 Excel 檔案"
              class="w-full text-xs px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 font-mono outline-none focus:border-indigo-500/50" />
            <p class="text-2xs text-slate-500 mt-1 font-medium">指定後，排班系統將自動將 <span class="font-mono text-slate-400">Schedule_YYYYMM</span> 分頁寫入此處；請確保 GAS URL 的 Google 帳號擁有編輯權限。</p>
          </div>
        </div>

        <div class="flex items-center gap-3 flex-wrap pt-2 border-t border-white/5">
          <button @click="saveSettings"
            class="text-xs px-4 py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-indigo-500/10">
            儲存設定
          </button>
          <button @click="pullSettingsFromCloud" :disabled="isPullingSettings || !cloud.gasUrl"
            class="text-xs px-4 py-2 rounded-xl border border-indigo-500/30 text-indigo-400 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-40 transition-colors font-bold cursor-pointer"
            title="填入 GAS URL 後，從雲端還原其他所有設定（換電腦用）">
            {{ isPullingSettings ? '還原中…' : '↓ 從雲端拉取/還原設定' }}
          </button>
          <label
            class="text-xs px-4 py-2 rounded-xl border transition-colors cursor-pointer select-none font-bold text-slate-300 border-white/10 bg-slate-800 hover:bg-slate-700 hover:text-white"
            :class="importingSettings ? 'opacity-40 cursor-wait' : ''"
            :title="'匯入從「資料管理 → 備份程式設定 (JSON)」匯出的設定檔'">
            {{ importingSettings ? '匯入中…' : '匯入設定 JSON 檔' }}
            <input ref="settingsImportInput" type="file" accept=".json" class="hidden"
              :disabled="importingSettings" @change="handleSettingsImport" />
          </label>
          <button @click="showGasHelp = !showGasHelp" class="text-xs text-slate-400 hover:text-slate-200 font-bold ml-auto cursor-pointer">
            {{ showGasHelp ? '▲ 收合' : '▼ 展開' }} GAS 服務原始碼
          </button>
          <button @click="showGuide = !showGuide" class="text-xs text-slate-400 hover:text-slate-200 font-bold cursor-pointer">
            {{ showGuide ? '▲ 收合' : '▼ 展開' }} 雲端建置部署說明
          </button>
        </div>
      </div>

      <!-- GAS Code -->
      <div v-if="showGasHelp" class="bg-slate-950 border border-white/5 rounded-2xl p-5 space-y-3 shadow-inner">
        <p class="text-xs text-slate-400 leading-relaxed font-medium">請在 Google 試算表的分頁選單中選擇 <strong class="text-slate-200 font-bold">擴充功能 → Apps Script</strong>，新增腳本並貼入下方程式碼，接著發布部署為 <strong class="text-slate-200 font-bold">Web 應用程式</strong>（執行身分：我、存取權限：任何人）：</p>
        <div class="relative bg-slate-900/60 rounded-xl border border-white/[0.03] p-4">
          <pre class="text-xs font-mono text-slate-400 leading-relaxed overflow-x-auto pr-24 max-h-72">{{ GAS_CODE }}</pre>
          <button @click="copyGasCode"
            class="absolute top-4 right-4 text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-md"
            :class="gasCopied ? 'bg-emerald-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/5'">
            {{ gasCopied ? '✓ 已複製到剪貼簿' : '複製程式碼' }}
          </button>
        </div>
      </div>

      <!-- Setup Guide -->
      <div v-if="showGuide" class="bg-slate-900/40 border border-white/5 rounded-2xl p-5 space-y-4">
        <div class="flex gap-2.5 mb-2 flex-wrap border-b border-white/5 pb-3">
          <button v-for="n in [1,2,3]" :key="n" @click="guideStep = n as 1|2|3"
            class="text-xs px-4 py-2 rounded-xl transition-all cursor-pointer font-bold"
            :class="guideStep === n ? 'bg-indigo-600 border border-indigo-500/30 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'">
            步驟 {{ n }}
            <span class="ml-1.5 font-medium opacity-70" v-if="n===1">取得試算表 ID</span>
            <span class="ml-1.5 font-medium opacity-70" v-if="n===2">啟用 Google API 金鑰</span>
            <span class="ml-1.5 font-medium opacity-70" v-if="n===3">部署 GAS 回寫端</span>
          </button>
        </div>

        <!-- Step 1 -->
        <div v-if="guideStep === 1" class="space-y-3 text-xs leading-relaxed text-slate-300">
          <h3 class="font-bold text-slate-200 text-sm">步驟 1：建立試算表並擷取 Spreadsheet ID</h3>
          <p class="font-medium">Spreadsheet ID 是系統與雲端進行<span class="text-indigo-400">唯讀資料拉取</span>所必需的。您僅需要將 Google Sheets 設定為任何持有連結者可讀即可。</p>
          <div class="bg-slate-950 border border-white/5 rounded-xl p-4 space-y-3 font-medium">
            <div>
              <p class="text-slate-200 font-bold">① 建立全新 Google 試算表</p>
              <p class="text-slate-500 mt-0.5">前往 <span class="font-mono text-indigo-400 bg-slate-900 px-1.5 py-0.5 rounded border border-white/5">https://sheets.google.com</span> 建立一個乾淨的試算表作為排班用途。</p>
            </div>
            <div>
              <p class="text-slate-200 font-bold">② 從網址列解析識別 ID</p>
              <p class="text-slate-500 mt-0.5">在試算表的瀏覽器網址列中，斜線之間的英數長字串即為試算表 ID：</p>
              <div class="font-mono text-xs bg-slate-900 border border-white/5 rounded-lg px-3 py-2 text-slate-400 mt-1 select-all overflow-x-auto">
                https://docs.google.com/spreadsheets/d/<span class="text-amber-400 font-bold bg-amber-400/10 px-1 rounded border border-amber-500/20">1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms</span>/edit
              </div>
            </div>
            <div>
              <p class="text-slate-200 font-bold">③ 建立月份分頁標籤</p>
              <p class="text-slate-500 mt-0.5">排班資料會依據月份寫入不同的 Tab。系統會使用分頁前綴與 <code class="text-slate-300 bg-slate-900 font-mono px-1 rounded">YYYYMM</code> 年月結合命名。<br>
              若前綴為 <span class="font-mono text-indigo-300">Schedule_</span>，則 2026 年 6 月的班表分頁必須命名為 <span class="font-mono text-indigo-300 font-bold">Schedule_202606</span>。</p>
            </div>
          </div>
          <div class="flex justify-end pt-1">
            <button @click="guideStep = 2" class="text-xs px-4 py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-indigo-500/10">
              下一步：設定 API Key →
            </button>
          </div>
        </div>

        <!-- Step 2 -->
        <div v-if="guideStep === 2" class="space-y-3 text-xs leading-relaxed text-slate-300">
          <h3 class="font-bold text-slate-200 text-sm">步驟 2：在 Google Cloud 中獲取 API Key 金鑰</h3>
          <p class="font-medium">API 金鑰是桌面端軟體快速<span class="text-indigo-400">直連讀取</span> Google 試算表而無須繁瑣 OAuth 使用者授權的核心憑證。</p>
          <div class="bg-slate-950 border border-white/5 rounded-xl p-4 space-y-3 font-medium">
            <div>
              <p class="text-slate-200 font-bold">① 進入 Google Cloud 控制台</p>
              <p class="text-slate-500 mt-0.5">前往 <span class="font-mono text-indigo-400 bg-slate-900 px-1.5 py-0.5 rounded border border-white/5">https://console.cloud.google.com</span> 並選取或建立一個新的 Cloud 專案。</p>
            </div>
            <div>
              <p class="text-slate-200 font-bold">② 開啟並啟用 Google Sheets API 服務</p>
              <p class="text-slate-500 mt-0.5">在主選單點選 <span class="text-slate-300 font-bold">API 和服務 → 程式庫</span>，搜尋「<span class="font-mono text-slate-200 font-bold">Google Sheets API</span>」並點選啟用服務。</p>
            </div>
            <div>
              <p class="text-slate-200 font-bold">③ 建立專屬 API 金鑰</p>
              <p class="text-slate-500 mt-0.5">在 <span class="text-slate-300 font-bold">API 和服務 → 憑證</span> 頁面，點選頂部「建立憑證」並選擇「<span class="text-slate-300 font-bold">API 金鑰</span>」。<br>
              複製金鑰字串（以 <span class="font-mono text-amber-400 font-bold">AIzaSy...</span> 開頭）填入本頁面「Google API Key」欄位中。</p>
            </div>
            <div>
              <p class="text-slate-200 font-bold">④ 共用設定調整</p>
              <p class="text-slate-500 mt-0.5">回到您的 Google 試算表，點選右上角「共用」，將一般存取權修改為<span class="text-slate-300 font-bold">「知道連結的任何人」</span>可以<span class="text-slate-300 font-bold">「檢視」</span>。</p>
            </div>
          </div>
          <div class="flex justify-between pt-1">
            <button @click="guideStep = 1" class="text-xs px-4 py-2 bg-slate-800 border border-white/5 text-slate-300 rounded-xl font-bold cursor-pointer">← 上一步</button>
            <button @click="guideStep = 3" class="text-xs px-4 py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-indigo-500/10">下一步：設定 GAS 服務 →</button>
          </div>
        </div>

        <!-- Step 3 -->
        <div v-if="guideStep === 3" class="space-y-3 text-xs leading-relaxed text-slate-300">
          <h3 class="font-bold text-slate-200 text-sm">步驟 3：部屬 Google Apps Script (GAS) 微服務</h3>
          <p class="font-medium">由於安全限制，Google Sheets API 不允許直接在本地無登入狀態下修改試算表。我們需要透過部署一個簡單的 GAS 程式作為<span class="text-emerald-400">寫入代理門戶</span>。</p>
          <div class="bg-slate-950 border border-white/5 rounded-xl p-4 space-y-3 font-medium">
            <div>
              <p class="text-slate-200 font-bold">① 建立 Apps Script 專案</p>
              <p class="text-slate-500 mt-0.5">在您的 Google 試算表中，點選上方選單的 <span class="text-slate-300 font-bold">擴充功能 → Apps Script</span>。</p>
            </div>
            <div>
              <p class="text-slate-200 font-bold">② 覆蓋原始碼</p>
              <p class="text-slate-500 mt-0.5">清除預設程式碼，複製上方「GAS 服務原始碼」區塊內容並貼入，然後點選磁碟圖示存檔。</p>
            </div>
            <div>
              <p class="text-slate-200 font-bold">③ 部署為網頁應用程式</p>
              <p class="text-slate-500 mt-0.5">
                點選右上角 <span class="text-slate-300 font-bold">部署 → 新增部署</span>：<br>
                • 選取類型：<span class="text-slate-200 font-bold">網頁應用程式 (Web App)</span><br>
                • 執行身分：選擇 <span class="text-slate-200 font-bold">我 (Me)</span><br>
                • 誰有權存取：選擇 <span class="text-slate-200 font-bold">任何人 (Anyone)</span><br>
                點部署後授予存取許可權，複製產生的「網頁應用程式 URL」填入本頁「GAS Web App URL」中。
              </p>
            </div>
            <div class="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-1">
              <p class="text-amber-400 font-bold">重要提示</p>
              <p class="text-amber-600 leading-relaxed">
                若後續有修改 GAS 程式碼，必須重新進行部署以更新連結（「管理部署」→「編輯」→ 版本選「新版本」後儲存），否則修改不會生效。<br>
                因為 Tauri 桌面端與 GAS 的 no-cors 跨網域存取限制，上傳動作在本地將一律回報成功，請以試算表分頁實際有無重新寫入為準。
              </p>
            </div>
          </div>
          <div class="flex justify-between pt-1">
            <button @click="guideStep = 2" class="text-xs px-4 py-2 bg-slate-800 border border-white/5 text-slate-300 rounded-xl font-bold cursor-pointer">← 上一步</button>
            <button @click="showGuide = false" class="text-xs px-5 py-2 bg-emerald-600 border border-emerald-500/30 text-white rounded-xl font-bold cursor-pointer shadow-lg shadow-emerald-500/10">完成建置指引</button>
          </div>
        </div>
      </div><!-- end guide -->
    </section>

    <!-- ── AI 設定 ────────────────────────────────────────────────── -->
    <section class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 shadow-xl space-y-4">
      <h2 class="text-xs font-black text-slate-500 uppercase tracking-widest font-mono">人工智慧輔助設定 (AI Integrations)</h2>
      <div class="p-5 bg-slate-950 rounded-2xl border border-white/5 space-y-4">
        <div class="flex items-center gap-2.5">
          <p class="text-xs text-slate-300 font-bold">Gemini API Access Token</p>
          <span v-if="geminiKeySet"
            class="text-3xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.05)]">
            授權有效 ✓
          </span>
          <span v-else
            class="text-3xs font-bold px-2 py-0.5 rounded-full bg-slate-800 border border-white/5 text-slate-500">
            尚未填寫
          </span>
        </div>
        <div class="flex gap-2.5">
          <input v-model="geminiApiKeyInput" type="password"
            placeholder="請貼入 Gemini API 授權金鑰 (AIzaSy...)"
            class="flex-1 text-xs px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-slate-200 font-mono outline-none focus:border-indigo-500/50" />
          <button @click="saveGeminiKey" :disabled="!geminiApiKeyInput.trim()"
            class="text-xs px-4 py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-indigo-500/10">
            儲存金鑰
          </button>
          <button v-if="geminiKeySet" @click="clearGeminiKey"
            class="text-xs px-4 py-2 border border-rose-900/30 text-rose-400 hover:bg-rose-500/10 rounded-xl font-bold cursor-pointer transition-all">
            清除金鑰
          </button>
        </div>
        <p class="text-2xs text-slate-500 leading-relaxed font-medium">
          此 API 金鑰僅會安全儲存於本機資料庫中，用於「病歷潤飾」功能時調用 Gemini 模型。您可以免費前往
          <a href="https://aistudio.google.com/" target="_blank" class="text-indigo-400 hover:text-indigo-300 underline font-bold">Google AI Studio</a>
          申請個人專屬的免費額度 API Key。
        </p>
      </div>
    </section>

    <!-- ── 版本與更新 ──────────────────────────────────────────────── -->
    <section class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 shadow-xl space-y-5">
      <h2 class="text-xs font-black text-slate-500 uppercase tracking-widest font-mono">系統更新與發佈日誌 (Version control)</h2>

      <!-- 目前版本 + 檢查按鈕 -->
      <div class="flex items-center gap-6 p-5 bg-slate-950 rounded-2xl border border-white/5 shadow-md">
        <div class="flex-1">
          <p class="text-2xs font-bold text-slate-500 uppercase tracking-wider font-mono mb-1">目前安裝版本</p>
          <p class="text-2xl font-black text-slate-200 font-mono tracking-wider">v{{ APP_VERSION }}</p>
        </div>
        <div class="flex flex-col items-end gap-1.5 shrink-0">
          <button @click="checkForUpdate" :disabled="updateChecking || updateDownloading"
            class="text-xs px-4 py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-indigo-500/10">
            {{ updateChecking ? '正在線上搜檢…' : '檢查線上更新' }}
          </button>
          <p class="text-2xs text-slate-600 font-medium">系統將比對 GitHub Releases 最新發佈</p>
        </div>
      </div>

      <!-- 發現新版本 -->
      <div v-if="updateAvailable"
        class="p-5 bg-emerald-500/[0.03] border border-emerald-500/20 rounded-2xl space-y-4 shadow-[0_0_20px_rgba(16,185,129,0.02)]">
        <div class="flex items-center justify-between border-b border-emerald-500/10 pb-3">
          <div>
            <p class="text-xs text-emerald-400 font-black tracking-wider uppercase font-mono">⚡ 偵測到新版本發佈: v{{ updateVersion }}</p>
          </div>
          <button @click="installUpdate" :disabled="updateDownloading"
            class="text-xs px-4 py-2 bg-emerald-600 border border-emerald-500/30 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold cursor-pointer shadow-lg shadow-emerald-500/10">
            {{ updateDownloading ? '下載並安裝更新中…' : '立即下載並更新' }}
          </button>
        </div>
        <pre v-if="updateNotes" class="text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed p-4 bg-slate-950 rounded-xl border border-white/5 font-medium">{{ updateNotes }}</pre>
      </div>

      <!-- 更新日誌 -->
      <div class="space-y-4">
        <div class="flex items-center gap-3 border-b border-white/5 pb-2">
          <p class="text-xs font-bold text-slate-300">GitHub Releases 發佈歷史紀錄</p>
          <span v-if="changelogFetchedAt" class="text-2xs text-slate-500 font-mono">上次同步：{{ changelogFetchedAt }}</span>
          <button @click="fetchChangelog" :disabled="changelogLoading"
            class="ml-auto text-2xs font-bold px-3 py-1.5 border border-white/5 bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer transition-all">
            {{ changelogLoading ? '正在擷取…' : '↻ 從雲端同步日誌' }}
          </button>
        </div>

        <!-- 無資料提示 -->
        <div v-if="!changelog.length && !changelogLoading"
          class="py-8 text-center text-xs text-slate-500 italic">
          本地尚無快取紀錄，請點選「從雲端同步日誌」拉取最新開發者變更紀錄。
        </div>

        <!-- 日誌列表 -->
        <div class="space-y-4 pl-2 max-w-4xl">
          <div v-for="entry in changelog" :key="entry.version"
            class="relative pl-6 border-l-2 transition-all pb-1"
            :class="entry.version === APP_VERSION ? 'border-indigo-500' : 'border-white/5'">
            <!-- Timeline bullet -->
            <div class="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 bg-slate-900"
              :class="entry.version === APP_VERSION ? 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'border-slate-800'"></div>
            
            <div class="flex items-baseline gap-3 mb-2">
              <span class="text-xs font-black font-mono tracking-wider"
                :class="entry.version === APP_VERSION ? 'text-indigo-400' : 'text-slate-300'">
                v{{ entry.version }}
              </span>
              <span class="text-2xs text-slate-500 font-mono font-bold">{{ entry.date }}</span>
              <span v-if="entry.version === APP_VERSION"
                class="text-3xs font-bold px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.05)]">
                目前安裝版本
              </span>
            </div>
            <pre class="text-xs text-slate-500 whitespace-pre-wrap font-sans leading-relaxed p-4 bg-slate-950/40 border border-white/[0.02] rounded-xl font-medium">{{ entry.body || '（無更新細節說明）' }}</pre>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 雲端同步排程 ────────────────────────────────────────────── -->
    <section class="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 shadow-xl space-y-4">
      <h2 class="text-xs font-black text-slate-500 uppercase tracking-widest font-mono">雲端自動同步排程 (Sync Schedule)</h2>

      <!-- 固定時段 -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold text-slate-400">固定時段同步</p>
          <button @click="addSyncWindow"
            class="text-xs px-3 py-1 rounded-lg bg-slate-800 border border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer font-bold">
            + 新增時段
          </button>
        </div>
        <p class="text-2xs text-slate-600 font-medium">每天在設定的時間範圍內執行一次自動同步（當天已觸發者跳過）。</p>
        <div v-if="syncWindows.length" class="space-y-2">
          <div v-for="(w, i) in syncWindows" :key="i" class="flex items-center gap-2">
            <input v-model="w.from" type="time"
              class="text-xs px-2 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-200 font-mono outline-none focus:border-indigo-500/50 w-28" />
            <span class="text-slate-600 text-xs">→</span>
            <input v-model="w.to" type="time"
              class="text-xs px-2 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-200 font-mono outline-none focus:border-indigo-500/50 w-28" />
            <button @click="removeSyncWindow(i)" class="text-slate-600 hover:text-rose-400 text-sm leading-none cursor-pointer transition-colors">✕</button>
          </div>
        </div>
        <p v-else class="text-2xs text-slate-700 font-medium italic">尚未設定任何時段</p>
      </div>

      <!-- 間隔同步 -->
      <div class="flex items-center gap-4 border-t border-white/5 pt-4">
        <p class="text-xs font-bold text-slate-400 shrink-0">固定間隔同步</p>
        <select v-model="syncIntervalHours"
          class="text-xs px-3 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-200 font-mono outline-none focus:border-indigo-500/50 cursor-pointer">
          <option :value="0">停用</option>
          <option :value="1">每 1 小時</option>
          <option :value="2">每 2 小時</option>
          <option :value="4">每 4 小時</option>
          <option :value="8">每 8 小時</option>
        </select>
        <p class="text-2xs text-slate-600 font-medium">程式執行期間每隔指定小時自動同步一次。</p>
      </div>

      <!-- 儲存 + 手動觸發 -->
      <div class="flex items-center gap-3 flex-wrap border-t border-white/5 pt-4">
        <button @click="saveSyncSchedule" :disabled="isSavingSchedule"
          class="text-xs px-4 py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-indigo-500/10 disabled:opacity-50">
          {{ isSavingSchedule ? '儲存中…' : '儲存排程設定' }}
        </button>
        <button @click="triggerCheckVersions" :disabled="isCheckingVersions || !cloud.gasUrl"
          class="text-xs px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 disabled:opacity-40 transition-colors font-bold cursor-pointer">
          {{ isCheckingVersions ? '檢查中…' : '☁ 立即檢查版本' }}
        </button>
        <button @click="triggerFullSync" :disabled="isTriggeringSync || !cloud.gasUrl"
          class="text-xs px-4 py-2 rounded-xl border border-cyan-700/40 text-cyan-400 hover:text-cyan-300 hover:border-cyan-600/60 disabled:opacity-40 transition-colors font-bold cursor-pointer">
          {{ isTriggeringSync ? '觸發中…' : '↻ 立即完整同步' }}
        </button>
      </div>
    </section>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-slate-900 border border-white/10 text-slate-200 text-xs font-bold rounded-2xl shadow-2xl z-50 pointer-events-none backdrop-blur-md">
        {{ toast }}
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
