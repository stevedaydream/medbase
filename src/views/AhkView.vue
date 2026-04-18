<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { readTextFile, writeTextFile, remove as removeFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { buildPassAhkContent, getPassAhkPath, setPassAhkPath } from "@/composables/usePassAhk";

interface AhkScript {
  id: number;
  name: string;
  file_path: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface AhkGroup {
  id: number;
  name: string;
  description: string;
}

const tab = ref<"scripts" | "groups" | "guide">("scripts");
const scripts = ref<AhkScript[]>([]);
const groups = ref<AhkGroup[]>([]);
const selectedScript = ref<AhkScript | null>(null);
const selectedGroup = ref<AhkGroup | null>(null);
const scriptContent = ref("");
const groupScriptIds = ref<number[]>([]);
const ahkExePath = ref("");
const passAhkPath = ref<string | null>(null);
const showSettings = ref(false);
const search = ref("");
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const cloud = useCloudSettings();
onMounted(() => cloud.load());
const isSyncing = ref(false);

const scriptForm = ref({ name: "", file_path: "", description: "" });
const showDeleteConfirm = ref(false);
const groupForm = ref({ name: "", description: "" });

const filteredScripts = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return scripts.value;
  return scripts.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.file_path.toLowerCase().includes(q)
  );
});

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

function showError(msg: string, err?: unknown) {
  showToast(msg);
  console.error(`[AhkView] ${msg}`, err ?? "");
}

onMounted(async () => { await loadAll(); });

function openAhkSite() {
  openUrl("https://www.autohotkey.com/download/");
}

async function loadAll() {
  const db = await getDb();
  scripts.value = await db.select<AhkScript[]>("SELECT * FROM ahk_scripts ORDER BY name");
  groups.value  = await db.select<AhkGroup[]>("SELECT * FROM ahk_groups ORDER BY name");
  const row = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key = 'ahk_exe_path'"
  );
  ahkExePath.value = row[0]?.value ?? "";
  passAhkPath.value = await getPassAhkPath();
}

// ── 腳本管理 ─────────────────────────────────────────────

async function selectScript(s: AhkScript) {
  selectedScript.value = s;
  showDeleteConfirm.value = false;
  scriptForm.value = { name: s.name, file_path: s.file_path, description: s.description ?? "" };
  try {
    scriptContent.value = await readTextFile(s.file_path);
  } catch (e) {
    scriptContent.value = "";
    showToast(`無法讀取：${(e as Error).message ?? s.file_path}`);
  }
}

async function newScript() {
  const path = (await saveDialog({
    title: "選擇新腳本的儲存位置",
    filters: [{ name: "AutoHotkey Script", extensions: ["ahk"] }],
  })) as string | null;
  if (!path) return;

  const name = path.split(/[\\/]/).pop()?.replace(/\.ahk$/i, "") ?? "新腳本";
  const db = await getDb();
  try {
    await db.execute(
      "INSERT INTO ahk_scripts (name, file_path, description) VALUES (?, ?, '')",
      [name, path]
    );
    await loadAll();
    const created = scripts.value.find((s) => s.file_path === path);
    if (created) {
      selectedScript.value = created;
      scriptForm.value = { name: created.name, file_path: created.file_path, description: "" };
      scriptContent.value = "; New AutoHotkey Script\n#Requires AutoHotkey v2\n\n";
    }
  } catch (e) {
    showError(`建立失敗：${(e as Error).message}`, e);
  }
}

async function importFile() {
  const path = (await openDialog({
    title: "選擇 .ahk 檔案",
    filters: [{ name: "AutoHotkey Script", extensions: ["ahk"] }],
    multiple: false,
  })) as string | null;
  if (!path) return;

  const name = path.split(/[\\/]/).pop()?.replace(/\.ahk$/i, "") ?? "script";
  const db = await getDb();
  try {
    await db.execute(
      "INSERT OR IGNORE INTO ahk_scripts (name, file_path, description) VALUES (?, ?, '')",
      [name, path]
    );
    await loadAll();
    const script = scripts.value.find((s) => s.file_path === path);
    if (script) await selectScript(script);
    showToast("已匯入");
  } catch (e) {
    showError(`匯入失敗：${(e as Error).message}`, e);
  }
}

async function designateAsPassAhk() {
  if (!selectedScript.value) return;
  await setPassAhkPath(selectedScript.value.file_path);
  passAhkPath.value = selectedScript.value.file_path;
  showToast("已設為帳密腳本連動目標");
}

async function pickFilePath() {
  const path = (await openDialog({
    title: "選擇 .ahk 檔案",
    filters: [{ name: "AutoHotkey Script", extensions: ["ahk"] }],
    defaultPath: scriptForm.value.file_path || undefined,
  })) as string | null;
  if (path) scriptForm.value.file_path = path;
}

async function saveScript(andReload: boolean) {
  if (!scriptForm.value.name.trim()) { showToast("請填寫名稱"); return; }
  if (!scriptForm.value.file_path.trim()) { showToast("請選擇檔案路徑"); return; }

  try {
    await writeTextFile(scriptForm.value.file_path, scriptContent.value);
    const db = await getDb();
    await db.execute(
      `UPDATE ahk_scripts SET name=?, file_path=?, description=?, updated_at=datetime('now') WHERE id=?`,
      [scriptForm.value.name, scriptForm.value.file_path, scriptForm.value.description, selectedScript.value!.id]
    );
    await loadAll();

    if (andReload) {
      await triggerReload(scriptForm.value.file_path);
    } else {
      showToast("已儲存");
    }
  } catch (e) {
    showError(`儲存失敗：${(e as Error).message}`, e);
  }
}

async function triggerReload(filePath: string) {
  if (!ahkExePath.value) {
    showSettings.value = true;
    showToast("請先設定 AHK 執行檔路徑");
    return;
  }
  try {
    await invoke("reload_ahk", { exePath: ahkExePath.value, scriptPath: filePath });
    showToast("已儲存並 Reload ✓");
  } catch (e) {
    showError(`Reload 失敗：${(e as Error).message}`, e);
  }
}

async function deleteScript(alsoDeleteFile = false) {
  if (!selectedScript.value) return;
  if (alsoDeleteFile) {
    try {
      await removeFile(selectedScript.value.file_path);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      const notFound = /not found|unfound|os error 2|no such file/i.test(msg);
      if (!notFound) { showError(`檔案刪除失敗：${msg}`, e); return; }
      // 檔案已不存在，繼續移除 DB 紀錄
    }
  }
  const db = await getDb();
  await db.execute("DELETE FROM ahk_scripts WHERE id = ?", [selectedScript.value.id]);
  selectedScript.value = null;
  scriptContent.value = "";
  scriptForm.value = { name: "", file_path: "", description: "" };
  showDeleteConfirm.value = false;
  await loadAll();
  showToast(alsoDeleteFile ? "已移除紀錄與檔案" : "已移除紀錄");
}

