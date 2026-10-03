<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile, remove } from "@tauri-apps/plugin-fs";
import * as XLSX from "xlsx";
import { getDb } from "@/db";
import {
  listSnapshots, createSnapshot, saveSnapshotAs, restoreSnapshot, exportGroups, importGroups,
  clearGroups, existingLegacyTables, dropLegacyTables, readTextFile, type Snapshot,
} from "@/composables/useBackup";
import {
  BACKUP_GROUPS, SNAPSHOT_LABELS, KEEP_DAILY, KEEP_PRE, parseGroupFile, previewGroupFile, xlsxCell, type GroupFile,
} from "@/utils/backupRegistry";

/** 備份（ADR-023）：完整快照為主，群組 JSON 匯出／匯入為輔 */
const emit = defineEmits<{ toast: [type: "success" | "error", msg: string]; changed: [] }>();
const busy = ref("");
async function run(label: string, fn: () => Promise<unknown>) {
  busy.value = label;
  try { await fn(); } catch (e) { emit("toast", "error", `${label}失敗：${(e as Error).message ?? e}`); }
  finally { busy.value = ""; }
}
const stamp = () => new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const fmt = (d: Date) => d.toLocaleString("zh-TW", { hour12: false });

// ── 快照 ────────────────────────────────────────────────────────
const snapshots = ref<Snapshot[]>([]);
async function reloadSnapshots() { snapshots.value = await listSnapshots().catch(() => []); }

const includePatients = ref(false);
const backupNow = () => run("備份", async () => {
  const s = await createSnapshot("keep", "manual");
  await reloadSnapshots();
  emit("toast", "success", `已備份（${mb(s.size)}）`);
});
async function saveAs(src: Snapshot | null) {
  const dest = await saveDialog({
    defaultPath: `medbase_${stamp()}${includePatients.value ? "" : "_不含病歷潤飾"}.db`,
    filters: [{ name: "MedBase 備份", extensions: ["db"] }],
  });
  if (!dest) return;
  await run("另存", async () => {
    const size = await saveSnapshotAs(src?.path ?? null, dest, includePatients.value);
    emit("toast", "success", `已另存（${mb(size)}${includePatients.value ? "" : "，不含病歷潤飾紀錄"}）`);
  });
}
const removeSnapshot = (s: Snapshot) => run("刪除快照", async () => { await remove(s.path); await reloadSnapshots(); });

// 還原：預設照一般同步；勾選覆蓋雲端要再確認一次
const restoring = ref<{ path: string; label: string } | null>(null);
const overwriteCloud = ref(false);
const overwriteConfirmed = ref(false);
function askRestore(path: string, label: string) {
  restoring.value = { path, label };
  overwriteCloud.value = false;
  overwriteConfirmed.value = false;
}
async function pickRestoreFile() {
  const p = await openDialog({ filters: [{ name: "MedBase 備份", extensions: ["db"] }], multiple: false });
  if (typeof p === "string") askRestore(p, p.split(/[\\/]/).pop() ?? p);
}
const doRestore = () => run("還原", async () => {
  if (!restoring.value) return;
  await restoreSnapshot(restoring.value.path, overwriteCloud.value && overwriteConfirmed.value);
});

// ── 群組 ────────────────────────────────────────────────────────
const counts = ref<Record<string, number>>({});
async function reloadCounts() {
  const db = await getDb();
  const out: Record<string, number> = {};
  for (const t of BACKUP_GROUPS.flatMap(g => g.tables)) {
    out[t] = (await db.select<{ c: number }[]>(`SELECT COUNT(*) AS c FROM "${t}"`).catch(() => [{ c: 0 }]))[0]?.c ?? 0;
  }
  counts.value = out;
}
const groupRows = (key: string) => BACKUP_GROUPS.find(g => g.key === key)!.tables.reduce((s, t) => s + (counts.value[t] ?? 0), 0);
const selected = ref(new Set(BACKUP_GROUPS.filter(g => !g.optIn).map(g => g.key)));
function toggle(key: string) {
  const s = new Set(selected.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  selected.value = s;
}

const exportJson = async () => {
  const dest = await saveDialog({ defaultPath: `medbase_groups_${stamp()}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!dest) return;
  await run("匯出", async () => {
    const f = await exportGroups([...selected.value]);
    await writeTextFile(dest, JSON.stringify(f));
    emit("toast", "success", `已匯出 ${selected.value.size} 個群組`);
  });
};
const exportXlsx = async () => {
  const dest = await saveDialog({ defaultPath: `medbase_檢視用_${stamp()}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] });
  if (!dest) return;
  await run("匯出 Excel", async () => {
    const f = await exportGroups([...selected.value]);
    const wb = XLSX.utils.book_new();
    for (const [t, rows] of Object.entries(f.tables)) {
      if (!rows.length) continue;
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, ...rows.map(r => cols.map(c => xlsxCell(r[c] ?? "")))]), t.slice(0, 31));
    }
    if (!wb.SheetNames.length) throw new Error("選取的群組都沒有資料");
    await writeFile(dest, XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array);
    emit("toast", "success", "已匯出 Excel（僅供檢視，不能匯入）");
  });
};

