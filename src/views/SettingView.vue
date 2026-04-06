<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const cloud = useCloudSettings();
onMounted(() => cloud.load());

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

// ── Updater ───────────────────────────────────────────────────────────
const APP_VERSION = "0.1.4";

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
    const msg = (e as Error).message ?? "";
    if (msg.includes("dev") || msg.includes("updater") || import.meta.env.DEV) {
      showToast("開發模式下無法檢查更新，請使用打包版本");
    } else {
      showToast("檢查更新失敗，請確認網路連線");
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

// ── Guide ─────────────────────────────────────────────────────────────
const showGasHelp = ref(false);
const showGuide   = ref(false);
const guideStep   = ref<1|2|3>(1);

// ── Save ──────────────────────────────────────────────────────────────
async function saveSettings() {
  // cloud settings auto-save via store watch; sheetPrefix auto-saves via local watch
  // Force immediate persist for cloud settings
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_spreadsheet_id", cloud.spreadsheetId]);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_api_key",         cloud.apiKey]);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_gas_url",          cloud.gasUrl]);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ["scheduler_sheet_prefix",     sheetPrefix.value]);
  showToast("設定已儲存");
}
</script>

<template>
  <div class="flex-1 overflow-y-auto bg-gray-900 px-6 py-6 space-y-6">

    <!-- 頁首 -->
    <div class="flex items-center justify-between">
      <h1 class="text-base font-semibold text-white">設定</h1>
    </div>

    <!-- ── 班表相關後端設定 ─────────────────────────────────────────── -->
    <section class="space-y-4">
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">班表相關後端設定</h2>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-gray-500 mb-1">Spreadsheet ID（讀取用）</label>
          <input v-model="cloud.spreadsheetId" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Google API Key（讀取用）</label>
          <input v-model="cloud.apiKey" type="password" placeholder="AIzaSy..."
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">GAS Web App URL（上傳用）</label>
          <input v-model="cloud.gasUrl" placeholder="https://script.google.com/macros/s/.../exec"
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Sheet 前綴（預設 Schedule_）</label>
          <input v-model="sheetPrefix" placeholder="Schedule_"
            class="w-full text-xs px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono outline-none focus:border-gray-500" />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button @click="saveSettings"
          class="text-xs px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded">
          儲存設定
        </button>
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

      <!-- Setup Guide -->
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
              貼到上方「GAS Web App URL」欄位後點「儲存設定」。
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
      </div><!-- end guide -->
    </section>

    <!-- ── 版本與更新 ──────────────────────────────────────────────── -->
    <section class="space-y-4">
      <h2 class="text-xs font-semibold text-gray-400 uppercase tracking-wider">版本與更新</h2>

      <!-- 目前版本 + 檢查按鈕 -->
      <div class="flex items-center gap-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
        <div class="flex-1">
          <p class="text-xs text-gray-500 mb-0.5">目前版本</p>
          <p class="text-xl font-bold text-white font-mono">v{{ APP_VERSION }}</p>
        </div>
        <div class="flex flex-col items-end gap-2">
          <button @click="checkForUpdate" :disabled="updateChecking || updateDownloading"
            class="text-xs px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded transition-colors">
            {{ updateChecking ? '檢查中…' : '檢查更新' }}
          </button>
          <p class="text-[11px] text-gray-600">透過 GitHub Releases 自動更新</p>
        </div>
      </div>

      <!-- 發現新版本 -->
      <div v-if="updateAvailable"
        class="p-4 bg-emerald-900/30 border border-emerald-700/60 rounded-lg space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs text-emerald-400 font-semibold">🎉 發現新版本 v{{ updateVersion }}</p>
          </div>
          <button @click="installUpdate" :disabled="updateDownloading"
            class="text-xs px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded font-semibold">
            {{ updateDownloading ? '安裝中…' : '立即更新' }}
          </button>
        </div>
        <pre v-if="updateNotes" class="text-xs text-emerald-300/80 whitespace-pre-wrap font-sans leading-relaxed">{{ updateNotes }}</pre>
      </div>

      <!-- 更新日誌 -->
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <p class="text-xs text-gray-500 font-semibold">更新日誌</p>
          <span v-if="changelogFetchedAt" class="text-[11px] text-gray-700">上次同步：{{ changelogFetchedAt }}</span>
          <button @click="fetchChangelog" :disabled="changelogLoading"
            class="ml-auto text-xs px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-400 hover:text-gray-200 rounded transition-colors">
            {{ changelogLoading ? '取得中…' : '↻ 從 GitHub 更新' }}
          </button>
        </div>

        <!-- 無資料提示 -->
        <div v-if="!changelog.length && !changelogLoading"
          class="py-6 text-center text-xs text-gray-600">
          尚無快取，點擊「從 GitHub 更新」載入日誌
        </div>

        <!-- 日誌列表 -->
        <div v-for="(entry, i) in changelog" :key="entry.version"
          class="relative pl-4 border-l-2 transition-colors"
          :class="entry.version === APP_VERSION ? 'border-blue-600' : 'border-gray-800'">
          <div class="flex items-baseline gap-2 mb-1.5">
            <span class="text-sm font-bold font-mono"
              :class="entry.version === APP_VERSION ? 'text-blue-400' : 'text-gray-400'">
              v{{ entry.version }}
            </span>
            <span class="text-[11px] text-gray-600">{{ entry.date }}</span>
            <span v-if="entry.version === APP_VERSION"
              class="text-[10px] px-1.5 py-0.5 bg-blue-900/60 border border-blue-700/50 text-blue-300 rounded-full">
              目前版本
            </span>
          </div>
          <pre class="text-xs text-gray-500 whitespace-pre-wrap font-sans leading-relaxed">{{ entry.body || '（無說明）' }}</pre>
        </div>
      </div>
    </section>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-50 pointer-events-none">
        {{ toast }}
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