// ── 套組管理 ─────────────────────────────────────────────

async function selectGroup(g: AhkGroup) {
  selectedGroup.value = g;
  groupForm.value = { name: g.name, description: g.description ?? "" };
  const db = await getDb();
  const rows = await db.select<{ script_id: number }[]>(
    "SELECT script_id FROM ahk_group_scripts WHERE group_id = ? ORDER BY sort_order",
    [g.id]
  );
  groupScriptIds.value = rows.map((r) => r.script_id);
}

async function newGroup() {
  const db = await getDb();
  await db.execute("INSERT INTO ahk_groups (name, description) VALUES ('新套組', '')", []);
  await loadAll();
  const latest = groups.value[groups.value.length - 1];
  if (latest) await selectGroup(latest);
}

async function saveGroup() {
  if (!groupForm.value.name.trim() || !selectedGroup.value) { showToast("請填寫套組名稱"); return; }
  const db = await getDb();
  await db.execute(
    "UPDATE ahk_groups SET name=?, description=? WHERE id=?",
    [groupForm.value.name, groupForm.value.description, selectedGroup.value.id]
  );
  await db.execute("DELETE FROM ahk_group_scripts WHERE group_id = ?", [selectedGroup.value.id]);
  for (let i = 0; i < groupScriptIds.value.length; i++) {
    await db.execute(
      "INSERT INTO ahk_group_scripts (group_id, script_id, sort_order) VALUES (?,?,?)",
      [selectedGroup.value.id, groupScriptIds.value[i], i]
    );
  }
  await loadAll();
  showToast("套組已儲存");
}

async function reloadGroup() {
  if (!selectedGroup.value) return;
  if (!ahkExePath.value) { showSettings.value = true; showToast("請先設定 AHK 執行檔路徑"); return; }
  const db = await getDb();
  const rows = await db.select<{ file_path: string }[]>(
    `SELECT s.file_path FROM ahk_scripts s
     JOIN ahk_group_scripts gs ON gs.script_id = s.id
     WHERE gs.group_id = ? ORDER BY gs.sort_order`,
    [selectedGroup.value.id]
  );
  let count = 0;
  for (const row of rows) {
    if (row.file_path) {
      try {
        await invoke("reload_ahk", { exePath: ahkExePath.value, scriptPath: row.file_path });
        count++;
      } catch {
        // continue others
      }
    }
  }
  showToast(`已 Reload ${count} 個腳本`);
}

async function deleteGroup() {
  if (!selectedGroup.value) return;
  if (!confirm(`確定刪除套組「${selectedGroup.value.name}」？`)) return;
  const db = await getDb();
  await db.execute("DELETE FROM ahk_groups WHERE id = ?", [selectedGroup.value.id]);
  selectedGroup.value = null;
  groupForm.value = { name: "", description: "" };
  groupScriptIds.value = [];
  await loadAll();
  showToast("套組已刪除");
}

function toggleGroupScript(id: number) {
  const idx = groupScriptIds.value.indexOf(id);
  if (idx >= 0) groupScriptIds.value.splice(idx, 1);
  else groupScriptIds.value.push(id);
}

async function saveExePath(path: string) {
  ahkExePath.value = path;
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ahk_exe_path', ?)",
    [path]
  );
  showToast("已儲存");
}

// ── 從通訊錄產生 pass.ahk ────────────────────────────

async function generatePassAhk() {
  const result = await buildPassAhkContent();
  if (!result) { showToast("通訊錄中無帳號資料"); return; }

  const { content, hisCount, phsCount } = result;

  const path = (await saveDialog({
    title: "儲存 pass.ahk",
    defaultPath: "pass.ahk",
    filters: [{ name: "AutoHotkey Script", extensions: ["ahk"] }],
  })) as string | null;
  if (!path) return;

  try {
    await writeTextFile(path, content);

    const db = await getDb();
    // 登記進 ahk_scripts（已存在則更新路徑與描述）
    await db.execute(
      `INSERT INTO ahk_scripts (name, file_path, description)
       VALUES (?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         updated_at = datetime('now')`,
      [
        "pass.ahk（自動產生）",
        path,
        `MedBase 通訊錄 · HIS ${hisCount} 筆 · PHS ${phsCount} 筆`,
      ]
    );
    await setPassAhkPath(path);
    await loadAll();

    const created = scripts.value.find((s) => s.file_path === path);
    if (created) await selectScript(created);

    if (ahkExePath.value) await triggerReload(path);
    else showToast(`已產生 ${hisCount + phsCount} 筆帳密熱字串`);
  } catch (e) {
    showError(`產生失敗：${(e as Error).message}`, e);
  }
}

// ── 雲端備份 / 還原 ───────────────────────────────────────────────