// 匯入：預覽後每個群組選「不匯入／合併／取代」
const importFile = ref<GroupFile | null>(null);
const importModes = ref<Record<string, "" | "merge" | "replace">>({});
const preview = computed(() => importFile.value ? previewGroupFile(importFile.value) : []);
async function pickImport() {
  const p = await openDialog({ filters: [{ name: "MedBase 群組備份", extensions: ["json"] }], multiple: false });
  if (typeof p !== "string") return;
  await run("讀取備份檔", async () => {
    const f = parseGroupFile(await readTextFile(p));
    importFile.value = f;
    importModes.value = Object.fromEntries(previewGroupFile(f).map(x => [x.group.key, x.group.optIn ? "" : "merge"]));
  });
}
const hasReplace = computed(() => Object.values(importModes.value).includes("replace"));
const doImport = () => run("匯入", async () => {
  const modes = Object.fromEntries(Object.entries(importModes.value).filter(([, m]) => m)) as Record<string, "merge" | "replace">;
  const r = await importGroups(importFile.value!, modes);
  importFile.value = null;
  await Promise.all([reloadCounts(), reloadSnapshots()]);
  emit("changed");
  emit("toast", "success", `匯入完成：${r.rows.toLocaleString()} 筆（已先備份匯入前的資料）${r.ahk ? `｜${r.ahk}` : ""}`);
});

// ── 舊表 ────────────────────────────────────────────────────────
const legacy = ref<{ table: string; rows: number }[]>([]);
const dropLegacy = () => run("清除舊表", async () => {
  await dropLegacyTables(legacy.value.map(x => x.table));
  legacy.value = await existingLegacyTables();
  await reloadSnapshots();
  emit("toast", "success", "已清除舊表並壓縮資料庫（清除前的快照已永久保留）");
});

