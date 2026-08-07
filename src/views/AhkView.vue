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
import { markLocalModified, saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { useLogger } from "@/composables/useLogger";
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

// ── AHK Diff Modal ─────────────────────────────────────────────────────
interface AhkDiffItem {
  id: number;
  name: string;
  targetPath: string;
  description: string;
  localContent: string;
  cloudContent: string;
  cloudTs: string;
  selected: boolean;
}
const diffModalOpen = ref(false);
const diffItems     = ref<AhkDiffItem[]>([]);

async function applySelectedDiffs() {
  const db = await getDb();
  let written = 0;
  for (const item of diffItems.value) {
    if (!item.selected) continue;
    try {
      await writeTextFile(item.targetPath, item.cloudContent);
      await db.execute(
        `INSERT OR REPLACE INTO ahk_scripts (id, name, file_path, description, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [item.id, item.name, item.targetPath, item.description, item.cloudTs || new Date().toISOString()]
      );
      written++;
    } catch (e) {
      console.error("[AHK diff apply] failed:", item.name, e);
    }
  }
  diffModalOpen.value = false;
  await loadAll();
  showToast(`已套用 ${written} 個腳本更新`);
}

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
    await markLocalModified("ahk");
    pushToCloud().catch(() => {});

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
    const payload: { id: number; name: string; file_path: string; description: string; content: string; updated_at: string }[] = [];
    for (const s of scripts.value) {
      let content = "";
      try { content = await readTextFile(s.file_path); } catch { /* 讀不到就帶空字串 */ }
      payload.push({ id: s.id, name: s.name, file_path: s.file_path, description: s.description ?? "", content, updated_at: s.updated_at ?? "" });
    }
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveAhkScripts", scripts: payload }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 錯誤");
    showToast(`已備份 ${payload.length} 個腳本至雲端`);
    await saveSyncTimestamp("ahk");
    useLogger().addLog("info", `[雲端同步] push AHK 管理 — ${payload.length} 筆`, JSON.stringify({ table: "ahk", action: "push", timestamp: new Date().toISOString() }));
  } catch (e) {
    showError(`備份失敗：${(e as Error).message}`, e);
    useLogger().addLog("warn", "[雲端同步] push AHK 管理 失敗", String(e));
  }
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
    const localMap = new Map(scripts.value.map(s => [s.id, s]));

    const docDir = await documentDir();
    const ahkDir = await join(docDir, "MedBase", "ahk");

    const toShowDiff: AhkDiffItem[] = [];
    const localNewerNames: string[] = [];
    let skipped = 0, remapped = 0;

    for (const cs of cloudScripts) {
      let targetPath = cs.file_path;

      // 路徑不存在，改放預設資料夾
      const pathOk = cs.file_path ? await exists(cs.file_path).catch(() => false) : false;
      if (!pathOk) {
        try { await mkdir(ahkDir, { recursive: true }); } catch (e) {
          throw new Error(`無法建立資料夾 ${ahkDir}：${e instanceof Error ? e.message : String(e)}`);
        }
        const filename = (cs.file_path?.split(/[\\/]/).pop()) || `script_${cs.id}.ahk`;
        const candidate = await join(ahkDir, filename);
        targetPath = await exists(candidate).catch(() => false)
          ? await join(ahkDir, `${cs.id}_${filename}`)
          : candidate;
        remapped++;
      }

      // 讀本地檔案內容
      let localContent = "";
      try { localContent = await readTextFile(targetPath); } catch { /* 不存在視為空 */ }

      if (localContent === cs.content) {
        // 內容相同，僅確保 DB 路徑正確
        await db.execute(
          `INSERT OR REPLACE INTO ahk_scripts (id, name, file_path, description, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [cs.id, cs.name, targetPath, cs.description ?? "", cs.updated_at || localMap.get(cs.id)?.updated_at || ""]
        );
        skipped++;
        continue;
      }

      // 內容不同，比對時間戳
      const localTs = localMap.get(cs.id)?.updated_at ?? "";
      const cloudTs = cs.updated_at ?? "";

      if (!localContent || cloudTs > localTs) {
        // 本地無內容，或雲端較新 → 加入 diff 確認清單
        toShowDiff.push({
          id: cs.id, name: cs.name, targetPath,
          description: cs.description ?? "",
          localContent, cloudContent: cs.content,
          cloudTs, selected: true,
        });
      } else {
        // 本地較新 → toast 提示，略過
        localNewerNames.push(cs.name);
      }
    }

    if (localNewerNames.length > 0) {
      showToast(`本地版本較新，已略過：${localNewerNames.join("、")}`);
    }
    const parts: string[] = [];
    if (skipped > 0)  parts.push(`${skipped} 個已是最新`);
    if (remapped > 0) parts.push(`${remapped} 個路徑已重新對應`);

    if (toShowDiff.length > 0) {
      diffItems.value = toShowDiff;
      diffModalOpen.value = true;
      if (parts.length) showToast(parts.join("，"));
    } else {
      await loadAll();
      showToast(parts.length ? parts.join("，") : "所有腳本皆已是最新");
    }
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
  <div class="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">

    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0 bg-slate-950 z-[3]">
      <div>
        <h1 class="text-sm font-black uppercase tracking-wider text-slate-200">AHK 腳本管理</h1>
        <p class="text-2xs text-slate-500 mt-0.5 font-bold">
          AutoHotkey 設定檔 CRUD · 套組管理 · 自動 Reload ·
          <button
            @click="openAhkSite"
            class="text-indigo-400 hover:text-indigo-300 hover:underline transition-colors cursor-pointer"
          >↗ 下載 AutoHotkey</button>
        </p>
      </div>
      <button
        @click="showSettings = !showSettings"
        class="text-xs px-3.5 py-1.5 rounded-xl transition-all cursor-pointer font-bold border"
        :class="showSettings
          ? 'bg-slate-800 border-white/10 text-white'
          : 'bg-slate-900/40 border-white/5 text-slate-500 hover:text-slate-300 hover:bg-slate-900/60'"
      >
        ⚙ 設定
      </button>
    </div>

    <!-- Settings Panel -->
    <div v-if="showSettings" class="flex items-center gap-4 px-6 py-3 bg-slate-900/20 border-b border-white/5 flex-shrink-0 z-[2]">
      <span class="text-2xs text-slate-500 font-black uppercase tracking-widest font-mono whitespace-nowrap">AHK 執行檔:</span>
      <span class="text-xs text-slate-400 font-mono flex-1 truncate font-bold bg-slate-950/60 border border-white/5 px-3 py-1.5 rounded-xl">
        {{ ahkExePath || '未設定（請點右側按鈕進行選擇）' }}
      </span>
      <button
        @click="pickExePath"
        class="text-xs px-3.5 py-1.5 bg-slate-800 border border-white/5 hover:border-white/10 hover:text-white rounded-xl whitespace-nowrap transition-all cursor-pointer font-bold"
      >
        選擇 .exe 檔案
      </button>
      <span class="text-2xs text-slate-500 font-bold font-mono">
        預設路徑: C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe
      </span>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 px-6 pt-3 border-b border-white/5 flex-shrink-0 bg-slate-950 z-[1]">
      <button
        v-for="[key, label] in [['scripts', '腳本管理'], ['groups', '套組管理'], ['guide', '使用說明']]"
        :key="key"
        @click="tab = key as 'scripts' | 'groups' | 'guide'"
        class="px-4 pb-2.5 text-xs font-black transition-all border-b-2 cursor-pointer"
        :class="tab === key
          ? 'border-indigo-500 text-indigo-200'
          : 'border-transparent text-slate-500 hover:text-slate-300'"
      >
        {{ label }}
      </button>
    </div>

    <!-- ════════════════════════════════ SCRIPTS TAB ════════════════════════════════ -->
    <div v-if="tab === 'scripts'" class="flex flex-1 overflow-hidden">

      <!-- Left: list -->
      <div class="w-64 flex-shrink-0 border-r border-white/5 flex flex-col overflow-hidden bg-zinc-950/20">
        <div class="p-3.5 flex gap-2 shrink-0">
          <input
            v-model="search"
            placeholder="搜尋腳本名稱…"
            class="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-950/60 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 font-bold"
          />
        </div>
        <div class="flex gap-2 px-3.5 pb-2 shrink-0">
          <button
            @click="newScript"
            class="flex-1 text-xs py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white rounded-xl font-black transition-all cursor-pointer"
          >
            ＋ 新增
          </button>
          <button
            @click="importFile"
            class="flex-1 text-xs py-2 bg-slate-800 border border-white/5 text-slate-300 hover:text-white rounded-xl font-bold transition-all cursor-pointer"
          >
            匯入
          </button>
        </div>
        <div class="px-3.5 pb-3.5 space-y-2 border-b border-white/5 shrink-0">
          <button
            @click="generatePassAhk"
            class="w-full text-xs py-2 bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 rounded-xl flex items-center justify-center gap-1.5 transition-colors font-black cursor-pointer"
            title="從通訊錄的帳密自動產生 AHK 熱字串腳本"
          >
            <span>⚡</span> 產生帳密腳本
          </button>
          <div class="grid grid-cols-2 gap-2">
            <button @click="pullFromCloud" :disabled="isSyncing"
              class="text-2xs py-1.5 bg-slate-950 border border-white/5 text-slate-400 rounded-xl hover:text-slate-200 disabled:opacity-40 transition-colors font-bold cursor-pointer">
              {{ isSyncing ? '…' : '☁️↓ 還原' }}
            </button>
            <button @click="pushToCloud" :disabled="isSyncing"
              class="text-2xs py-1.5 bg-slate-800/40 border border-white/5 text-slate-400 rounded-xl hover:text-slate-200 disabled:opacity-40 transition-colors font-bold cursor-pointer">
              {{ isSyncing ? '…' : '☁️↑ 備份' }}
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar">
          <button
            v-for="s in filteredScripts"
            :key="s.id"
            @click="selectScript(s)"
            class="w-full text-left px-4 py-3 border-b border-white/[0.02] transition-colors cursor-pointer"
            :class="selectedScript?.id === s.id
              ? 'bg-slate-900/40 text-white'
              : 'text-slate-400 hover:bg-slate-900/10 hover:text-slate-200'"
          >
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold truncate flex-1">{{ s.name }}</span>
              <span v-if="s.file_path === passAhkPath"
                class="text-3xs px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono font-bold flex-shrink-0">帳密</span>
            </div>
            <div class="text-2xs text-slate-500 font-mono truncate mt-1">
              {{ s.file_path.split(/[\\/]/).pop() }}
            </div>
          </button>
          <div v-if="filteredScripts.length === 0" class="text-center text-slate-600 text-xs py-10 italic">
            {{ search ? '無符合搜尋條件的腳本' : '尚無設定檔資料' }}
          </div>
        </div>
      </div>

      <!-- Right: editor -->
      <div class="flex-1 flex flex-col overflow-hidden p-6 gap-4">
        <div v-if="!selectedScript" class="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3">
          <span class="text-5xl">📄</span>
          <p class="text-xs font-bold tracking-wide">選擇左側腳本，或點擊「＋ 新增」建立設定檔</p>
        </div>

        <template v-else>
          <!-- Meta row -->
          <div class="grid grid-cols-2 gap-4 flex-shrink-0">
            <div class="bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
              <label class="block text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-1.5">腳本顯示名稱</label>
              <input
                v-model="scriptForm.name"
                class="w-full text-xs px-3 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-200 outline-none focus:border-indigo-500/50 font-bold"
              />
            </div>
            <div class="bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
              <label class="block text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-1.5">功能描述（備註）</label>
              <input
                v-model="scriptForm.description"
                placeholder="選填說明用途…"
                class="w-full text-xs px-3 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-200 outline-none focus:border-indigo-500/50 font-bold"
              />
            </div>
          </div>

          <!-- Path row -->
          <div class="bg-white/[0.02] border border-white/5 rounded-xl p-3.5 flex-shrink-0">
            <label class="block text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-1.5">本機檔案儲存路徑</label>
            <div class="flex gap-2">
              <input
                :value="scriptForm.file_path"
                readonly
                class="flex-1 text-xs px-3 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-400 font-mono cursor-default"
                :title="scriptForm.file_path"
              />
              <button
                @click="pickFilePath"
                class="text-xs px-3.5 py-1.5 bg-slate-800 border border-white/5 hover:border-white/10 text-slate-200 hover:text-white rounded-lg whitespace-nowrap transition-all cursor-pointer font-bold"
              >
                變更路徑
              </button>
            </div>
          </div>

          <!-- Builder trigger + pass.ahk designation -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              @click="showBuilder = true"
              class="text-xs px-4 py-2 bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-all cursor-pointer font-black flex items-center gap-1.5"
            >
              🧩 積木視覺編輯器
            </button>
            <button
              v-if="selectedScript?.file_path !== passAhkPath"
              @click="designateAsPassAhk"
              class="text-xs px-4 py-2 bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 rounded-xl transition-all cursor-pointer font-bold"
              title="設為通訊錄變更時自動同步的目標腳本"
            >
              ⚡ 設為通訊錄連動帳密腳本
            </button>
            <span v-else class="text-2xs font-black text-amber-500 uppercase tracking-wider font-mono flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl">
              ⚡ 帳密腳本連動狀態中
            </span>
          </div>

          <!-- Code editor -->
          <div class="flex-1 flex flex-col min-h-0">
            <label class="block text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-1.5">腳本源碼編輯 (V2 語法)</label>
            <textarea
              v-model="scriptContent"
              spellcheck="false"
              class="flex-1 w-full font-mono text-xs p-4 bg-slate-950/70 border border-white/5 rounded-2xl text-slate-200 outline-none focus:border-indigo-500/30 focus:shadow-[0_0_12px_rgba(99,102,241,0.08)] resize-none leading-relaxed custom-scrollbar"
            />
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 flex-shrink-0 pt-1">
            <button
              @click="saveScript(true)"
              class="px-5 py-2.5 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white text-xs font-black rounded-xl hover:shadow-[0_0_15px_rgba(99,102,241,0.2)] transition-all cursor-pointer"
            >
              儲存並載入 (Reload)
            </button>
            <button
              @click="saveScript(false)"
              class="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              僅儲存檔案
            </button>
            <!-- Delete: two-step inline confirm -->
            <div class="ml-auto flex items-center gap-2">
              <template v-if="!showDeleteConfirm">
                <button @click="showDeleteConfirm = true"
                  class="px-4 py-2.5 bg-rose-950/40 border border-rose-900/30 text-rose-400 hover:bg-rose-900/30 hover:text-rose-300 text-xs font-bold rounded-xl transition-all cursor-pointer">
                  移除此紀錄…
                </button>
              </template>
              <template v-else>
                <span class="text-2xs font-black text-slate-500 font-mono uppercase tracking-wider">安全驗證:</span>
                <button @click="deleteScript(false)"
                  class="text-2xs px-3 py-2 bg-rose-950/60 border border-rose-900/30 text-rose-400 hover:text-rose-300 rounded-xl font-bold transition-colors cursor-pointer">
                  僅移除 DB 紀錄
                </button>
                <button @click="deleteScript(true)"
                  class="text-2xs px-3 py-2 bg-rose-700 border border-rose-600 text-white rounded-xl font-black transition-colors cursor-pointer">
                  同時刪除本機 AHK 檔案
                </button>
                <button @click="showDeleteConfirm = false"
                  class="text-2xs px-3 py-2 text-slate-500 hover:text-slate-300 font-bold transition-colors cursor-pointer">
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
      <div class="w-64 flex-shrink-0 border-r border-white/5 flex flex-col overflow-hidden bg-zinc-950/20">
        <div class="p-3.5 border-b border-white/5 shrink-0">
          <button
            @click="newGroup"
            class="w-full text-xs py-2 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white rounded-xl font-black transition-all cursor-pointer"
          >
            ＋ 新增套組
          </button>
        </div>
        <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar">
          <button
            v-for="g in groups"
            :key="g.id"
            @click="selectGroup(g)"
            class="w-full text-left px-4 py-3 border-b border-white/[0.02] transition-colors cursor-pointer"
            :class="selectedGroup?.id === g.id
              ? 'bg-slate-900/40 text-white'
              : 'text-slate-400 hover:bg-slate-900/10 hover:text-slate-200'"
          >
            <div class="text-xs font-bold truncate">{{ g.name }}</div>
            <div v-if="g.description" class="text-2xs text-slate-500 truncate mt-1">{{ g.description }}</div>
          </button>
          <div v-if="groups.length === 0" class="text-center text-slate-600 text-xs py-10 italic">尚無套組資料</div>
        </div>
      </div>

      <!-- Right: group editor -->
      <div class="flex-1 flex flex-col overflow-hidden p-6 gap-4">
        <div v-if="!selectedGroup" class="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3">
          <span class="text-5xl">📁</span>
          <p class="text-xs font-bold tracking-wide">選擇左側套組，或點擊「＋ 新增套組」開始編排</p>
        </div>

        <template v-else>
          <div class="grid grid-cols-2 gap-4 flex-shrink-0">
            <div class="bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
              <label class="block text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-1.5">套組顯示名稱</label>
              <input
                v-model="groupForm.name"
                class="w-full text-xs px-3 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-200 outline-none focus:border-indigo-500/50 font-bold"
              />
            </div>
            <div class="bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
              <label class="block text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-1.5">套組備註</label>
              <input
                v-model="groupForm.description"
                placeholder="說明此群組腳本共同用途…"
                class="w-full text-xs px-3 py-1.5 bg-slate-950 border border-white/10 rounded-lg text-slate-200 outline-none focus:border-indigo-500/50 font-bold"
              />
            </div>
          </div>

          <!-- Script checkboxes -->
          <div class="flex-1 flex flex-col min-h-0">
            <label class="block text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-2">勾選要納入此套組的腳本設定檔</label>
            <div class="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
              <label
                v-for="s in scripts"
                :key="s.id"
                class="flex items-center gap-3.5 px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 rounded-xl cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  :checked="groupScriptIds.includes(s.id)"
                  @change="toggleGroupScript(s.id)"
                  class="w-4 h-4 rounded accent-indigo-500 flex-shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-bold text-slate-200">{{ s.name }}</div>
                  <div class="text-2xs text-slate-500 font-mono truncate mt-0.5">{{ s.file_path }}</div>
                </div>
              </label>
              <div v-if="scripts.length === 0" class="text-center text-slate-600 text-xs py-10 italic">
                目前本機尚無腳本，請先在「腳本管理」分頁建立或匯入 AHK 檔。
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2.5 flex-shrink-0">
            <button
              @click="saveGroup"
              class="px-5 py-2.5 bg-indigo-600 border border-indigo-500/30 hover:bg-indigo-500 text-white text-xs font-black rounded-xl transition-all cursor-pointer shadow-md"
            >
              儲存套組設定
            </button>
            <button
              @click="reloadGroup"
              class="px-4 py-2.5 bg-slate-800 border border-white/5 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              一次載入 (Reload) 套組內所有腳本
            </button>
            <button
              @click="deleteGroup"
              class="ml-auto px-4 py-2.5 bg-rose-950/40 border border-rose-900/30 text-rose-400 hover:bg-rose-900/30 hover:text-rose-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              刪除此套組
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- ════════════════════════════════ GUIDE TAB ════════════════════════════════ -->
    <div v-if="tab === 'guide'" class="flex-1 overflow-y-auto p-6 space-y-6 text-xs custom-scrollbar">

      <!-- 修飾符速查 -->
      <section class="bg-white/[0.01] border border-white/5 rounded-2xl p-5 shadow-sm">
        <h2 class="text-xs font-black uppercase tracking-wider text-slate-200 mb-3.5 flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0"></span>
          AHK 常用熱鍵修飾符號速查表
        </h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div v-for="[sym, key, hint] in [
            ['^',  'Ctrl 鍵',  '最常用控制熱鍵組合'],
            ['!',  'Alt 鍵',   '臨床輔助組合修飾符'],
            ['+',  'Shift 鍵', '切換/文字區分修飾符'],
            ['#',  'Win 鍵',   '作業系統層級快捷鍵'],
          ]" :key="sym"
            class="flex items-center gap-3.5 px-4 py-3 bg-slate-950/40 border border-white/5 rounded-xl shadow-sm">
            <kbd class="text-base font-black font-mono text-cyan-400 bg-slate-950 px-2 py-0.5 rounded border border-white/10 w-8 text-center">{{ sym }}</kbd>
            <div>
              <div class="text-slate-200 font-bold text-xs">{{ key }}</div>
              <div v-if="hint" class="text-3xs text-slate-500 font-medium font-mono mt-0.5">{{ hint }}</div>
            </div>
          </div>
        </div>
        <p class="mt-3 text-2xs text-slate-500 font-mono font-bold pl-1">
          提示: 修飾符可以合併宣告，例如 <code class="text-cyan-400 bg-slate-900 px-1.5 py-0.5 rounded font-mono border border-white/5">^!</code> 代表 Ctrl + Alt，而 <code class="text-cyan-400 bg-slate-900 px-1.5 py-0.5 rounded font-mono border border-white/5">^+</code> 代表 Ctrl + Shift。
        </p>
      </section>

      <!-- 快捷鍵語法 -->
      <section class="bg-white/[0.01] border border-white/5 rounded-2xl p-5 shadow-sm">
        <h2 class="text-xs font-black uppercase tracking-wider text-slate-200 mb-3 flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0"></span>
          熱鍵 (Hotkeys) 語法基礎
        </h2>
        <p class="text-slate-400 mb-3.5 font-medium leading-relaxed">
          宣告語法為：<code class="text-cyan-400 bg-slate-900 px-1.5 py-0.5 rounded border border-white/5 font-mono">修飾符 + 按鍵名稱::動作指令</code>。如果是包含多行指令的動作，指令碼必須使用大括弧 <code class="text-cyan-400 font-mono font-bold">{}</code> 包裹。
        </p>
        <div class="bg-slate-950/70 border border-white/5 rounded-xl overflow-hidden shadow-inner">
          <div class="px-4 py-2 bg-slate-950 border-b border-white/5 text-3xs font-black uppercase tracking-widest font-mono text-slate-500">標準代碼結構範例</div>
          <pre class="p-4 font-mono text-xs text-slate-400 leading-relaxed overflow-x-auto"><code><span class="text-slate-600">; 單行動作範例</span>
^F1::Run "notepad.exe"          <span class="text-slate-600">; 按 Ctrl+F1 會開啟本機記事本</span>
!+s::Send "Hello World"         <span class="text-slate-600">; 按 Alt+Shift+S 會自動打出文字</span>
#h::WinMinimize "A"             <span class="text-slate-600">; 按 Win+H 會將當前作用視窗最小化</span>
 
<span class="text-slate-600">; 多行動作範例 (必須使用 {} 包起範疇)</span>
^F2::
{
    Send "^a"                   <span class="text-slate-600">; Ctrl+A 全選</span>
    Sleep 50                    <span class="text-slate-600">; 延遲 50 毫秒以等待系統反應</span>
    Send "^c"                   <span class="text-slate-600">; Ctrl+C 複製</span>
}</code></pre>
        </div>
      </section>

      <!-- 熱字串語法 -->
      <section class="bg-white/[0.01] border border-white/5 rounded-2xl p-5 shadow-sm">
        <h2 class="text-xs font-black uppercase tracking-wider text-slate-200 mb-2 flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0"></span>
          熱字串 (Hotstrings) 語法基礎 — 縮寫自動展開
        </h2>
        <p class="text-slate-400 mb-3.5 font-medium leading-relaxed">
          輸入預設縮寫後，按下空白鍵 (Space)、Enter 或標點符號，系統將會偵測並自動替換為展開的文字。
        </p>
        <div class="bg-slate-950/70 border border-white/5 rounded-xl overflow-hidden mb-4 shadow-inner">
          <div class="px-4 py-2 bg-slate-950 border-b border-white/5 text-3xs font-black uppercase tracking-widest font-mono text-slate-500">基礎縮寫語法範例</div>
          <pre class="p-4 font-mono text-xs text-slate-400 leading-relaxed overflow-x-auto"><code><span class="text-slate-600">; 格式： ::縮寫碼::展開後的完整文字</span>
::btw::by the way
::addr::台北市信義路五段7號
::sig::內科主治醫師 王小明 (門診時間)
 
<span class="text-slate-600">; 臨床醫師實用醫囑縮寫範例</span>
::asp::Aspirin 100mg PO QD PC (飯後服用)
::ns::Normal Saline 0.9% 500mL IV drip st.
::npo::NPO after midnight (午夜禁食)</code></pre>
        </div>

        <h3 class="text-xs font-black text-slate-300 mb-2.5 uppercase tracking-wider font-mono pl-1">熱字串常用參數修飾選項</h3>
        <div class="space-y-2">
          <div v-for="[opt, desc, ex] in [
            [':*:',   '打完縮寫即時展開替換，無須再敲擊 Space 鍵或標點。', ':*:dx::Diagnosis:'],
            [':C:',   '嚴格區分大小寫字母（預設是不區分大小寫）。',        ':C:IV::Intravenous'],
            [':B0:',  '展開時，保留並「不刪除」原先打出來的縮寫文字。',        ':B0:note::說明：'],
            [':R:',   '以 RAW 原始格式展開文字，保留其內部的換行或特別符號。', ':R:plan::1....\n2....'],
          ]" :key="opt"
            class="flex items-start gap-3 px-4 py-3 bg-slate-950/40 border border-white/5 rounded-xl shadow-sm">
            <code class="text-cyan-400 font-mono text-xs font-black bg-slate-950 px-1.5 py-0.5 rounded border border-white/10 shrink-0 w-12 text-center">{{ opt }}</code>
            <div class="flex-1 min-w-0">
              <div class="text-slate-300 font-bold text-xs">{{ desc }}</div>
              <div class="mt-1.5"><span class="text-2xs text-slate-500 font-mono font-medium">代碼範例:</span> <code class="ml-1 text-xs text-slate-400 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-white/5">{{ ex }}</code></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 帳密腳本說明 -->
      <section class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 shadow-sm">
        <h2 class="text-xs font-black uppercase tracking-wider text-amber-400 mb-2 flex items-center gap-2">
          <span>⚡</span>
          臨床醫師帳密自動輸入腳本 (pass.ahk) 機制
        </h2>
        <p class="text-slate-400 leading-relaxed font-medium mb-3.5">
          當點擊「產生帳密腳本」後，MedBase 會自動讀取並格式化通訊錄中所有登載的醫師帳密，輸出一份 <code class="text-amber-300 bg-slate-950 px-1.5 py-0.5 border border-amber-500/20 rounded font-mono font-bold">pass.ahk</code>。
          每位醫師的登入資訊會被自動綁定一個熱字串縮寫，在醫療資訊系統 (HIS) 或院內電話系統登入畫面中輸入前綴縮寫，系統會自動輸入 <strong class="text-white font-mono">帳號 + Tab鍵 + 密碼</strong>。
        </p>
        <div class="bg-slate-950/80 rounded-xl border border-white/5 overflow-hidden mb-3.5 shadow-inner">
          <div class="px-4 py-2 bg-slate-950 border-b border-white/5 text-3xs font-black uppercase tracking-widest font-mono text-slate-500">縮寫對應表結構範例</div>
          <table class="w-full text-xs font-mono">
            <thead>
              <tr class="border-b border-white/5 text-slate-500 font-bold font-mono">
                <th class="px-4 py-2 text-left font-bold">鍵入縮寫碼</th>
                <th class="px-4 py-2 text-left font-bold">自動展開的動作流</th>
                <th class="px-4 py-2 text-left font-bold">類別區分</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-white/[0.03]">
                <td class="px-4 py-2 text-amber-300 font-bold">.19108</td>
                <td class="px-4 py-2 text-slate-300 font-bold">19108 <span class="text-slate-600 bg-slate-900 border border-white/5 px-1 py-0.5 rounded text-2xs mx-1">Tab鍵</span> 密碼內容</td>
                <td class="px-4 py-2 text-slate-500 font-bold">HIS 系統登入</td>
              </tr>
              <tr>
                <td class="px-4 py-2 text-amber-300 font-bold">.p19108</td>
                <td class="px-4 py-2 text-slate-300 font-bold">19108phs <span class="text-slate-600 bg-slate-900 border border-white/5 px-1 py-0.5 rounded text-2xs mx-1">Tab鍵</span> 密碼內容</td>
                <td class="px-4 py-2 text-slate-500 font-bold">PHS 系統登入</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul class="space-y-2 text-slate-400 font-medium">
          <li class="flex gap-2.5"><span class="text-amber-400 shrink-0">•</span>使用點號前綴 <code class="text-amber-300 bg-slate-900 px-1 rounded font-mono font-bold">.</code> 作為啟動代碼，以防在一般的書寫過程中誤觸發自動輸入。</li>
          <li class="flex gap-2.5"><span class="text-amber-400 shrink-0">•</span>代碼宣告內建 <code class="text-amber-300 bg-slate-900 px-1 rounded font-mono font-bold">:*:</code> 參數，打完編號最後一位數字後即刻觸發展開，毋須多按 Space。</li>
          <li class="flex gap-2.5"><span class="text-amber-400 shrink-0">•</span><strong class="text-amber-300 font-bold">資訊安全提示：</strong>此生成的 AHK 腳本中包含明文密碼，請確保您的個人電腦存取安全，切勿將 pass.ahk 外流。</li>
        </ul>
      </section>

    </div>

    <!-- Builder Modal -->
    <Teleport to="body">
      <div v-if="showBuilder" class="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm" @click.self="showBuilder = false">
        <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-[880px] max-h-[88vh] flex flex-col overflow-hidden text-slate-100">

          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-slate-950/30 flex-shrink-0">
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-slate-200">🧩 積木編輯器</h3>
            <button @click="showBuilder = false" class="text-slate-500 hover:text-white text-xl leading-none transition-colors cursor-pointer shrink-0">&times;</button>
          </div>

          <!-- Body -->
          <div class="flex flex-1 overflow-hidden">

            <!-- Left: block list -->
            <div class="w-72 border-r border-white/5 flex flex-col overflow-hidden flex-shrink-0 bg-zinc-950/20">
              <div class="px-4 py-2.5 text-2xs text-slate-500 font-black font-mono border-b border-white/5 flex-shrink-0 uppercase tracking-widest">
                已編排區塊：{{ builderBlocks.length }} 個
              </div>
              <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <div v-if="!builderBlocks.length" class="text-center text-slate-500 text-xs py-16 px-4 italic font-bold">
                  尚無區塊內容，請於右側表單編輯後點擊「加入清單」
                </div>
                <div
                  v-for="(b, i) in builderBlocks"
                  :key="b.id"
                  class="border-b border-white/[0.02] px-4 py-3 flex items-start gap-2 group cursor-pointer transition-colors"
                  :class="editingBlockIdx === i ? 'bg-slate-900/40' : 'hover:bg-slate-900/10'"
                  @click="editBuilderBlock(i)"
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span class="text-3xs px-1.5 py-0.5 rounded-full font-black font-mono uppercase"
                        :class="b.type === 'hotstring' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'">
                        {{ b.type === 'hotstring' ? '熱字串' : '快捷鍵' }}
                      </span>
                      <span v-if="b.comment" class="text-2xs text-slate-500 truncate font-bold">{{ b.comment }}</span>
                    </div>
                    <div class="text-2xs font-mono text-slate-400 truncate leading-relaxed">
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
                    class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition-opacity px-1 text-sm cursor-pointer shrink-0 mt-0.5"
                  >✕</button>
                </div>
              </div>
              <div class="p-3.5 border-t border-white/5 bg-slate-950/20 flex-shrink-0">
                <button
                  @click="insertBuilderToScript"
                  :disabled="!builderBlocks.length"
                  class="w-full py-2.5 text-xs rounded-xl transition-all cursor-pointer font-black border"
                  :class="builderBlocks.length
                    ? 'bg-indigo-600 border-indigo-500/30 hover:bg-indigo-500 text-white'
                    : 'bg-slate-950 border-white/5 text-slate-600 cursor-not-allowed'"
                >
                  確認插入到腳本源碼（{{ builderBlocks.length }}）
                </button>
              </div>
            </div>

            <!-- Right: form -->
            <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-4 bg-slate-950/10 custom-scrollbar">

              <!-- Type selector -->
              <div class="flex gap-2 flex-shrink-0">
                <button
                  v-for="[t, label] in [['hotstring','🔤 熱字串文字展開'],['hotkey','⌨ 快捷鍵自訂動作']]"
                  :key="t"
                  @click="setBuilderType(t)"
                  class="px-4 py-2 text-xs rounded-xl transition-all border font-bold cursor-pointer"
                  :class="builderForm.type === t
                    ? 'bg-slate-800 border-white/10 text-white'
                    : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/40'"
                >{{ label }}</button>
              </div>

              <!-- ── Hotstring form ── -->
              <template v-if="builderForm.type === 'hotstring'">

                <!-- Trigger + options -->
                <div class="flex gap-4 items-end flex-shrink-0">
                  <div class="w-48">
                    <label class="block text-2xs font-black text-slate-500 uppercase tracking-wider font-mono mb-1.5">觸發縮寫文字 <span class="text-rose-400">*</span></label>
                    <input
                      v-model="builderForm.trigger"
                      placeholder="如 npo、sig1"
                      class="w-full text-xs px-3.5 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-indigo-500/50 font-mono font-bold"
                    />
                  </div>
                  <div class="flex items-center gap-4 pb-2.5">
                    <label class="flex items-center gap-2 cursor-pointer text-xs text-slate-400 select-none">
                      <input type="checkbox" v-model="builderForm.optInstant" class="w-4 h-4 rounded accent-indigo-500" />
                      即時展開 <code class="text-indigo-400 font-mono text-2xs font-bold">*</code>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer text-xs text-slate-400 select-none">
                      <input type="checkbox" v-model="builderForm.optInWord" class="w-4 h-4 rounded accent-indigo-500" />
                      字中展開 <code class="text-indigo-400 font-mono text-2xs font-bold">?</code>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer text-xs text-slate-400 select-none">
                      <input type="checkbox" v-model="builderForm.optCase" class="w-4 h-4 rounded accent-indigo-500" />
                      區分大小寫 <code class="text-indigo-400 font-mono text-2xs font-bold">C</code>
                    </label>
                  </div>
                </div>

                <!-- Mode tabs -->
                <div class="flex gap-1.5 flex-shrink-0">
                  <button
                    @click="builderForm.hsMode = 'inline'"
                    class="px-3.5 py-1.5 text-2xs rounded-xl transition-all border font-bold cursor-pointer"
                    :class="builderForm.hsMode === 'inline' ? 'bg-slate-800 border-white/10 text-white' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/45'"
                    title="直接展開為純文字，觸發後替換"
                  >單行文字展開</button>
                  <button
                    @click="builderForm.hsMode = 'multitext'"
                    class="px-3.5 py-1.5 text-2xs rounded-xl transition-all border font-bold cursor-pointer"
                    :class="builderForm.hsMode === 'multitext' ? 'bg-slate-800 border-white/10 text-white' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/45'"
                    title="多行文字，自動產生 SendText + Enter"
                  >多行文字展開</button>
                  <button
                    @click="builderForm.hsMode = 'rawcode'"
                    class="px-3.5 py-1.5 text-2xs rounded-xl transition-all border font-bold cursor-pointer"
                    :class="builderForm.hsMode === 'rawcode' ? 'bg-slate-800 border-white/10 text-white' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/45'"
                    title="自行輸入原始 AHK 指令，包在 { } 內"
                  >自訂 AHK 指令碼</button>
                </div>

                <!-- Content -->
                <div class="flex-shrink-0">
                  <label class="block text-2xs font-black text-slate-500 uppercase tracking-wider font-mono mb-1.5">
                    <template v-if="builderForm.hsMode === 'inline'">展開文字內容（單行）</template>
                    <template v-else-if="builderForm.hsMode === 'multitext'">多行文字內容（換行自動產生換行鍵，而 <code class="text-indigo-400 font-mono">\t</code> 代表 Tab 鍵）</template>
                    <template v-else>AHK 自訂指令碼（免寫大括弧，系統會自動在輸出包覆 { }）</template>
                  </label>
                  <input
                    v-if="builderForm.hsMode === 'inline'"
                    v-model="builderForm.expansion"
                    placeholder="如：Normal Saline 0.9% 500mL IV drip st."
                    class="w-full text-xs px-3.5 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500/50 font-bold"
                  />
                  <textarea
                    v-else
                    v-model="builderForm.expansion"
                    :placeholder="hsExpansionPlaceholder"
                    rows="4"
                    class="w-full text-xs px-3.5 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500/50 font-mono resize-none leading-relaxed custom-scrollbar"
                  />
                </div>
              </template>

              <!-- ── Hotkey form ── -->
              <template v-else>

                <!-- Modifiers + key -->
                <div class="flex items-end gap-4 flex-shrink-0 flex-wrap sm:flex-nowrap">
                  <div class="flex-1 min-w-0">
                    <label class="block text-2xs font-black text-slate-500 uppercase tracking-wider font-mono mb-1.5">修飾組合鍵（可多選）</label>
                    <div class="flex gap-2">
                      <label class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/5 bg-slate-950 text-slate-500 hover:border-white/10 transition-colors text-xs select-none cursor-pointer font-bold"
                        :class="builderForm.modCtrl ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300' : ''">
                        <input type="checkbox" v-model="builderForm.modCtrl" class="hidden" />
                        <code class="font-mono text-2xs font-black">^</code> Ctrl
                      </label>
                      <label class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/5 bg-slate-950 text-slate-500 hover:border-white/10 transition-colors text-xs select-none cursor-pointer font-bold"
                        :class="builderForm.modShift ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300' : ''">
                        <input type="checkbox" v-model="builderForm.modShift" class="hidden" />
                        <code class="font-mono text-2xs font-black">+</code> Shift
                      </label>
                      <label class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/5 bg-slate-950 text-slate-500 hover:border-white/10 transition-colors text-xs select-none cursor-pointer font-bold"
                        :class="builderForm.modAlt ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300' : ''">
                        <input type="checkbox" v-model="builderForm.modAlt" class="hidden" />
                        <code class="font-mono text-2xs font-black">!</code> Alt
                      </label>
                      <label class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/5 bg-slate-950 text-slate-500 hover:border-white/10 transition-colors text-xs select-none cursor-pointer font-bold"
                        :class="builderForm.modWin ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300' : ''">
                        <input type="checkbox" v-model="builderForm.modWin" class="hidden" />
                        <code class="font-mono text-2xs font-black">#</code> Win
                      </label>
                    </div>
                  </div>
                  <div class="w-40 shrink-0">
                    <label class="block text-2xs font-black text-slate-500 uppercase tracking-wider font-mono mb-1.5">主要觸發按鍵 <span class="text-rose-400">*</span></label>
                    <input
                      v-model="builderForm.key"
                      placeholder="如 F1, a, Space"
                      class="w-full text-xs px-3.5 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-indigo-500/50 font-mono font-bold"
                    />
                  </div>
                </div>

                <!-- Mode toggle -->
                <div class="flex gap-1.5 flex-shrink-0">
                  <button
                    @click="builderForm.hkMode = 'single'"
                    class="px-3.5 py-1.5 text-2xs rounded-xl transition-all border font-bold cursor-pointer"
                    :class="builderForm.hkMode === 'single' ? 'bg-slate-800 border-white/10 text-white' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/45'"
                  >單行動作指令</button>
                  <button
                    @click="builderForm.hkMode = 'multi'"
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

    <!-- AHK Diff Modal -->
    <Teleport to="body">
      <div v-if="diffModalOpen"
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
        @click.self="diffModalOpen = false">
        <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style="width: 940px; max-width: 96vw; max-height: 88vh">

          <!-- Header -->
          <div class="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-slate-950/40 shrink-0">
            <span class="text-amber-400 text-sm">⚡</span>
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-amber-400">雲端 AHK 版本較新</h3>
            <span class="text-2xs text-slate-500 font-medium">以下腳本雲端版本較本地新，請確認是否套用</span>
            <label class="ml-auto flex items-center gap-1.5 text-2xs text-slate-400 cursor-pointer select-none">
              <input type="checkbox"
                :checked="diffItems.every(i => i.selected)"
                :indeterminate="diffItems.some(i => i.selected) && !diffItems.every(i => i.selected)"
                @change="(e) => diffItems.forEach(i => i.selected = (e.target as HTMLInputElement).checked)"
                class="cursor-pointer" />
              全選
            </label>
            <button @click="diffModalOpen = false" class="ml-3 text-slate-500 hover:text-white text-xl leading-none cursor-pointer transition-colors">×</button>
          </div>

          <!-- Script list -->
          <div class="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
            <div v-for="item in diffItems" :key="item.id" class="p-5">
              <!-- Script header -->
              <div class="flex items-center gap-3 mb-3">
                <input type="checkbox" v-model="item.selected" class="cursor-pointer shrink-0" />
                <span class="text-xs font-bold text-slate-200">{{ item.name }}</span>
                <span class="text-2xs text-slate-500 font-mono truncate">{{ item.targetPath }}</span>
                <span v-if="!item.localContent"
                  class="shrink-0 text-3xs font-bold px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
                  新檔案
                </span>
              </div>
              <!-- Content diff -->
              <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1">
                  <p class="text-2xs font-black text-slate-500 uppercase tracking-wider font-mono">本地版本</p>
                  <pre class="text-2xs text-slate-400 bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2.5
                               max-h-52 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap custom-scrollbar">{{
                    item.localContent || '（檔案不存在）'
                  }}</pre>
                </div>
                <div class="flex flex-col gap-1">
                  <p class="text-2xs font-black text-emerald-500 uppercase tracking-wider font-mono">雲端版本</p>
                  <pre class="text-2xs text-slate-200 bg-emerald-950/20 border border-emerald-500/20 rounded-xl px-3 py-2.5
                               max-h-52 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap custom-scrollbar">{{
                    item.cloudContent
                  }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-white/5 bg-slate-950/20 shrink-0 flex items-center justify-between">
            <span class="text-2xs text-slate-500 font-mono">
              已選 {{ diffItems.filter(i => i.selected).length }} / {{ diffItems.length }} 個腳本
            </span>
            <div class="flex gap-3">
              <button @click="diffModalOpen = false"
                class="text-xs px-4 py-2 rounded-xl border border-white/10 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors">
                全部略過
              </button>
              <button @click="applySelectedDiffs"
                :disabled="diffItems.filter(i => i.selected).length === 0"
                class="text-xs px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold cursor-pointer transition-colors">
                套用選取 ({{ diffItems.filter(i => i.selected).length }})
              </button>
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