async function pushToCloud() {
  if (!cloud.gasUrl) { showToast("請先設定 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("ahk", true);
  try {
    const payload: { id: number; name: string; file_path: string; description: string; content: string }[] = [];
    for (const s of scripts.value) {
      let content = "";
      try { content = await readTextFile(s.file_path); } catch { /* 讀不到就帶空字串 */ }
      payload.push({ id: s.id, name: s.name, file_path: s.file_path, description: s.description ?? "", content });
    }
    await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveAhkScripts", scripts: payload }),
      mode: "no-cors",
    });
    showToast(`已備份 ${payload.length} 個腳本至雲端`);
  } catch (e) { showError(`備份失敗：${(e as Error).message}`, e); }
  finally { isSyncing.value = false; setGlobalSyncing("ahk", false); }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { showToast("請先設定 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("ahk", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getAhkScripts" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const cloudScripts: (AhkScript & { content: string })[] = json.scripts || [];
    if (!cloudScripts.length) { showToast("雲端無腳本資料"); return; }

    const db = await getDb();
    let written = 0, skipped = 0, remapped = 0;

    // 預設資料夾：文件/MedBase/ahk/
    const docDir = await documentDir();
    const ahkDir = await join(docDir, "MedBase", "ahk");

    for (const cs of cloudScripts) {
      let targetPath = cs.file_path;

      // 若原始路徑在本機不存在，改放到預設資料夾
      const pathOk = cs.file_path ? await exists(cs.file_path).catch(() => false) : false;
      if (!pathOk) {
        try {
          await mkdir(ahkDir, { recursive: true });
        } catch (e) {
          console.error("[AHK restore] mkdir failed:", ahkDir, e);
          throw new Error(`無法建立資料夾 ${ahkDir}：${e instanceof Error ? e.message : String(e)}`);
        }
        const filename = (cs.file_path?.split(/[\\/]/).pop()) || `script_${cs.id}.ahk`;
        const candidate = await join(ahkDir, filename);
        const conflict  = await exists(candidate).catch(() => false);
        targetPath = conflict ? await join(ahkDir, `${cs.id}_${filename}`) : candidate;
        remapped++;
        console.log("[AHK restore] remapped:", cs.file_path, "→", targetPath);
      }

      // 寫入檔案（內容不同才覆寫）
      try {
        let local = "";
        try { local = await readTextFile(targetPath); } catch { /* 不存在視為空 */ }
        if (local !== cs.content) {
          await writeTextFile(targetPath, cs.content);
          written++;
        } else {
          skipped++;
        }
      } catch (e) {
        console.error("[AHK restore] write failed:", targetPath, e);
        skipped++;
      }

      // 更新 DB 紀錄（file_path 用本機實際路徑）
      await db.execute(
        `INSERT OR REPLACE INTO ahk_scripts (id, name, file_path, description, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [cs.id, cs.name, targetPath, cs.description ?? ""]
      );
    }
    await loadAll();
    const remapNote = remapped > 0 ? `，${remapped} 個已對應至 文件/MedBase/ahk/` : "";
    showToast(`已還原：更新 ${written} 個，略過 ${skipped} 個${remapNote}`);
  } catch (e) { showError(`還原失敗：${(e as Error).message}`, e); }
  finally { isSyncing.value = false; setGlobalSyncing("ahk", false); }
}

async function pickExePath() {
  const path = (await openDialog({
    title: "選擇 AutoHotkey 執行檔",
    filters: [{ name: "Executable", extensions: ["exe"] }],
  })) as string | null;
  if (path) await saveExePath(path);
}

// ── 積木編輯器 ─────────────────────────────────────────────

interface BuilderBlock {
  id: number
  type: 'hotstring' | 'hotkey'
  comment: string
  trigger: string
  hsMode: 'inline' | 'multitext' | 'rawcode'
  expansion: string
  optInstant: boolean
  optInWord: boolean
  optCase: boolean
  modCtrl: boolean
  modShift: boolean
  modAlt: boolean
  modWin: boolean
  key: string
  hkMode: 'single' | 'multi'
  hkAction: string
}

const showBuilder = ref(false)
const builderBlocks = ref<BuilderBlock[]>([])
let blkCounter = 0
const editingBlockIdx = ref<number | null>(null)

function emptyBlock(): BuilderBlock {
  return {
    id: 0, type: 'hotstring', comment: '',
    trigger: '', hsMode: 'inline', expansion: '',
    optInstant: false, optInWord: false, optCase: false,
    modCtrl: true, modShift: false, modAlt: false, modWin: false,
    key: '', hkMode: 'single', hkAction: '',
  }
}
const builderForm = ref<BuilderBlock>(emptyBlock())

function generateBlockCode(b: BuilderBlock): string {
  const lines: string[] = []
  if (b.comment) lines.push(`; ${b.comment}`)
  if (b.type === 'hotstring') {
    const opts = (b.optInstant ? '*' : '') + (b.optInWord ? '?' : '') + (b.optCase ? 'C' : '')
    const pfx = opts ? `:${opts}:` : '::'
    if (b.hsMode === 'inline') {
      lines.push(`${pfx}${b.trigger}::${b.expansion}`)
    } else {
      lines.push(`${pfx}${b.trigger}::`)
      lines.push('{')
      if (b.hsMode === 'multitext') {
        const tls = b.expansion.split('\n')
        tls.forEach((tl, i) => {
          const parts = tl.split('\\t')
          parts.forEach((part, pi) => {
            if (part) lines.push(`    SendText "${part}"`)
            if (pi < parts.length - 1) lines.push(`    Send "{Tab}"`)
          })
          if (i < tls.length - 1) lines.push(`    Send "{Enter}"`)
        })
      } else {
        b.expansion.split('\n').forEach(l => lines.push(`    ${l}`))
      }
      lines.push('}')
    }
  } else {
    const mods = (b.modCtrl ? '^' : '') + (b.modShift ? '+' : '') + (b.modAlt ? '!' : '') + (b.modWin ? '#' : '')
    const combo = `${mods}${b.key}`
    if (b.hkMode === 'single') {
      lines.push(`${combo}::${b.hkAction}`)
    } else {
      lines.push(`${combo}::`)
      lines.push('{')
      b.hkAction.split('\n').forEach(l => lines.push(`    ${l}`))
      lines.push('}')
    }
  }
  return lines.join('\n')
}

const builderPreview = computed(() => {
  const b = builderForm.value
  if (b.type === 'hotstring' && !b.trigger) return ''
  if (b.type === 'hotkey' && !b.key) return ''
  return generateBlockCode(b)
})

const hsExpansionPlaceholder = computed(() =>
  builderForm.value.hsMode === 'multitext'
    ? '第一欄\t第二欄\t第三欄\n下一行文字'
    : 'Send "^a"\nSleep 50\nSend "^c"'
)

const hkActionPlaceholder = computed(() =>
  'Send "^a"\nSleep 50\nSend "^c"'
)

function setBuilderType(t: string) {
  builderForm.value.type = t as 'hotstring' | 'hotkey'
}

function addOrUpdateBlock() {
  const b = builderForm.value
  if (b.type === 'hotstring' && !b.trigger.trim()) { showToast('請填寫觸發文字'); return }
  if (b.type === 'hotkey' && !b.key.trim()) { showToast('請填寫按鍵'); return }
  if (editingBlockIdx.value !== null) {
    builderBlocks.value[editingBlockIdx.value] = { ...b, id: builderBlocks.value[editingBlockIdx.value].id }
    editingBlockIdx.value = null
  } else {
    builderBlocks.value.push({ ...b, id: ++blkCounter })
  }
  builderForm.value = emptyBlock()
}

function editBuilderBlock(idx: number) {
  editingBlockIdx.value = idx
  builderForm.value = { ...builderBlocks.value[idx] }
}

function removeBuilderBlock(idx: number) {
  builderBlocks.value.splice(idx, 1)
  if (editingBlockIdx.value === idx) {
    editingBlockIdx.value = null
    builderForm.value = emptyBlock()
  } else if (editingBlockIdx.value !== null && editingBlockIdx.value > idx) {
    editingBlockIdx.value--
  }
}

function cancelEditBlock() {
  editingBlockIdx.value = null
  builderForm.value = emptyBlock()
}

function insertBuilderToScript() {
  if (!builderBlocks.value.length) return
  const count = builderBlocks.value.length
  const code = builderBlocks.value.map(b => generateBlockCode(b)).join('\n\n')
  const sep = scriptContent.value && !scriptContent.value.endsWith('\n\n') ? '\n\n' : ''
  scriptContent.value += sep + code + '\n'
  showBuilder.value = false
  builderBlocks.value = []
  editingBlockIdx.value = null
  builderForm.value = emptyBlock()
  showToast(`已插入 ${count} 個區塊`)
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden">

    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
      <div>
        <h1 class="text-lg font-semibold">AHK 腳本管理</h1>
        <p class="text-xs text-gray-500 mt-0.5">
          AutoHotkey 設定檔 CRUD · 套組管理 · 自動 Reload ·
          <button
            @click="openAhkSite"
            class="text-blue-400 hover:text-blue-300 hover:underline transition-colors"
          >↗ 下載 AutoHotkey</button>
        </p>
      </div>
      <button
        @click="showSettings = !showSettings"
        class="text-xs px-3 py-1.5 rounded transition-colors"
        :class="showSettings ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'"
      >
        ⚙ 設定
      </button>
    </div>

    <!-- Settings Panel -->
    <div v-if="showSettings" class="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
      <span class="text-xs text-gray-500 whitespace-nowrap">AHK 執行檔：</span>
      <span class="text-xs text-gray-400 font-mono flex-1 truncate">
        {{ ahkExePath || '未設定（點選擇）' }}
      </span>
      <button
        @click="pickExePath"
        class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded whitespace-nowrap"
      >
        選擇 .exe
      </button>
      <span class="text-xs text-gray-700">
        通常在 C:\Program Files\AutoHotkey\AutoHotkey64.exe
      </span>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 px-6 pt-3 border-b border-gray-800 flex-shrink-0">
      <button
        v-for="[key, label] in [['scripts', '腳本管理'], ['groups', '套組管理'], ['guide', '使用說明']]"
        :key="key"
        @click="tab = key as 'scripts' | 'groups' | 'guide'"
        class="px-4 pb-2.5 text-sm transition-colors border-b-2"
        :class="tab === key
          ? 'border-blue-500 text-white'
          : 'border-transparent text-gray-500 hover:text-gray-300'"
      >
        {{ label }}
      </button>
    </div>

    <!-- ════════════════════════════════ SCRIPTS TAB ════════════════════════════════ -->
    <div v-if="tab === 'scripts'" class="flex flex-1 overflow-hidden">

      <!-- Left: list -->
      <div class="w-56 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        <div class="p-3 flex gap-2">
          <input
            v-model="search"
            placeholder="搜尋..."
            class="flex-1 text-xs px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500"
          />
        </div>
        <div class="flex gap-1.5 px-3 pb-2">
          <button
            @click="newScript"
            class="flex-1 text-xs py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded font-medium"
          >
            + 新增
          </button>
          <button
            @click="importFile"
            class="flex-1 text-xs py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
          >
            匯入
          </button>
        </div>
        <div class="px-3 pb-3 space-y-1.5">
          <button
            @click="generatePassAhk"
            class="w-full text-xs py-1.5 bg-amber-900/60 hover:bg-amber-900 text-amber-300 hover:text-amber-200 rounded flex items-center justify-center gap-1.5 transition-colors"
            title="從通訊錄的帳密自動產生 AHK 熱字串腳本"
          >
            <span>⚡</span> 產生帳密腳本
          </button>
          <div class="flex gap-1.5">
            <button @click="pullFromCloud" :disabled="isSyncing"
              class="flex-1 text-xs py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 rounded transition-colors">
              {{ isSyncing ? '…' : '☁️↓ 還原' }}
            </button>
            <button @click="pushToCloud" :disabled="isSyncing"
              class="flex-1 text-xs py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 rounded transition-colors">
              {{ isSyncing ? '…' : '☁️↑ 備份' }}
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto">
          <button
            v-for="s in filteredScripts"
            :key="s.id"
            @click="selectScript(s)"
            class="w-full text-left px-3 py-2.5 border-b border-gray-800/60 transition-colors"
            :class="selectedScript?.id === s.id
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'"
          >
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium truncate">{{ s.name }}</span>
              <span v-if="s.file_path === passAhkPath"
                class="text-[10px] px-1 py-0.5 rounded bg-amber-900/60 text-amber-400 flex-shrink-0">帳密</span>
            </div>
            <div class="text-xs text-gray-600 font-mono truncate mt-0.5">
              {{ s.file_path.split(/[\\/]/).pop() }}
            </div>
          </button>
          <div v-if="filteredScripts.length === 0" class="text-center text-gray-700 text-xs py-10">
            {{ search ? '無符合結果' : '尚無腳本' }}
          </div>
        </div>
      </div>

      <!-- Right: editor -->
      <div class="flex-1 flex flex-col overflow-hidden p-5 gap-3">
        <div v-if="!selectedScript" class="flex-1 flex items-center justify-center">
          <p class="text-gray-700 text-sm">選擇腳本或點擊「+ 新增」</p>
        </div>

        <template v-else>
          <!-- Meta row -->
          <div class="flex gap-3 flex-shrink-0">
            <div class="flex-1">
              <label class="block text-xs text-gray-500 mb-1">名稱</label>
              <input
                v-model="scriptForm.name"
                class="w-full text-sm px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500"
              />
            </div>
            <div class="flex-1">
              <label class="block text-xs text-gray-500 mb-1">描述（選填）</label>
              <input
                v-model="scriptForm.description"
                class="w-full text-sm px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500"
              />
            </div>
          </div>

          <!-- Path row -->
          <div class="flex-shrink-0">
            <label class="block text-xs text-gray-500 mb-1">檔案路徑</label>
            <div class="flex gap-2">
              <input
                :value="scriptForm.file_path"
                readonly
                class="flex-1 text-xs px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-400 font-mono cursor-default"
                :title="scriptForm.file_path"
              />
              <button
                @click="pickFilePath"
                class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded whitespace-nowrap"
              >
                選擇路徑
              </button>
            </div>
          </div>

          <!-- Builder trigger + pass.ahk designation -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              @click="showBuilder = true"
              class="text-xs px-3 py-1.5 bg-indigo-900/60 hover:bg-indigo-800/80 text-indigo-300 hover:text-indigo-200 rounded transition-colors flex items-center gap-1.5"
            >
              🧩 積木編輯器
            </button>
            <button
              v-if="selectedScript?.file_path !== passAhkPath"
              @click="designateAsPassAhk"
              class="text-xs px-3 py-1.5 bg-amber-900/40 hover:bg-amber-900/70 text-amber-400 hover:text-amber-300 rounded transition-colors"
              title="設為通訊錄變更時自動同步的目標腳本"
            >
              ⚡ 設為帳密腳本
            </button>
            <span v-else class="text-xs text-amber-500/70 flex items-center gap-1">
              ⚡ 帳密腳本連動中
            </span>
          </div>

          <!-- Code editor -->
          <div class="flex-1 flex flex-col min-h-0">
            <label class="block text-xs text-gray-500 mb-1">腳本內容</label>
            <textarea
              v-model="scriptContent"
              spellcheck="false"
              class="flex-1 w-full font-mono text-sm p-3 bg-gray-900 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-600 resize-none leading-relaxed"
            />
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 flex-shrink-0 pt-1">
            <button
              @click="saveScript(true)"
              class="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded font-medium"
            >
              儲存並 Reload
            </button>
            <button
              @click="saveScript(false)"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded"
            >
              僅儲存
            </button>
            <!-- Delete: two-step inline confirm -->
            <div class="ml-auto flex items-center gap-2">
              <template v-if="!showDeleteConfirm">
                <button @click="showDeleteConfirm = true"
                  class="px-4 py-2 bg-red-950/60 hover:bg-red-900/70 text-red-400 hover:text-red-300 text-sm rounded">
                  移除…
                </button>
              </template>
              <template v-else>
                <span class="text-xs text-gray-500">確定要：</span>
                <button @click="deleteScript(false)"
                  class="text-xs px-3 py-1.5 bg-red-950/70 hover:bg-red-900 text-red-400 hover:text-red-300 rounded transition-colors">
                  僅移除紀錄
                </button>
                <button @click="deleteScript(true)"
                  class="text-xs px-3 py-1.5 bg-red-800/80 hover:bg-red-700 text-red-200 rounded transition-colors">
                  移除＋刪除檔案
                </button>
                <button @click="showDeleteConfirm = false"
                  class="text-xs px-2 py-1.5 text-gray-600 hover:text-gray-400 rounded transition-colors">
                  取消
                </button>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ════════════════════════════════ GROUPS TAB ════════════════════════════════ -->
    <div v-if="tab === 'groups'" class="flex flex-1 overflow-hidden">

      <!-- Left: group list -->
      <div class="w-56 flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        <div class="p-3">
          <button
            @click="newGroup"
            class="w-full text-xs py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded font-medium"
          >
            + 新增套組
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <button
            v-for="g in groups"
            :key="g.id"
            @click="selectGroup(g)"
            class="w-full text-left px-3 py-2.5 border-b border-gray-800/60 transition-colors"
            :class="selectedGroup?.id === g.id
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'"
          >
            <div class="text-sm font-medium truncate">{{ g.name }}</div>
            <div v-if="g.description" class="text-xs text-gray-600 truncate mt-0.5">{{ g.description }}</div>
          </button>
          <div v-if="groups.length === 0" class="text-center text-gray-700 text-xs py-10">尚無套組</div>
        </div>
      </div>

      <!-- Right: group editor -->
      <div class="flex-1 flex flex-col overflow-hidden p-5 gap-4">
        <div v-if="!selectedGroup" class="flex-1 flex items-center justify-center">
          <p class="text-gray-700 text-sm">選擇套組或點擊「+ 新增套組」</p>
        </div>

        <template v-else>
          <div class="flex gap-3 flex-shrink-0">
            <div class="flex-1">
              <label class="block text-xs text-gray-500 mb-1">套組名稱</label>
              <input
                v-model="groupForm.name"
                class="w-full text-sm px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500"
              />
            </div>
            <div class="flex-1">
              <label class="block text-xs text-gray-500 mb-1">描述（選填）</label>
              <input
                v-model="groupForm.description"
                class="w-full text-sm px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500"
              />
            </div>
          </div>

          <!-- Script checkboxes -->
          <div class="flex-1 flex flex-col min-h-0">
            <label class="block text-xs text-gray-500 mb-2">包含腳本</label>
            <div class="flex-1 overflow-y-auto space-y-1">
              <label
                v-for="s in scripts"
                :key="s.id"
                class="flex items-center gap-3 px-3 py-2.5 bg-gray-900 hover:bg-gray-800 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  :checked="groupScriptIds.includes(s.id)"
                  @change="toggleGroupScript(s.id)"
                  class="w-4 h-4 accent-blue-500 flex-shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm text-gray-200">{{ s.name }}</div>
                  <div class="text-xs text-gray-600 font-mono truncate">{{ s.file_path }}</div>
                </div>
              </label>
              <div v-if="scripts.length === 0" class="text-center text-gray-700 text-xs py-6">
                尚無腳本可加入，請先在「腳本管理」新增
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              @click="saveGroup"
              class="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded font-medium"
            >
              儲存套組
            </button>
            <button
              @click="reloadGroup"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded"
            >
              Reload 全部
            </button>
            <button
              @click="deleteGroup"
              class="ml-auto px-4 py-2 bg-red-950/60 hover:bg-red-900/70 text-red-400 hover:text-red-300 text-sm rounded"
            >
              刪除套組
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- ════════════════════════════════ GUIDE TAB ════════════════════════════════ -->
    <div v-if="tab === 'guide'" class="flex-1 overflow-y-auto p-6 space-y-6 text-sm">

      <!-- 修飾符速查 -->
      <section>
        <h2 class="text-base font-semibold text-white mb-3">修飾符速查表</h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div v-for="[sym, key, hint] in [
            ['^',  'Ctrl',  '最常用'],
            ['!',  'Alt',   ''],
            ['+',  'Shift', ''],
            ['#',  'Win',   ''],
          ]" :key="sym"
            class="flex items-center gap-3 px-4 py-3 bg-gray-900 rounded-lg border border-gray-800">
            <kbd class="text-lg font-bold font-mono text-blue-400 w-6 text-center">{{ sym }}</kbd>
            <div>
              <div class="text-gray-100 font-medium">{{ key }}</div>
              <div v-if="hint" class="text-xs text-gray-600">{{ hint }}</div>
            </div>
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-600">修飾符可組合，例如 <code class="text-blue-400">^!</code> = Ctrl+Alt、<code class="text-blue-400">^+</code> = Ctrl+Shift</p>
      </section>

      <!-- 快捷鍵語法 -->
      <section>
        <h2 class="text-base font-semibold text-white mb-3">快捷鍵（Hotkeys）</h2>
        <p class="text-gray-400 mb-3">語法：<code class="text-blue-300 bg-gray-900 px-1 rounded">修飾符+按鍵::動作</code>，多行動作用大括號包住。</p>
        <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <div class="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs text-gray-500">範例</div>
          <pre class="p-4 font-mono text-sm text-gray-300 leading-relaxed overflow-x-auto"><code><span class="text-gray-500">; 單行動作</span>
^F1::Run "notepad.exe"          <span class="text-gray-500">; Ctrl+F1 開啟記事本</span>
!+s::Send "Hello World"         <span class="text-gray-500">; Alt+Shift+S 輸入文字</span>
#h::WinMinimize "A"             <span class="text-gray-500">; Win+H 最小化目前視窗</span>

<span class="text-gray-500">; 多行動作</span>
^F2::
{
    Send "^a"                   <span class="text-gray-500">; 全選</span>
    Sleep 50
    Send "^c"                   <span class="text-gray-500">; 複製</span>
}</code></pre>
        </div>
      </section>

      <!-- 熱字串語法 -->
      <section>
        <h2 class="text-base font-semibold text-white mb-1">熱字串（Hotstrings）— 關鍵字展開</h2>
        <p class="text-gray-400 mb-3 text-xs">輸入觸發文字後按空白鍵 / Enter / 標點，自動替換為展開內容。</p>
        <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden mb-3">
          <div class="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs text-gray-500">基本語法</div>
          <pre class="p-4 font-mono text-sm text-gray-300 leading-relaxed overflow-x-auto"><code><span class="text-gray-500">; ::觸發文字::展開內容</span>
::btw::by the way
::addr::台北市信義路一號
::sig::主治醫師 王小明 內科

<span class="text-gray-500">; 臨床常用：藥物醫囑快速輸入</span>
::asp::Aspirin 100mg PO QD after meal
::ns::Normal Saline 0.9% 1000mL IV drip over 8hrs
::npo::NPO after midnight</code></pre>
        </div>

        <h3 class="text-sm font-semibold text-gray-300 mb-2">常用選項</h3>
        <div class="space-y-2">
          <div v-for="[opt, desc, ex] in [
            [':*:',   '立即觸發，不需按空白鍵/標點', ':*:dx::診斷'],
            [':C:',   '區分大小寫（預設不區分）',    ':C:IV::靜脈注射'],
            [':B0:',  '展開後不刪除觸發文字',        ':B0:note::補充說明'],
            [':R:',   '原始模式，保留換行符',         ':R:plan::第一步...'],
          ]" :key="opt"
            class="flex items-start gap-3 px-3 py-2.5 bg-gray-900 rounded border border-gray-800">
            <code class="text-blue-400 font-mono text-xs mt-0.5 w-12 shrink-0">{{ opt }}</code>
            <div class="flex-1 min-w-0">
              <span class="text-gray-300">{{ desc }}</span>
              <code class="ml-2 text-xs text-gray-500 font-mono">{{ ex }}</code>
            </div>
          </div>
        </div>
      </section>

      <!-- 常見範例 -->
      <section>
        <h2 class="text-base font-semibold text-white mb-3">臨床實用範例</h2>
        <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <div class="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs text-gray-500">完整腳本範例</div>
          <pre class="p-4 font-mono text-sm text-gray-300 leading-relaxed overflow-x-auto"><code>#Requires AutoHotkey v2
#SingleInstance Force

<span class="text-gray-500">; ── 快捷鍵 ──────────────────────────────</span>
^!n::Run "notepad.exe"              <span class="text-gray-500">; Ctrl+Alt+N 開啟記事本</span>
^!h::WinMinimize "A"               <span class="text-gray-500">; Ctrl+Alt+H 最小化</span>

<span class="text-gray-500">; ── 常用醫囑熱字串 ──────────────────────</span>
:*:iv1::NS 500mL IV drip over 4hrs
:*:iv2::D5W 500mL IV drip over 6hrs
:*:npo::NPO after midnight
:*:cbcm::CBC+DC, BMP, UA, ECG
:*:sig1::
(
主治醫師
科別：內科
)

<span class="text-gray-500">; ── 常用表單填入 ────────────────────────</span>
^+m::
{
    Send "無藥物過敏"
    Send "{Tab}"
    Send "一般飲食"
}</code></pre>
        </div>
      </section>

      <!-- 帳密腳本說明 -->
      <section class="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
        <h2 class="text-base font-semibold text-amber-300 mb-2">⚡ 帳密自動輸入腳本（pass.ahk）</h2>
        <p class="text-gray-400 text-xs mb-3">
          點擊左側「產生帳密腳本」，MedBase 會從通訊錄自動產生一份 <code class="text-amber-300 bg-gray-900 px-1 rounded">pass.ahk</code>，
          每位醫師的帳號對應一個熱字串，在任何輸入框中輸入觸發詞即可自動展開帳號 + Tab + 密碼。
        </p>
        <div class="bg-gray-900 rounded border border-gray-800 overflow-hidden mb-3">
          <div class="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs text-gray-500">觸發格式</div>
          <table class="w-full text-xs font-mono">
            <thead>
              <tr class="border-b border-gray-800">
                <th class="px-4 py-2 text-left text-gray-500 font-normal">輸入</th>
                <th class="px-4 py-2 text-left text-gray-500 font-normal">展開結果</th>
                <th class="px-4 py-2 text-left text-gray-500 font-normal">說明</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-gray-800/50">
                <td class="px-4 py-2 text-amber-300">.19108</td>
                <td class="px-4 py-2 text-gray-300">19108 <span class="text-gray-600">[Tab]</span> Cgh191088</td>
                <td class="px-4 py-2 text-gray-600">HIS 帳密</td>
              </tr>
              <tr>
                <td class="px-4 py-2 text-amber-300">.p19108</td>
                <td class="px-4 py-2 text-gray-300">19108phs <span class="text-gray-600">[Tab]</span> phs_pw</td>
                <td class="px-4 py-2 text-gray-600">PHS 帳密（前綴 p）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="space-y-1.5 text-xs text-gray-400">
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">•</span>前綴 <code class="text-amber-300 bg-gray-900 px-1 rounded">.</code> 避免日常打字誤觸；帳號本身不含 <code class="text-amber-300 bg-gray-900 px-1 rounded">.</code></li>
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">•</span>使用 <code class="text-amber-300 bg-gray-900 px-1 rounded">:*:</code> 選項，輸入完帳號後立即展開，無須按空白鍵</li>
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">•</span>通訊錄有異動時，重新點「產生帳密腳本」並 Reload 即可更新</li>
          <li class="flex gap-2"><span class="text-yellow-500 shrink-0">•</span>pass.ahk 含明文密碼，請確保電腦存取安全，勿將檔案外傳</li>
        </ul>
      </section>

      <!-- 注意事項 -->
      <section>
        <h2 class="text-base font-semibold text-white mb-3">注意事項</h2>
        <ul class="space-y-2 text-gray-400">
          <li class="flex gap-2">
            <span class="text-blue-400 shrink-0">•</span>
            腳本第一行建議加 <code class="text-blue-300 bg-gray-900 px-1 rounded text-xs">#Requires AutoHotkey v2</code> 避免版本混用
          </li>
          <li class="flex gap-2">
            <span class="text-blue-400 shrink-0">•</span>
            <code class="text-blue-300 bg-gray-900 px-1 rounded text-xs">#SingleInstance Force</code> 可防止重複執行同一腳本
          </li>
          <li class="flex gap-2">
            <span class="text-blue-400 shrink-0">•</span>
            修改後須點「<strong class="text-white">儲存並 Reload</strong>」，變更才會生效
          </li>
          <li class="flex gap-2">
            <span class="text-blue-400 shrink-0">•</span>
            熱字串預設會刪除觸發文字再輸出展開內容；若展開內容含特殊字元，改用 <code class="text-blue-300 bg-gray-900 px-1 rounded text-xs">SendText</code>
          </li>
          <li class="flex gap-2">
            <span class="text-blue-400 shrink-0">•</span>
            <code class="text-xs text-gray-500 font-mono">;</code> 開頭為單行註解，善用註解方便日後維護
          </li>
          <li class="flex gap-2">
            <span class="text-yellow-500 shrink-0">•</span>
            部分快捷鍵（如 <code class="text-blue-300 bg-gray-900 px-1 rounded text-xs">Win+L</code>）可能被 Windows 系統攔截，使用前先測試
          </li>
        </ul>
      </section>

    </div>

    <!-- Builder Modal -->
    <Teleport to="body">
      <div v-if="showBuilder" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" @click.self="showBuilder = false">
        <div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[860px] max-h-[88vh] flex flex-col">

          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 flex-shrink-0">
            <h3 class="text-sm font-semibold text-white">🧩 積木編輯器</h3>
            <button @click="showBuilder = false" class="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
          </div>

          <!-- Body -->
          <div class="flex flex-1 overflow-hidden">

            <!-- Left: block list -->
            <div class="w-64 border-r border-gray-800 flex flex-col overflow-hidden flex-shrink-0">
              <div class="px-3 py-2 text-xs text-gray-600 border-b border-gray-800 flex-shrink-0">
                已加入 {{ builderBlocks.length }} 個區塊
              </div>
              <div class="flex-1 overflow-y-auto">
                <div v-if="!builderBlocks.length" class="text-center text-gray-700 text-xs py-10 px-4">
                  尚無區塊<br>在右側填好後點「加入清單」
                </div>
                <div
                  v-for="(b, i) in builderBlocks"
                  :key="b.id"
                  class="border-b border-gray-800/60 px-3 py-2.5 flex items-start gap-2 group cursor-pointer transition-colors"
                  :class="editingBlockIdx === i ? 'bg-gray-800' : 'hover:bg-gray-800/50'"
                  @click="editBuilderBlock(i)"
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 mb-0.5">
                      <span class="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                        :class="b.type === 'hotstring' ? 'bg-green-900/60 text-green-400' : 'bg-blue-900/60 text-blue-400'">
                        {{ b.type === 'hotstring' ? '熱字串' : '快捷鍵' }}
                      </span>
                      <span v-if="b.comment" class="text-xs text-gray-600 truncate">{{ b.comment }}</span>
                    </div>
                    <div class="text-xs font-mono text-gray-500 truncate">
                      <template v-if="b.type === 'hotstring'">
                        ::{{ b.trigger }}:: {{ b.expansion.slice(0, 22) }}{{ b.expansion.length > 22 ? '…' : '' }}
                      </template>
                      <template v-else>
                        {{ (b.modCtrl?'^':'')+(b.modShift?'+':'')+(b.modAlt?'!':'')+(b.modWin?'#':'') }}{{ b.key }} → {{ b.hkAction.slice(0, 18) }}{{ b.hkAction.length > 18 ? '…' : '' }}
                      </template>
                    </div>
                  </div>
                  <button
                    @click.stop="removeBuilderBlock(i)"
                    class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-sm transition-opacity flex-shrink-0 mt-0.5"
                  >✕</button>
                </div>
              </div>
              <div class="p-3 border-t border-gray-800 flex-shrink-0">
                <button
                  @click="insertBuilderToScript"
                  :disabled="!builderBlocks.length"
                  class="w-full py-2 text-sm rounded font-medium transition-colors"
                  :class="builderBlocks.length ? 'bg-blue-700 hover:bg-blue-600 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'"
                >
                  插入到腳本（{{ builderBlocks.length }}）
                </button>
              </div>
            </div>

            <!-- Right: form -->
            <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3">

              <!-- Type selector -->
              <div class="flex gap-2 flex-shrink-0">
                <button
                  v-for="[t, label] in [['hotstring','🔤 熱字串（展開文字）'],['hotkey','⌨ 快捷鍵（快速鍵）']]"
                  :key="t"
                  @click="setBuilderType(t)"
                  class="px-4 py-1.5 text-sm rounded transition-colors border"
                  :class="builderForm.type === t
                    ? 'bg-gray-700 border-gray-500 text-white'
                    : 'border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'"
                >{{ label }}</button>
              </div>

              <!-- ── Hotstring form ── -->
              <template v-if="builderForm.type === 'hotstring'">

                <!-- Trigger + options -->
                <div class="flex gap-3 items-end flex-shrink-0">
                  <div class="w-44">
                    <label class="block text-xs text-gray-500 mb-1">觸發文字 <span class="text-red-500">*</span></label>
                    <input
                      v-model="builderForm.trigger"
                      placeholder="npo / addr / sig1"
                      class="w-full text-sm px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500 font-mono"
                    />
                  </div>
                  <div class="flex items-center gap-3 pb-0.5">
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 select-none">
                      <input type="checkbox" v-model="builderForm.optInstant" class="w-3.5 h-3.5 accent-indigo-500" />
                      即時觸發 <code class="text-indigo-400 font-mono text-xs">*</code>
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 select-none">
                      <input type="checkbox" v-model="builderForm.optInWord" class="w-3.5 h-3.5 accent-indigo-500" />
                      字中觸發 <code class="text-indigo-400 font-mono text-xs">?</code>
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 select-none">
                      <input type="checkbox" v-model="builderForm.optCase" class="w-3.5 h-3.5 accent-indigo-500" />
                      大小寫 <code class="text-indigo-400 font-mono text-xs">C</code>
                    </label>
                  </div>
                </div>

                <!-- Mode tabs -->
                <div class="flex gap-1 flex-shrink-0">
                  <button
                    @click="builderForm.hsMode = 'inline'"
                    class="px-3 py-1.5 text-xs rounded transition-colors border"
                    :class="builderForm.hsMode === 'inline' ? 'bg-gray-700 border-gray-500 text-white' : 'border-gray-800 text-gray-600 hover:text-gray-400'"
                    title="直接展開為純文字，觸發後替換"
                  >單行文字</button>
                  <button
                    @click="builderForm.hsMode = 'multitext'"
                    class="px-3 py-1.5 text-xs rounded transition-colors border"
                    :class="builderForm.hsMode === 'multitext' ? 'bg-gray-700 border-gray-500 text-white' : 'border-gray-800 text-gray-600 hover:text-gray-400'"
                    title="多行文字，自動產生 SendText + Enter"
                  >多行文字</button>
                  <button
                    @click="builderForm.hsMode = 'rawcode'"
                    class="px-3 py-1.5 text-xs rounded transition-colors border"
                    :class="builderForm.hsMode === 'rawcode' ? 'bg-gray-700 border-gray-500 text-white' : 'border-gray-800 text-gray-600 hover:text-gray-400'"
                    title="自行輸入原始 AHK 指令，包在 { } 內"
                  >原始 AHK 指令</button>
                </div>

                <!-- Content -->
                <div class="flex-shrink-0">
                  <label class="block text-xs text-gray-500 mb-1">
                    <template v-if="builderForm.hsMode === 'inline'">展開文字（單行）</template>
                    <template v-else-if="builderForm.hsMode === 'multitext'">展開文字（換行 = Enter；<code class="text-indigo-400 font-mono">\t</code> = Tab）</template>
                    <template v-else>AHK 指令（每行一個，自動包在 { } 內）</template>
                  </label>
                  <input
                    v-if="builderForm.hsMode === 'inline'"
                    v-model="builderForm.expansion"
                    placeholder="例如：NPO after midnight"
                    class="w-full text-sm px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500"
                  />
                  <textarea
                    v-else
                    v-model="builderForm.expansion"
                    :placeholder="hsExpansionPlaceholder"
                    rows="5"
                    class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500 font-mono resize-none"
                  />
                </div>
              </template>

              <!-- ── Hotkey form ── -->
              <template v-else>

                <!-- Modifiers + key -->
                <div class="flex items-end gap-3 flex-shrink-0">
                  <div>
                    <label class="block text-xs text-gray-500 mb-1">修飾鍵</label>
                    <div class="flex gap-1.5">
                      <label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded border cursor-pointer transition-colors text-xs select-none"
                        :class="builderForm.modCtrl ? 'bg-indigo-900/60 border-indigo-600 text-indigo-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'">
                        <input type="checkbox" v-model="builderForm.modCtrl" class="hidden" />
                        <code class="font-mono">^</code> Ctrl
                      </label>
                      <label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded border cursor-pointer transition-colors text-xs select-none"
                        :class="builderForm.modShift ? 'bg-indigo-900/60 border-indigo-600 text-indigo-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'">
                        <input type="checkbox" v-model="builderForm.modShift" class="hidden" />
                        <code class="font-mono">+</code> Shift
                      </label>
                      <label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded border cursor-pointer transition-colors text-xs select-none"
                        :class="builderForm.modAlt ? 'bg-indigo-900/60 border-indigo-600 text-indigo-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'">
                        <input type="checkbox" v-model="builderForm.modAlt" class="hidden" />
                        <code class="font-mono">!</code> Alt
                      </label>
                      <label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded border cursor-pointer transition-colors text-xs select-none"
                        :class="builderForm.modWin ? 'bg-indigo-900/60 border-indigo-600 text-indigo-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'">
                        <input type="checkbox" v-model="builderForm.modWin" class="hidden" />
                        <code class="font-mono">#</code> Win
                      </label>
                    </div>
                  </div>
                  <div class="w-36">
                    <label class="block text-xs text-gray-500 mb-1">按鍵 <span class="text-red-500">*</span></label>
                    <input
                      v-model="builderForm.key"
                      placeholder="F1, a, Enter, Space…"
                      class="w-full text-sm px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500 font-mono"
                    />
                  </div>
                </div>

                <!-- Mode toggle -->
                <div class="flex gap-1 flex-shrink-0">
                  <button
                    @click="builderForm.hkMode = 'single'"
                    class="px-3 py-1.5 text-xs rounded transition-colors border"
                    :class="builderForm.hkMode === 'single' ? 'bg-gray-700 border-gray-500 text-white' : 'border-gray-800 text-gray-600 hover:text-gray-400'"
                  >單行動作</button>
                  <button
                    @click="builderForm.hkMode = 'multi'"
                    class="px-3 py-1.5 text-xs rounded transition-colors border"
                    :class="builderForm.hkMode === 'multi' ? 'bg-gray-700 border-gray-500 text-white' : 'border-gray-800 text-gray-600 hover:text-gray-400'"
                  >多行動作</button>
                </div>

                <!-- Action -->
                <div class="flex-shrink-0">
                  <label class="block text-xs text-gray-500 mb-1">
                    {{ builderForm.hkMode === 'single' ? '動作（單行 AHK 指令）' : '動作（多行，自動包在 { } 內）' }}
                  </label>
                  <input
                    v-if="builderForm.hkMode === 'single'"
                    v-model="builderForm.hkAction"
                    placeholder='例如：Run "notepad.exe"'
                    class="w-full text-sm px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500 font-mono"
                  />
                  <textarea
                    v-else
                    v-model="builderForm.hkAction"
                    :placeholder="hkActionPlaceholder"
                    rows="5"
                    class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500 font-mono resize-none"
                  />
                </div>
              </template>

              <!-- Comment -->
              <div class="flex-shrink-0">
                <label class="block text-xs text-gray-500 mb-1">備註（選填，產生為 ; 開頭的 AHK 註解）</label>
                <input
                  v-model="builderForm.comment"
                  placeholder="例如：Ctrl+F1 開啟記事本"
                  class="w-full text-sm px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 outline-none focus:border-gray-500"
                />
              </div>

              <!-- Preview -->
              <div v-if="builderPreview" class="flex-shrink-0">
                <label class="block text-xs text-gray-500 mb-1">預覽</label>
                <pre class="text-xs font-mono bg-gray-950 border border-gray-800 rounded p-3 text-green-400 overflow-x-auto whitespace-pre">{{ builderPreview }}</pre>
              </div>

              <!-- Add / Update button -->
              <div class="flex items-center gap-2 flex-shrink-0 pt-1">
                <button
                  @click="addOrUpdateBlock"
                  class="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 text-white text-sm rounded font-medium transition-colors"
                >
                  {{ editingBlockIdx !== null ? '更新區塊' : '＋ 加入清單' }}
                </button>
                <button
                  v-if="editingBlockIdx !== null"
                  @click="cancelEditBlock"
                  class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
                >
                  取消編輯
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Transition name="toast">
      <div
        v-if="toast"
        class="fixed bottom-5 right-5 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg shadow-lg pointer-events-none"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }
</style>