// ── 清空 ────────────────────────────────────────────────────────
const CLEAR_KEYWORD = "清空資料";
const clearSel = ref(new Set<string>());
const showClear = ref(false);
const clearInput = ref("");
function toggleClear(key: string) {
  const s = new Set(clearSel.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  clearSel.value = s;
}
const doClear = () => run("清空", async () => {
  await clearGroups([...clearSel.value]);
  showClear.value = false;
  clearInput.value = "";
  clearSel.value = new Set();
  await Promise.all([reloadCounts(), reloadSnapshots()]);
  emit("changed");
  emit("toast", "success", "已清空（清空前的資料已自動備份，可從快照還原）");
});

onMounted(async () => {
  await Promise.all([reloadSnapshots(), reloadCounts()]);
  legacy.value = await existingLegacyTables().catch(() => []);
});

const card = "bg-surface rounded-2xl border border-hairline p-6 shadow-xl space-y-4";
const btn = "px-4 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-40 cursor-pointer";
const btnMain = `${btn} bg-accent border-accent/30 text-white hover:bg-accent-hover`;
const btnSub = `${btn} bg-elevated border-hairline text-fg-secondary hover:bg-raised`;
</script>

<template>
  <div class="space-y-6">
    <!-- ① 完整快照 -->
    <div :class="card">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-lg">🗄️</span>
        <h3 class="font-bold text-fg text-sm">完整快照</h3>
        <span class="text-xs text-muted">整個資料庫一次備份；每天第一次開啟自動備份（留 {{ KEEP_DAILY }} 份），還原、匯入、清空前也會自動備份（合計留 {{ KEEP_PRE }} 份）</span>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button :class="btnMain" :disabled="!!busy" @click="backupNow">{{ busy === "備份" ? "備份中…" : "💾 立即備份" }}</button>
        <button :class="btnSub" :disabled="!!busy" @click="saveAs(null)">📤 另存目前資料到…</button>
        <button :class="btnSub" :disabled="!!busy" @click="pickRestoreFile">📂 從檔案還原…</button>
        <label class="flex items-center gap-1.5 text-xs text-fg-secondary cursor-pointer">
          <input v-model="includePatients" type="checkbox" /> 另存時包含病歷潤飾紀錄（含病人資料）
        </label>
      </div>
      <p class="text-xs text-warning">另存的備份含通訊錄的 HIS 帳號密碼，請妥善保管，不要放到雲端硬碟或公用電腦。</p>
      <table class="w-full text-xs">
        <thead class="text-muted text-left">
          <tr><th class="py-1.5 px-2">時間</th><th class="px-2">類型</th><th class="px-2 text-right">大小</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="s in snapshots" :key="s.name" class="border-t border-hairline">
            <td class="py-1.5 px-2 tabular-nums">{{ fmt(s.at) }}</td>
            <td class="px-2">{{ SNAPSHOT_LABELS[s.kind] }}{{ s.note === "legacy" ? "（清除舊表前）" : s.note === "manual" ? "（手動）" : "" }}</td>
            <td class="px-2 text-right tabular-nums text-muted">{{ mb(s.size) }}</td>
            <td class="px-2 text-right whitespace-nowrap space-x-3">
              <button class="text-accent hover:underline" :disabled="!!busy" @click="askRestore(s.path, `${fmt(s.at)} ${SNAPSHOT_LABELS[s.kind]}`)">還原</button>
              <button class="text-fg-secondary hover:underline" :disabled="!!busy" @click="saveAs(s)">另存</button>
              <button class="text-muted hover:text-danger" :disabled="!!busy" @click="removeSnapshot(s)">刪除</button>
            </td>
          </tr>
          <tr v-if="!snapshots.length"><td colspan="4" class="py-4 text-center text-muted">還沒有快照</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ② 群組匯出／匯入 -->
    <div :class="card">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-lg">📦</span>
        <h3 class="font-bold text-fg text-sm">群組匯出／匯入（JSON）</h3>
        <span class="text-xs text-muted">只搬某幾類資料、或合併到另一台電腦時使用</span>
      </div>
      <div class="grid grid-cols-2 gap-2.5">
        <label v-for="g in BACKUP_GROUPS" :key="g.key" class="flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer"
          :class="selected.has(g.key) ? 'border-accent/30 bg-accent/[0.04]' : 'border-hairline bg-sunken'">
          <input type="checkbox" class="mt-0.5" :checked="selected.has(g.key)" @change="toggle(g.key)" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between text-xs font-bold text-fg">
              <span>{{ g.icon }} {{ g.label }}</span>
              <span class="text-muted font-normal tabular-nums">{{ groupRows(g.key).toLocaleString() }} 筆</span>
            </div>
            <div class="text-xs text-muted mt-1">{{ g.desc }}</div>
          </div>
        </label>
      </div>
      <div class="flex flex-wrap gap-3">
        <button :class="btnMain" :disabled="!!busy || !selected.size" @click="exportJson">💾 匯出選取群組（JSON）</button>
        <button :class="btnSub" :disabled="!!busy || !selected.size" @click="exportXlsx">📊 匯出成 Excel（僅供檢視）</button>
        <button :class="btnSub" :disabled="!!busy" @click="pickImport">📥 匯入 JSON…</button>
      </div>

      <div v-if="importFile" class="border-t border-hairline pt-4 space-y-3">
        <p class="text-xs font-bold text-fg">匯入預覽（{{ new Date(importFile.exportedAt).toLocaleString("zh-TW", { hour12: false }) }} 匯出{{ importFile.appVersion ? `，v${importFile.appVersion}` : "" }}）</p>
        <div v-for="p in preview" :key="p.group.key" class="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-sunken border border-hairline text-xs">
          <span class="font-bold text-fg w-48 shrink-0">{{ p.group.icon }} {{ p.group.label }}</span>
          <span class="text-muted flex-1">{{ p.tables.map(t => `${t.table} ${t.rows}`).join("、") }}</span>
          <select v-model="importModes[p.group.key]" class="px-2 py-1 rounded-lg bg-surface border border-hairline">
            <option value="">不匯入</option>
            <option value="merge">合併（保留本機多出來的）</option>
            <option value="replace">取代（清空後寫入）</option>
          </select>
        </div>
        <p v-if="hasReplace" class="text-xs text-warning">「取代」會刪除本機多出來的資料，同步後其他電腦也會刪除。</p>
        <p class="text-xs text-muted">匯入前會自動備份；整批寫入，任何一筆失敗就全部不寫入。</p>
        <div class="flex gap-3">
          <button :class="btnMain" :disabled="!!busy || !Object.values(importModes).some(Boolean)" @click="doImport">{{ busy === "匯入" ? "匯入中…" : "確認匯入" }}</button>
          <button :class="btnSub" :disabled="!!busy" @click="importFile = null">取消</button>
        </div>
      </div>
    </div>

    <!-- ③ 舊表 -->
    <div v-if="legacy.length" :class="card">
      <div class="flex items-center gap-2">
        <span class="text-lg">🧹</span>
        <h3 class="font-bold text-fg text-sm">清除沒有使用的舊資料表</h3>
      </div>
      <p class="text-xs text-fg-secondary">{{ legacy.map(x => `${x.table}（${x.rows.toLocaleString()} 筆）`).join("、") }}：已沒有任何功能使用。清除前會先拍一份<b>永久保留</b>的快照，清除後資料庫會變小、每天的備份也更快。</p>
      <button :class="btnSub" :disabled="!!busy" @click="dropLegacy">{{ busy === "清除舊表" ? "清除中…" : "清除舊表並壓縮資料庫" }}</button>
    </div>

    <!-- ④ 清空 -->
    <div class="bg-danger/[0.04] rounded-2xl border border-danger/20 p-6 shadow-xl space-y-4">
      <div class="flex items-center gap-2">
        <span class="text-lg">⚠️</span>
        <h3 class="font-bold text-danger text-sm">清空資料</h3>
        <span class="text-xs text-muted">清空前會自動備份，可從快照還原</span>
      </div>
      <div class="grid grid-cols-2 gap-2.5">
        <label v-for="g in BACKUP_GROUPS" :key="g.key" class="flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer"
          :class="clearSel.has(g.key) ? 'border-danger/40 bg-danger/[0.04]' : 'border-hairline bg-sunken'">
          <input type="checkbox" :checked="clearSel.has(g.key)" @change="toggleClear(g.key)" />
          <span class="text-xs font-bold text-fg">{{ g.icon }} {{ g.label }}</span>
        </label>
      </div>
      <button class="px-5 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold hover:bg-danger/20 disabled:opacity-40"
        :disabled="!clearSel.size || !!busy" @click="showClear = true">清空選取群組（{{ clearSel.size }}）</button>
    </div>

    <!-- 還原確認 -->
    <Teleport to="body">
      <div v-if="restoring" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/70 backdrop-blur-sm" @click.self="restoring = null">
        <div class="w-full max-w-md bg-surface rounded-2xl border border-warning shadow-2xl p-6 space-y-3 text-sm">
          <h3 class="font-semibold text-fg">還原到：{{ restoring.label }}</h3>
          <p class="text-fg-secondary text-xs">整個資料庫會換成這份備份，App 會自動重新啟動。還原前會先備份目前的資料。</p>
          <p class="text-xs text-muted">之後同步時，雲端比較新的資料會蓋回來（適合換電腦、救災）。</p>
          <label class="flex items-start gap-2 text-xs cursor-pointer">
            <input v-model="overwriteCloud" type="checkbox" class="mt-0.5" />
            <span>以這份備份<b>覆蓋雲端</b>：其他電腦在這份備份之後的修改會遺失（排班文件不受影響）</span>
          </label>
          <label v-if="overwriteCloud" class="flex items-start gap-2 text-xs text-danger cursor-pointer">
            <input v-model="overwriteConfirmed" type="checkbox" class="mt-0.5" />
            <span>我了解全院電腦的套組、品項、通訊錄等資料都會回到這份備份的狀態</span>
          </label>
          <div class="flex gap-3 pt-2">
            <button class="flex-1 px-4 py-2 rounded-lg bg-raised text-fg-secondary" @click="restoring = null">取消</button>
            <button class="flex-1 px-4 py-2 rounded-lg bg-warning text-white font-medium disabled:opacity-40"
              :disabled="!!busy || (overwriteCloud && !overwriteConfirmed)" @click="doRestore">{{ busy === "還原" ? "還原中…" : "確認還原" }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 清空確認 -->
    <Teleport to="body">
      <div v-if="showClear" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/70 backdrop-blur-sm" @click.self="showClear = false; clearInput = ''">
        <div class="w-full max-w-sm bg-surface rounded-2xl border border-danger shadow-2xl p-6 space-y-3 text-center">
          <h3 class="font-semibold text-danger">確認清空</h3>
          <div class="flex flex-wrap gap-1 justify-center">
            <span v-for="g in BACKUP_GROUPS.filter(g => clearSel.has(g.key))" :key="g.key" class="px-2 py-0.5 rounded-full bg-danger/10 text-danger text-xs">{{ g.icon }} {{ g.label }}</span>
          </div>
          <p class="text-xs text-muted">輸入「<span class="text-danger font-mono">{{ CLEAR_KEYWORD }}</span>」以確認</p>
          <input v-model="clearInput" :placeholder="CLEAR_KEYWORD" class="w-full px-3 py-2 rounded-lg bg-elevated border border-hairline text-sm text-center" />
          <div class="flex gap-3">
            <button class="flex-1 px-4 py-2 rounded-lg bg-raised text-fg-secondary text-sm" @click="showClear = false; clearInput = ''">取消</button>
            <button class="flex-1 px-4 py-2 rounded-lg bg-danger text-white text-sm disabled:opacity-40"
              :disabled="clearInput !== CLEAR_KEYWORD || !!busy" @click="doClear">{{ busy === "清空" ? "清空中…" : "確認清空" }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
