<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { autoUpdatePassAhk } from "@/composables/usePassAhk";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { exportToXlsx, autoCloudSync, xlsxPath } from "@/composables/useXlsxSync";
import { markLocalModified, saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { useLogger } from "@/composables/useLogger";

interface Physician { id: number; name: string; department: string; title: string; ext: string; his_account: string; his_password: string; phs_account: string; phs_password: string; notes: string; }

const router = useRouter();
const physicians = ref<Physician[]>([]);
const search = ref("");
const deptFilter  = ref("");
const titleFilter = ref("");
const selected = ref<Physician | null>(null);
const toast = ref("");
const syncing = ref(false);
const deleteTarget = ref<Physician | null>(null);
const showAddModal = ref(false);
const editTarget = ref<Physician | null>(null);
const form = ref<Partial<Physician>>({});
const cloud = useCloudSettings();
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const departments = computed(() => {
  const seen = new Set<string>();
  physicians.value.forEach(p => { if (p.department) seen.add(p.department); });
  return Array.from(seen).sort();
});

const titles = computed(() => {
  const seen = new Set<string>();
  physicians.value.forEach(p => { if (p.title) seen.add(p.title); });
  return Array.from(seen).sort();
});

onMounted(async () => {
  await cloud.load();
  await load();
});

async function load() {
  const db = await getDb();
  physicians.value = await db.select<Physician[]>("SELECT * FROM physicians ORDER BY department, name");
}

const filtered = () => physicians.value.filter((p) => {
  const dept = p.department ?? "";
  if (deptFilter.value  && dept          !== deptFilter.value)  return false;
  if (titleFilter.value && (p.title ?? "") !== titleFilter.value) return false;
  if (!search.value) return true;
  return p.name.includes(search.value) || dept.includes(search.value);
});

function copy(text: string) {
  navigator.clipboard.writeText(text);
  showToast(`已複製：${text}`);
}

// 合併推送：先拉雲端，本地有雲端無的才上傳（以雲端為主，key = his_account 或 name）
async function pushToCloud() {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS Web App URL"); return; }
  syncing.value = true; setGlobalSyncing("physicians", true);
  try {
    // 1. 拉雲端現有資料
    const pullRes = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getPhysicians" }),
    });
    const pullJson = await pullRes.json();
    if (!pullJson.ok) throw new Error(pullJson.error ?? "拉取雲端失敗");
    const cloudData: Omit<Physician, "id">[] = pullJson.data ?? [];

    // 2. 建立雲端 key set（his_account 非空 → 用帳號比對；否則用姓名）
    const cloudAccounts = new Set(cloudData.map(r => r.his_account).filter(Boolean));
    const cloudNames    = new Set(cloudData.map(r => r.name).filter(Boolean));

    // 3. 找出「本地有、雲端無」的新筆數
    const newLocal = physicians.value.filter(p => {
      if (p.his_account && cloudAccounts.has(p.his_account)) return false;
      if (cloudNames.has(p.name)) return false;
      return true;
    });

    if (newLocal.length === 0) {
      showToast("無新資料需上傳（雲端已有所有本地筆數）");
      return;
    }

    // 4. 合併：雲端資料 + 本地新增，送回雲端（savePhysicians 會全量覆寫）
    const merged = [...cloudData, ...newLocal];
    const pushRes = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "savePhysicians", data: merged }),
    });
    const pushJson = await pushRes.json();
    if (!pushJson.ok) throw new Error(pushJson.error);
    showToast(`已上傳 ${newLocal.length} 筆新資料（跳過 ${physicians.value.length - newLocal.length} 筆重複）`);
    await saveSyncTimestamp("physicians");
    useLogger().addLog("info", `[雲端同步] push 醫師 — ${newLocal.length} 筆`, JSON.stringify({ table: "physicians", action: "push", timestamp: new Date().toISOString() }));
  } catch (err) {
    showToast(`推送失敗：${(err as Error).message}`);
    useLogger().addLog("warn", "[雲端同步] push 醫師 失敗", String(err));
  } finally {
    syncing.value = false; setGlobalSyncing("physicians", false);
  }
}

