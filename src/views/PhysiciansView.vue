<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { upsertPhysician, removePhysician } from "@/composables/usePhysicians";
import { syncTable } from "@/composables/useTableSync";

interface Physician { id: number; name: string; department: string; title: string; ext: string; his_account: string; his_password: string; notes: string; }

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

// 逐筆同步：本地與雲端以姓名對應、updated_at 較新者為準，刪除會傳到其他電腦
async function syncWithCloud(force = false) {
  if (!cloud.gasUrl) { showToast("請先在排班設定填入 GAS Web App URL"); return; }
  syncing.value = true; setGlobalSyncing("physicians", true);
  try {
    const r = await syncTable("physicians", cloud.gasUrl, { force });
    await load();
    const summary = `${force ? "已覆蓋雲端" : "同步完成"}：新增 ${r.inserted}、更新 ${r.updated}、刪除 ${r.deleted}`;
    showToast(r.message ? `${summary}｜${r.message}` : summary);
  } catch (err) {
    showToast(`${force ? "覆蓋" : "同步"}失敗：${(err as Error).message}`);
  } finally {
    syncing.value = false; setGlobalSyncing("physicians", false);
  }
}

// 覆蓋會讓雲端有、本地沒有的人在所有電腦上被刪除，需再按一次確認
const confirmOverwrite = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | null = null;
function onOverwriteClick() {
  if (!confirmOverwrite.value) {
    confirmOverwrite.value = true;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirmOverwrite.value = false; }, 3000);
    return;
  }
  confirmOverwrite.value = false;
  syncWithCloud(true);
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
  const removedId = deleteTarget.value.id;
  const { ahkMessage } = await removePhysician(removedId);
  if (selected.value?.id === removedId) selected.value = null;
  deleteTarget.value = null;
  await load();
  showToast(ahkMessage ?? "已刪除");
}

function openAdd() {
  editTarget.value = null;
  form.value = { name: "", department: "", title: "主治醫師", ext: "", his_account: "", his_password: "", notes: "" };
  showAddModal.value = true;
}

// 就地編輯：過去這裡是 router.push 到 /data 開 modal，而本頁 saveForm 的
// UPDATE 分支因為 editTarget 從未被指派而成為死碼。改為直接開本頁 modal。
function openEdit(p: Physician) {
  editTarget.value = p;
  form.value = { ...p };
  showAddModal.value = true;
}

async function saveForm() {
  if (!form.value.name?.trim()) return;
  const isEdit = !!editTarget.value;
  const { ahkMessage } = await upsertPhysician({
    ...form.value,
    id: editTarget.value?.id,
  });
  const editedId = editTarget.value?.id;
  showAddModal.value = false;
  await load();
  if (editedId) selected.value = physicians.value.find(p => p.id === editedId) ?? selected.value;
  showToast(ahkMessage ?? (isEdit ? "已更新" : "已新增"));
}
</script>

