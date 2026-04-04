<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

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
const showSettings = ref(false);
const search = ref("");
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const scriptForm = ref({ name: "", file_path: "", description: "" });
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

onMounted(async () => { await loadAll(); });

async function loadAll() {
  const db = await getDb();
  scripts.value = await db.select<AhkScript[]>("SELECT * FROM ahk_scripts ORDER BY name");
  groups.value  = await db.select<AhkGroup[]>("SELECT * FROM ahk_groups ORDER BY name");
  const row = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key = 'ahk_exe_path'"
  );
  ahkExePath.value = row[0]?.value ?? "";
}

// ── 腳本管理 ─────────────────────────────────────────────

async function selectScript(s: AhkScript) {
  selectedScript.value = s;
  scriptForm.value = { name: s.name, file_path: s.file_path, description: s.description ?? "" };
  try {
    scriptContent.value = await readTextFile(s.file_path);
  } catch {
    scriptContent.value = "";
    showToast("無法讀取檔案，請確認路徑是否正確");
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
    showToast(`建立失敗：${(e as Error).message}`);
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
    showToast(`匯入失敗：${(e as Error).message}`);
  }
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
    showToast(`儲存失敗：${(e as Error).message}`);
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
    showToast(`Reload 失敗：${(e as Error).message}`);
  }
}

async function deleteScript() {
  if (!selectedScript.value) return;
  if (!confirm(`確定移除「${selectedScript.value.name}」的紀錄？\n磁碟上的 .ahk 檔案不會被刪除。`)) return;
  const db = await getDb();
  await db.execute("DELETE FROM ahk_scripts WHERE id = ?", [selectedScript.value.id]);
  selectedScript.value = null;
  scriptContent.value = "";
  scriptForm.value = { name: "", file_path: "", description: "" };
  await loadAll();
  showToast("已移除");
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

// ── 從醫師通訊錄產生 pass.ahk ────────────────────────────

async function generatePassAhk() {
  const db = await getDb();
  const physicians = await db.select<{
    name: string;
    his_account: string | null;
    his_password: string | null;
    phs_account: string | null;
    phs_password: string | null;
  }[]>(
    `SELECT name, his_account, his_password, phs_account, phs_password
     FROM physicians
     WHERE (his_account IS NOT NULL AND his_account != '')
        OR (phs_account IS NOT NULL AND phs_account != '')
     ORDER BY name`
  );

  if (physicians.length === 0) {
    showToast("醫師通訊錄中無帳號資料");
    return;
  }

  const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  const his = physicians.filter((p) => p.his_account);
  const phs = physicians.filter((p) => p.phs_account);

  let lines: string[] = [
    "#Requires AutoHotkey v2",
    "#SingleInstance Force",
    "",
    "; ═══════════════════════════════════════════════════════",
    ";  pass.ahk — MedBase 自動產生的帳密熱字串",
    `;  產生時間：${now}`,
    ";  觸發格式：輸入 .<帳號> 自動展開為 帳號 {Tab} 密碼",
    ";  PHS 帳號前加 p，例如 .p帳號",
    "; ═══════════════════════════════════════════════════════",
    "",
  ];

  if (his.length > 0) {
    lines.push("; ── HIS 帳密 " + "─".repeat(42));
    for (const p of his) {
      lines.push(`; ${p.name}`);
      lines.push(`:*:.${p.his_account}::`);
      lines.push(`{`);
      lines.push(`    SendText "${p.his_account}"`);
      lines.push(`    Send "{Tab}"`);
      if (p.his_password) lines.push(`    SendText "${p.his_password}"`);
      lines.push(`}`);
      lines.push("");
    }
  }

  if (phs.length > 0) {
    lines.push("; ── PHS 帳密（前綴 p）" + "─".repeat(36));
    for (const p of phs) {
      if (!p.phs_account) continue;
      lines.push(`; ${p.name}`);
      lines.push(`:*:.p${p.phs_account}::`);
      lines.push(`{`);
      lines.push(`    SendText "${p.phs_account}"`);
      lines.push(`    Send "{Tab}"`);
      if (p.phs_password) lines.push(`    SendText "${p.phs_password}"`);
      lines.push(`}`);
      lines.push("");
    }
  }

  const content = lines.join("\n");

  const path = (await saveDialog({
    title: "儲存 pass.ahk",
    defaultPath: "pass.ahk",
    filters: [{ name: "AutoHotkey Script", extensions: ["ahk"] }],
  })) as string | null;
  if (!path) return;

  try {
    await writeTextFile(path, content);

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
        `MedBase 醫師通訊錄 · HIS ${his.length} 筆 · PHS ${phs.length} 筆`,
      ]
    );
    await loadAll();

    const created = scripts.value.find((s) => s.file_path === path);
    if (created) await selectScript(created);

    showToast(`已產生 ${his.length + phs.length} 筆帳密熱字串`);
  } catch (e) {
    showToast(`產生失敗：${(e as Error).message}`);
  }
}

async function pickExePath() {
  const path = (await openDialog({
    title: "選擇 AutoHotkey 執行檔",
    filters: [{ name: "Executable", extensions: ["exe"] }],
  })) as string | null;
  if (path) await saveExePath(path);
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden">

    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
      <div>
        <h1 class="text-lg font-semibold">AHK 腳本管理</h1>
        <p class="text-xs text-gray-500 mt-0.5">AutoHotkey 設定檔 CRUD · 套組管理 · 自動 Reload</p>
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
        <div class="px-3 pb-3">
          <button
            @click="generatePassAhk"
            class="w-full text-xs py-1.5 bg-amber-900/60 hover:bg-amber-900 text-amber-300 hover:text-amber-200 rounded flex items-center justify-center gap-1.5 transition-colors"
            title="從醫師通訊錄的帳密自動產生 AHK 熱字串腳本"
          >
            <span>⚡</span> 產生帳密腳本
          </button>
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
            <div class="text-sm font-medium truncate">{{ s.name }}</div>
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
            <button
              @click="deleteScript"
              class="ml-auto px-4 py-2 bg-red-950/60 hover:bg-red-900/70 text-red-400 hover:text-red-300 text-sm rounded"
            >
              移除紀錄
            </button>
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
          點擊左側「產生帳密腳本」，MedBase 會從醫師通訊錄自動產生一份 <code class="text-amber-300 bg-gray-900 px-1 rounded">pass.ahk</code>，
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
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">•</span>醫師通訊錄有異動時，重新點「產生帳密腳本」並 Reload 即可更新</li>
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