// 強制覆蓋雲端：以本地為主，完整替換雲端
async function overwriteCloud() {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS Web App URL"); return; }
  syncing.value = true; setGlobalSyncing("physicians", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "savePhysicians", data: physicians.value }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    showToast(`已覆蓋雲端（共 ${physicians.value.length} 筆）`);
    await saveSyncTimestamp("physicians");
    useLogger().addLog("info", `[雲端同步] overwrite 醫師 — ${physicians.value.length} 筆`, JSON.stringify({ table: "physicians", action: "push", timestamp: new Date().toISOString() }));
  } catch (err) {
    showToast(`覆蓋失敗：${(err as Error).message}`);
    useLogger().addLog("warn", "[雲端同步] overwrite 醫師 失敗", String(err));
  } finally {
    syncing.value = false; setGlobalSyncing("physicians", false);
  }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS Web App URL"); return; }
  syncing.value = true; setGlobalSyncing("physicians", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getPhysicians" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    let rows: Omit<Physician, "id">[] = json.data;
    if (!rows.length) { showToast("雲端無資料"); return; }

    const db = await getDb();
    let inserted = 0, updated = 0;
    for (const r of rows) {
      const existing = await db.select<{ id: number }[]>(
        "SELECT id FROM physicians WHERE name = ?", [r.name]
      );
      if (existing.length) {
        await db.execute(
          `UPDATE physicians SET department=?, title=?, ext=?, his_account=?, his_password=?, phs_account=?, phs_password=?, notes=? WHERE id=?`,
          [r.department, r.title, r.ext ?? null, r.his_account, r.his_password, r.phs_account, r.phs_password, r.notes, existing[0].id]
        );
        updated++;
      } else {
        await db.execute(
          `INSERT INTO physicians (name, department, title, ext, his_account, his_password, phs_account, phs_password, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
          [r.name, r.department, r.title, r.ext ?? null, r.his_account, r.his_password, r.phs_account, r.phs_password, r.notes]
        );
        inserted++;
      }
    }
    await load();
    showToast(`拉取完成：新增 ${inserted} 筆，更新 ${updated} 筆`);
  } catch (err) {
    showToast(`拉取失敗：${(err as Error).message}`);
  } finally {
    syncing.value = false; setGlobalSyncing("physicians", false);
  }
}

function onTagsWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement;
  el.scrollLeft += e.deltaY;
}

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

async function doDelete() {
  if (!deleteTarget.value) return;
  const db = await getDb();
  // 先解除套組對此醫師的 FK 參照，避免 FOREIGN KEY constraint failed (code 787)
  await db.execute("UPDATE sets SET physician_id = NULL WHERE physician_id = ?", [deleteTarget.value.id]);
  await db.execute("DELETE FROM physicians WHERE id=?", [deleteTarget.value.id]);
  if (selected.value?.id === deleteTarget.value.id) selected.value = null;
  deleteTarget.value = null;
  await load();
  showToast("已刪除");
  const syncMsg = await autoUpdatePassAhk();
  if (syncMsg) showToast(syncMsg);
  if (xlsxPath.value) { exportToXlsx(); autoCloudSync(); }
}

function openAdd() {
  editTarget.value = null;
  form.value = { name: "", department: "", title: "主治醫師", ext: "", his_account: "", his_password: "", phs_account: "", phs_password: "", notes: "" };
  showAddModal.value = true;
}

function openEdit(p: Physician) {
  router.push({ path: "/data", query: { tab: "physicians", editId: p.id.toString() } });
}

async function saveForm() {
  if (!form.value.name?.trim()) return;
  const db = await getDb();
  if (editTarget.value) {
    await db.execute(
      "UPDATE physicians SET name=?,department=?,title=?,ext=?,his_account=?,his_password=?,phs_account=?,phs_password=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?",
      [form.value.name, form.value.department||null, form.value.title||null, form.value.ext||null,
       form.value.his_account||null, form.value.his_password||null, form.value.phs_account||null,
       form.value.phs_password||null, form.value.notes||null, editTarget.value.id]
    );
  } else {
    await db.execute(
      "INSERT INTO physicians (name,department,title,ext,his_account,his_password,phs_account,phs_password,notes,updated_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
      [form.value.name, form.value.department||null, form.value.title||null, form.value.ext||null,
       form.value.his_account||null, form.value.his_password||null, form.value.phs_account||null,
       form.value.phs_password||null, form.value.notes||null]
    );
  }
  const isEdit = !!editTarget.value;
  const editedId = editTarget.value?.id;
  showAddModal.value = false;
  await load();
  if (editedId) selected.value = physicians.value.find(p => p.id === editedId) ?? selected.value;
  showToast(isEdit ? "已更新" : "已新增");
  const syncMsg = await autoUpdatePassAhk();
  if (syncMsg) showToast(syncMsg);
  if (xlsxPath.value) { exportToXlsx(); autoCloudSync(); }
  await markLocalModified("physicians");
  overwriteCloud().catch(() => {});
}
</script>

<template>
  <div class="flex flex-col h-full gap-3">

    <!-- Top bar: two rows -->
    <div class="shrink-0 flex flex-col gap-2 bg-slate-900/60 backdrop-blur-xl rounded-2xl border border-white/5 px-4 py-3">
      <!-- Row 1: search + cloud sync + add -->
      <div class="flex items-center gap-3">
        <div class="relative w-52 shrink-0">
          <span class="absolute left-3 top-2.5 text-slate-500 text-sm">🔍</span>
          <input v-model="search" placeholder="搜尋姓名 / 科別…"
            class="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm placeholder-slate-600 outline-none focus:border-cyan-500/50 transition-all" />
          <button v-if="search" @click="search = ''" class="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 text-lg leading-none cursor-pointer">×</button>
        </div>
        <div class="flex-1" />
        <button @click="pullFromCloud" :disabled="syncing"
          class="px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-bold hover:bg-indigo-500/20 disabled:opacity-50 transition-colors cursor-pointer"
          title="從雲端拉取">
          {{ syncing ? '…' : '↓' }} 拉取
        </button>
        <button @click="pushToCloud" :disabled="syncing"
          class="px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold hover:bg-blue-500/20 disabled:opacity-50 transition-colors cursor-pointer"
          title="本地有、雲端無才上傳">
          {{ syncing ? '…' : '↑' }} 推送
        </button>
        <button @click="overwriteCloud" :disabled="syncing"
          class="px-3 py-1.5 rounded-xl bg-rose-500/5 border border-rose-500/20 text-rose-300 text-xs font-bold hover:bg-rose-500/15 disabled:opacity-50 transition-colors cursor-pointer"
          title="以本地資料完整覆蓋雲端">
          覆蓋
        </button>
        <div class="w-px h-5 bg-white/10" />
        <button @click="openAdd"
          class="px-4 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white text-xs font-bold hover:from-blue-500 hover:to-cyan-500 transition-all shadow-md cursor-pointer">
          ＋ 新增
        </button>
      </div>

      <!-- Row 2: filter tags (horizontal scroll) -->
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar" @wheel.prevent="onTagsWheel">
        <button @click="deptFilter = ''"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="deptFilter === '' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-slate-950 border-white/5 text-slate-500 hover:text-slate-300'">
          全科
        </button>
        <button v-for="dept in departments" :key="dept"
          @click="deptFilter = deptFilter === dept ? '' : dept"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="deptFilter === dept ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-slate-950 border-white/5 text-slate-500 hover:text-slate-300'">
          {{ dept }}
        </button>
        <div class="w-px h-4 bg-white/10 mx-1 shrink-0" />
        <button @click="titleFilter = ''"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="titleFilter === '' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-slate-950 border-white/5 text-slate-500 hover:text-slate-300'">
          所有職稱
        </button>
        <button v-for="title in titles" :key="title"
          @click="titleFilter = titleFilter === title ? '' : title"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="titleFilter === title ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-slate-950 border-white/5 text-slate-500 hover:text-slate-300'">
          {{ title }}
        </button>
      </div>
    </div>

    <!-- Main: name list + detail -->
    <div class="flex flex-1 gap-3 min-h-0">

      <!-- Left: names only -->
      <div class="w-44 shrink-0 flex flex-col bg-slate-900/60 backdrop-blur-xl rounded-2xl border border-white/5 overflow-hidden">
        <div class="px-3 py-2 border-b border-white/5 shrink-0">
          <span class="text-2xs font-mono font-bold text-slate-500">{{ filtered().length }} RECORDS</span>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar">
          <div v-if="filtered().length === 0" class="text-slate-600 text-xs text-center py-10 font-mono">NO DATA</div>
          <div v-for="p in filtered()" :key="p.id"
            @click="selected = p"
            class="group relative flex items-center px-3 py-2.5 cursor-pointer transition-all"
            :class="selected?.id === p.id
              ? 'bg-slate-800/80'
              : 'hover:bg-white/5'">
            <div v-if="selected?.id === p.id" class="absolute left-0 top-0 bottom-0 w-0.5 bg-cyan-500 rounded-r" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold truncate" :class="selected?.id === p.id ? 'text-cyan-300' : 'text-slate-200'">{{ p.name }}</div>
              <div v-if="p.department" class="text-2xs text-slate-500 truncate mt-0.5">{{ p.department }}</div>
            </div>
            <button @click.stop="deleteTarget = p"
              class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 text-sm leading-none cursor-pointer transition-all shrink-0 ml-1">×</button>
          </div>
        </div>
      </div>

      <!-- Right: dossier detail -->
      <div class="flex-1 rounded-2xl bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 overflow-y-auto min-h-0 custom-scrollbar">
        <div v-if="!selected" class="flex flex-col items-center justify-center h-full text-slate-600 text-center space-y-3">
          <span class="text-4xl opacity-20">👨‍⚕️</span>
          <p class="text-sm uppercase tracking-widest font-mono">Select a physician card to view detail dossier</p>
        </div>

        <div v-else class="space-y-6">
          <!-- Header -->
          <div class="flex items-start justify-between border-b border-white/5 pb-4">
            <div>
              <h2 class="text-2xl font-black text-slate-100 tracking-wide">{{ selected.name }}</h2>
              <p class="text-sm font-semibold text-slate-500 mt-1 uppercase tracking-wider">{{ selected.department }} · {{ selected.title }}</p>
            </div>
            <div class="flex gap-2 shrink-0">
              <button @click="openEdit(selected)"
                class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 text-slate-300 text-sm font-bold transition-all cursor-pointer">
                編輯
              </button>
              <button @click="deleteTarget = selected"
                class="px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm font-bold hover:bg-rose-500/20 transition-all cursor-pointer">
                刪除
              </button>
            </div>
          </div>

          <!-- Extension -->
          <div v-if="selected.ext" class="p-4 rounded-2xl bg-slate-900/40 border border-white/5 flex items-center justify-between shadow-lg group hover:border-cyan-500/20 transition-all">
            <div class="flex items-center gap-4">
              <span class="text-lg">📞</span>
              <div>
                <p class="text-xs font-bold text-slate-500 uppercase tracking-widest">院內聯絡分機</p>
                <p class="text-3xl font-mono font-black text-cyan-400 mt-1 tracking-widest">{{ selected.ext }}</p>
              </div>
            </div>
            <button @click="copy(selected.ext)" class="text-xs font-bold px-3 py-1.5 bg-slate-800 border border-white/5 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/20 rounded-xl transition-all cursor-pointer">
              複製分機
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- HIS -->
            <div class="rounded-2xl border border-white/5 bg-slate-900/30 p-5 space-y-4">
              <div class="border-b border-white/5 pb-2.5 flex justify-between items-center">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-widest">HIS 系統登入資料</span>
                <span class="text-2xs font-mono text-slate-600">HIS CREDENTIALS</span>
              </div>
              <div class="space-y-3 font-mono text-sm">
                <div class="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-white/[0.02]">
                  <span class="text-slate-500 w-12">帳號</span>
                  <span class="text-slate-200 font-bold flex-1 select-all truncate ml-2">{{ selected.his_account || '—' }}</span>
                  <button v-if="selected.his_account" @click="copy(selected.his_account)" class="text-slate-600 hover:text-cyan-400 text-xs pl-2 cursor-pointer">📋</button>
                </div>
                <div class="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-white/[0.02]">
                  <span class="text-slate-500 w-12">密碼</span>
                  <span class="text-slate-200 font-bold flex-1 select-all truncate ml-2">{{ selected.his_password || '—' }}</span>
                  <button v-if="selected.his_password" @click="copy(selected.his_password)" class="text-slate-600 hover:text-cyan-400 text-xs pl-2 cursor-pointer">📋</button>
                </div>
              </div>
            </div>

            <!-- PHS -->
            <div class="rounded-2xl border border-white/5 bg-slate-900/30 p-5 space-y-4">
              <div class="border-b border-white/5 pb-2.5 flex justify-between items-center">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-widest">PHS 系統登入資料</span>
                <span class="text-2xs font-mono text-slate-600">PHS CREDENTIALS</span>
              </div>
              <div class="space-y-3 font-mono text-sm">
                <div class="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-white/[0.02]">
                  <span class="text-slate-500 w-12">帳號</span>
                  <span class="text-slate-200 font-bold flex-1 select-all truncate ml-2">{{ selected.phs_account || '—' }}</span>
                  <button v-if="selected.phs_account" @click="copy(selected.phs_account)" class="text-slate-600 hover:text-cyan-400 text-xs pl-2 cursor-pointer">📋</button>
                </div>
                <div class="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-white/[0.02]">
                  <span class="text-slate-500 w-12">密碼</span>
                  <span class="text-slate-200 font-bold flex-1 select-all truncate ml-2">{{ selected.phs_password || '—' }}</span>
                  <button v-if="selected.phs_password" @click="copy(selected.phs_password)" class="text-slate-600 hover:text-cyan-400 text-xs pl-2 cursor-pointer">📋</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Notes -->
          <div v-if="selected.notes" class="p-5 rounded-2xl bg-slate-900/30 border border-white/5">
            <p class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">備註說明 / 排班偏好</p>
            <p class="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">{{ selected.notes }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete confirm modal -->
  <Teleport to="body">
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="deleteTarget = null">
      <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-80 p-6 space-y-4 text-center">
        <p class="text-slate-200 text-sm font-semibold mb-1">確定要刪除此醫師檔案？</p>
        <p class="text-xs text-rose-400 font-bold font-mono">「{{ deleteTarget.name }}」</p>
        <div class="flex gap-2.5 justify-center pt-3 border-t border-white/5">
          <button @click="deleteTarget = null" class="px-4 py-2 text-xs font-bold bg-slate-800 border border-white/5 text-slate-400 rounded-xl hover:bg-slate-700">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-xs font-bold bg-rose-600 text-white rounded-xl hover:bg-rose-500 shadow-lg">確認刪除</button>
        </div>
      </div>
    </div>

    <!-- Add / Edit modal -->
    <div v-if="showAddModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="showAddModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-[440px] max-w-[95vw] p-6 space-y-4 overflow-y-auto max-h-[90vh]">
        <h2 class="text-slate-100 font-black text-sm uppercase tracking-wider border-b border-white/5 pb-2">
          {{ editTarget ? '⚙️ 編輯醫師基本檔案' : '✨ 新增醫師基本檔案' }}
        </h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="col-span-2">
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">醫師姓名 *</label>
            <input v-model="form.name" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm focus:outline-none focus:border-cyan-500/50 font-bold" autofocus />
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">專科別</label>
            <input v-model="form.department" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm focus:outline-none focus:border-cyan-500/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">臨床職稱</label>
            <input v-model="form.title" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm focus:outline-none focus:border-cyan-500/50" />
          </div>
          <div class="col-span-2">
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">聯絡分機</label>
            <input v-model="form.ext" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm font-mono focus:outline-none focus:border-cyan-500/50" placeholder="e.g. 5123" />
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">HIS 系統帳號</label>
            <input v-model="form.his_account" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm font-mono focus:outline-none focus:border-cyan-500/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">HIS 系統密碼</label>
            <input v-model="form.his_password" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm font-mono focus:outline-none focus:border-cyan-500/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">PHS 系統帳號</label>
            <input v-model="form.phs_account" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm font-mono focus:outline-none focus:border-cyan-500/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">PHS 系統密碼</label>
            <input v-model="form.phs_password" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm font-mono focus:outline-none focus:border-cyan-500/50" />
          </div>
          <div class="col-span-2">
            <label class="text-xs font-bold text-slate-500 mb-1 block uppercase tracking-wide">備註說明 / 排班偏好</label>
            <input v-model="form.notes" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm focus:outline-none focus:border-cyan-500/50" />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-2 border-t border-white/5 bg-slate-900">
          <button @click="showAddModal = false" class="px-4 py-2 text-xs font-bold bg-slate-800 border border-white/5 text-slate-400 rounded-xl hover:bg-slate-700 hover:text-slate-200 transition-colors">取消</button>
          <button @click="saveForm" class="px-5 py-2 text-xs font-bold bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl hover:from-blue-500 hover:to-cyan-500 transition-all shadow-lg">儲存並寫入</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4.5 py-2.5 bg-slate-900 border border-white/10 text-slate-200 text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
        ✓ {{ toast }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