<template>
  <div class="accent-cyan flex flex-col h-full gap-3">

    <!-- Top bar: two rows -->
    <div class="shrink-0 flex flex-col gap-2 bg-surface rounded-2xl border border-hairline px-4 py-3">
      <!-- Row 1: search + cloud sync + add -->
      <div class="flex items-center gap-3">
        <div class="relative w-52 shrink-0">
          <span class="absolute left-3 top-2.5 text-muted text-sm">🔍</span>
          <input v-model="search" placeholder="搜尋姓名 / 科別…"
            class="w-full pl-9 pr-8 py-2 rounded-xl bg-sunken border border-hairline text-fg text-sm placeholder-muted outline-none focus:border-accent/50 transition-all" />
          <button v-if="search" @click="search = ''" class="absolute right-2.5 top-2 text-muted hover:text-fg-secondary text-lg leading-none cursor-pointer">×</button>
        </div>
        <div class="flex-1" />
        <button @click="syncWithCloud()" :disabled="syncing"
          class="px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 disabled:opacity-50 transition-colors cursor-pointer"
          title="與雲端逐筆同步：較新的版本為準，刪除會傳到其他電腦">
          {{ syncing ? '…' : '⇅' }} 同步
        </button>
        <button @click="onOverwriteClick" :disabled="syncing"
          class="px-3 py-1.5 rounded-xl border text-xs font-bold disabled:opacity-50 transition-colors cursor-pointer"
          :class="confirmOverwrite ? 'bg-danger text-white border-danger' : 'bg-danger/5 border-danger/20 text-danger hover:bg-danger/15'"
          title="以本地為準覆蓋雲端：雲端有、本地沒有的人會在所有電腦上被刪除">
          {{ confirmOverwrite ? '確定覆蓋？' : '覆蓋' }}
        </button>
        <div class="w-px h-5 bg-overlay/10" />
        <button @click="openAdd"
          class="px-4 py-1.5 rounded-xl bg-gradient-to-r from-accent to-accent text-fg text-xs font-bold hover:from-accent hover:to-accent transition-all shadow-md cursor-pointer">
          ＋ 新增
        </button>
      </div>

      <!-- Row 2: filter tags (horizontal scroll) -->
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar" @wheel.prevent="onTagsWheel">
        <button @click="deptFilter = ''"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="deptFilter === '' ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'">
          全科
        </button>
        <button v-for="dept in departments" :key="dept"
          @click="deptFilter = deptFilter === dept ? '' : dept"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="deptFilter === dept ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'">
          {{ dept }}
        </button>
        <div class="w-px h-4 bg-overlay/10 mx-1 shrink-0" />
        <button @click="titleFilter = ''"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="titleFilter === '' ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'">
          所有職稱
        </button>
        <button v-for="title in titles" :key="title"
          @click="titleFilter = titleFilter === title ? '' : title"
          class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-all border cursor-pointer"
          :class="titleFilter === title ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'">
          {{ title }}
        </button>
      </div>
    </div>

    <!-- Main: name list + detail -->
    <div class="flex flex-1 gap-3 min-h-0">

      <!-- Left: names only -->
      <div class="w-44 shrink-0 flex flex-col bg-surface rounded-2xl border border-hairline overflow-hidden">
        <div class="px-3 py-2 border-b border-hairline shrink-0">
          <span class="text-2xs font-mono font-bold text-muted">{{ filtered().length }} RECORDS</span>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar">
          <div v-if="filtered().length === 0" class="text-muted text-xs text-center py-10 font-mono">NO DATA</div>
          <div v-for="p in filtered()" :key="p.id"
            @click="selected = p"
            class="group relative flex items-center px-3 py-2.5 cursor-pointer transition-all"
            :class="selected?.id === p.id
              ? 'bg-elevated'
              : 'hover:bg-overlay/5'">
            <div v-if="selected?.id === p.id" class="absolute left-0 top-0 bottom-0 w-0.5 bg-accent rounded-r" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-bold truncate" :class="selected?.id === p.id ? 'text-accent' : 'text-fg'">{{ p.name }}</div>
              <div v-if="p.department" class="text-2xs text-muted truncate mt-0.5">{{ p.department }}</div>
            </div>
            <button @click.stop="deleteTarget = p"
              class="opacity-0 group-hover:opacity-100 text-muted hover:text-danger text-sm leading-none cursor-pointer transition-all shrink-0 ml-1">×</button>
          </div>
        </div>
      </div>

      <!-- Right: dossier detail -->
      <div class="flex-1 rounded-2xl bg-surface border border-hairline p-6 overflow-y-auto min-h-0 custom-scrollbar">
        <div v-if="!selected" class="flex flex-col items-center justify-center h-full text-muted text-center space-y-3">
          <span class="text-4xl opacity-20">👨‍⚕️</span>
          <p class="text-sm uppercase tracking-widest font-mono">Select a physician card to view detail dossier</p>
        </div>

        <div v-else class="space-y-6">
          <!-- Header -->
          <div class="flex items-start justify-between border-b border-hairline pb-4">
            <div>
              <h2 class="text-2xl font-black text-fg tracking-wide">{{ selected.name }}</h2>
              <p class="text-sm font-semibold text-muted mt-1 uppercase tracking-wider">{{ selected.department }} · {{ selected.title }}</p>
            </div>
            <div class="flex gap-2 shrink-0">
              <button @click="openEdit(selected)"
                class="px-4 py-2 rounded-xl bg-overlay/5 border border-hairline hover:bg-overlay/10 active:scale-95 text-fg-secondary text-sm font-bold transition-all cursor-pointer">
                編輯
              </button>
              <button @click="deleteTarget = selected"
                class="px-4 py-2 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm font-bold hover:bg-danger/20 transition-all cursor-pointer">
                刪除
              </button>
            </div>
          </div>

          <!-- Extension -->
          <div v-if="selected.ext" class="p-4 rounded-2xl bg-surface border border-hairline flex items-center justify-between shadow-lg group hover:border-accent/20 transition-all">
            <div class="flex items-center gap-4">
              <span class="text-lg">📞</span>
              <div>
                <p class="text-xs font-bold text-muted">院內聯絡分機</p>
                <p class="text-3xl font-mono font-black text-accent mt-1 tracking-widest">{{ selected.ext }}</p>
              </div>
            </div>
            <button @click="copy(selected.ext)" class="text-xs font-bold px-3 py-1.5 bg-elevated border border-hairline text-fg-secondary hover:text-accent hover:border-accent/20 rounded-xl transition-all cursor-pointer">
              複製分機
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- HIS -->
            <div class="rounded-2xl border border-hairline bg-surface p-5 space-y-4">
              <div class="border-b border-hairline pb-2.5 flex justify-between items-center">
                <span class="text-xs font-bold text-fg-secondary">HIS 系統登入資料</span>
                <span class="text-2xs font-mono text-muted">HIS CREDENTIALS</span>
              </div>
              <div class="space-y-3 font-mono text-sm">
                <div class="flex items-center justify-between p-3 bg-sunken rounded-xl border border-hairline">
                  <span class="text-muted w-12">帳號</span>
                  <span class="text-fg font-bold flex-1 select-all truncate ml-2">{{ selected.his_account || '—' }}</span>
                  <button v-if="selected.his_account" @click="copy(selected.his_account)" class="text-muted hover:text-accent text-xs pl-2 cursor-pointer">📋</button>
                </div>
                <div class="flex items-center justify-between p-3 bg-sunken rounded-xl border border-hairline">
                  <span class="text-muted w-12">密碼</span>
                  <span class="text-fg font-bold flex-1 select-all truncate ml-2">{{ selected.his_password || '—' }}</span>
                  <button v-if="selected.his_password" @click="copy(selected.his_password)" class="text-muted hover:text-accent text-xs pl-2 cursor-pointer">📋</button>
                </div>
              </div>
            </div>

          </div>

          <!-- Notes -->
          <div v-if="selected.notes" class="p-5 rounded-2xl bg-surface border border-hairline">
            <p class="text-xs font-bold text-muted mb-2">備註說明 / 排班偏好</p>
            <p class="text-fg-secondary text-sm leading-relaxed whitespace-pre-wrap font-sans">{{ selected.notes }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete confirm modal -->
  <Teleport to="body">
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="deleteTarget = null">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-80 p-6 space-y-4 text-center">
        <p class="text-fg text-sm font-semibold mb-1">確定要刪除此醫師檔案？</p>
        <p class="text-xs text-danger font-bold font-mono">「{{ deleteTarget.name }}」</p>
        <div class="flex gap-2.5 justify-center pt-3 border-t border-hairline">
          <button @click="deleteTarget = null" class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-xs font-bold bg-danger text-white rounded-xl hover:bg-danger shadow-lg">確認刪除</button>
        </div>
      </div>
    </div>

    <!-- Add / Edit modal -->
    <div v-if="showAddModal" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="showAddModal = false">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-[440px] max-w-[95vw] p-6 space-y-4 overflow-y-auto max-h-[90vh]">
        <h2 class="text-fg font-black text-sm border-b border-hairline pb-2">
          {{ editTarget ? '⚙️ 編輯醫師基本檔案' : '✨ 新增醫師基本檔案' }}
        </h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="col-span-2">
            <label class="text-xs font-bold text-muted mb-1 block">醫師姓名 *</label>
            <input v-model="form.name" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50 font-bold" autofocus />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">專科別</label>
            <input v-model="form.department" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">臨床職稱</label>
            <input v-model="form.title" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
          </div>
          <div class="col-span-2">
            <label class="text-xs font-bold text-muted mb-1 block">聯絡分機</label>
            <input v-model="form.ext" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono focus:outline-none focus:border-accent/50" placeholder="e.g. 5123" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">HIS 系統帳號</label>
            <input v-model="form.his_account" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">HIS 系統密碼</label>
            <input v-model="form.his_password" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono focus:outline-none focus:border-accent/50" />
          </div>
          <div class="col-span-2">
            <label class="text-xs font-bold text-muted mb-1 block">備註說明 / 排班偏好</label>
            <input v-model="form.notes" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-2 border-t border-hairline bg-surface">
          <button @click="showAddModal = false" class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised hover:text-fg transition-colors">取消</button>
          <button @click="saveForm" class="px-5 py-2 text-xs font-bold bg-gradient-to-r from-accent to-accent text-fg rounded-xl hover:from-accent hover:to-accent transition-all shadow-lg">儲存並寫入</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4.5 py-2.5 bg-surface border border-hairline text-fg text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
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
