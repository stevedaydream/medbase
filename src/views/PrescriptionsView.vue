<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";

interface Prescription {
  id: number; name: string; category: string;
  indication: string; orders: string; notes: string;
}
interface Form {
  name: string; category: string; indication: string;
  orders: string; notes: string;
}

const items    = ref<Prescription[]>([]);
const search   = ref("");
const selected = ref<Prescription | null>(null);
const showModal = ref(false);
const modalMode = ref<"add" | "edit">("add");
const form = ref<Form>({ name: "", category: "", indication: "", orders: "", notes: "" });
const showDeleteConfirm = ref(false);
const cloud     = useCloudSettings();
const isSyncing = ref(false);
const toastMsg  = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2000);
}

onMounted(async () => { cloud.load(); await reload(); });

async function reload() {
  const db = await getDb();
  items.value = await db.select<Prescription[]>(
    "SELECT * FROM prescriptions ORDER BY category, name"
  );
}

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return items.value;
  return items.value.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    (m.category ?? "").toLowerCase().includes(q) ||
    (m.indication ?? "").toLowerCase().includes(q)
  );
});

function parseSteps(s: string | null): string[] {
  try { return JSON.parse(s ?? "[]") ?? []; } catch { return []; }
}

function copySteps() {
  if (!selected.value) return;
  navigator.clipboard.writeText(parseSteps(selected.value.orders).join("\n"));
}

function openAdd() {
  modalMode.value = "add";
  form.value = { name: "", category: "", indication: "", orders: "", notes: "" };
  showModal.value = true;
}

function openEdit() {
  if (!selected.value) return;
  modalMode.value = "edit";
  form.value = {
    name:       selected.value.name ?? "",
    category:   selected.value.category ?? "",
    indication: selected.value.indication ?? "",
    orders:     parseSteps(selected.value.orders).join("\n"),
    notes:      selected.value.notes ?? "",
  };
  showModal.value = true;
}

async function save() {
  const db = await getDb();
  const stepsJson = JSON.stringify(
    form.value.orders.split("\n").map((s) => s.trim()).filter(Boolean)
  );
  if (modalMode.value === "add") {
    await db.execute(
      "INSERT INTO prescriptions (name, category, indication, orders, notes) VALUES (?,?,?,?,?)",
      [form.value.name, form.value.category, form.value.indication, stepsJson, form.value.notes]
    );
  } else {
    await db.execute(
      "UPDATE prescriptions SET name=?, category=?, indication=?, orders=?, notes=? WHERE id=?",
      [form.value.name, form.value.category, form.value.indication, stepsJson, form.value.notes, selected.value!.id]
    );
  }
  showModal.value = false;
  const prevId = selected.value?.id;
  await reload();
  selected.value = items.value.find((m) => m.id === prevId) ?? null;
}

async function deleteSelected() {
  if (!selected.value) return;
  const db = await getDb();
  await db.execute("DELETE FROM prescriptions WHERE id=?", [selected.value.id]);
  selected.value = null;
  showDeleteConfirm.value = false;
  await reload();
}

async function pushToCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("prescriptions", true);
  try {
    await fetch(cloud.gasUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "savePrescriptions", data: items.value }),
      mode: "no-cors",
    });
    toast(`已上傳 ${items.value.length} 筆至雲端`);
  } catch (e) { toast(`上傳失敗：${(e as Error).message}`); }
  finally { isSyncing.value = false; setGlobalSyncing("prescriptions", false); }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("prescriptions", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getPrescriptions" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const data: Prescription[] = json.data;
    if (!data.length) { toast("雲端無資料"); return; }
    const db = await getDb();
    await db.execute("DELETE FROM prescriptions");
    for (const r of data) {
      await db.execute(
        "INSERT INTO prescriptions (id, name, category, indication, orders, notes) VALUES (?,?,?,?,?,?)",
        [r.id, r.name, r.category ?? "", r.indication ?? "", r.orders ?? "[]", r.notes ?? ""]
      );
    }
    const prevId = selected.value?.id;
    await reload();
    selected.value = items.value.find(m => m.id === prevId) ?? null;
    toast(`已從雲端同步 ${data.length} 筆`);
  } catch (e) { toast(`下載失敗：${(e as Error).message}`); }
  finally { isSyncing.value = false; setGlobalSyncing("prescriptions", false); }
}

const stepCount = computed(() =>
  form.value.orders.split("\n").filter((s) => s.trim()).length
);
</script>

<template>
  <div class="flex gap-6 h-full p-1 overflow-hidden">

    <!-- ── 左側列表 ─────────────────────────────── -->
    <div class="flex flex-col w-80 shrink-0 bg-zinc-950/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-xl overflow-hidden">
      <!-- Search & Add -->
      <div class="flex gap-2 mb-3 shrink-0">
        <div class="relative flex-1">
          <span class="absolute left-3.5 top-2.5 text-slate-500 text-xs">🔍</span>
          <input
            v-model="search"
            placeholder="搜尋名稱、分類…"
            class="w-full pl-9 pr-3.5 py-2 text-xs rounded-xl bg-slate-950/60 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:shadow-[0_0_12px_rgba(245,158,11,0.15)] transition-all font-bold"
          />
        </div>
        <button @click="openAdd"
          class="w-9 h-9 rounded-xl bg-amber-600 border border-amber-500/30 text-white text-lg font-black hover:bg-amber-500 active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
          title="新增藥物配製參考">＋</button>
      </div>

      <p class="text-slate-500 text-[10px] font-black uppercase tracking-wider font-mono mb-2 px-1">{{ filtered.length }} 筆資料</p>

      <!-- Sync Actions -->
      <div class="grid grid-cols-2 gap-2 mb-3 shrink-0">
        <button @click="pullFromCloud" :disabled="isSyncing"
          class="flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl bg-slate-950 border border-white/5 text-slate-400 text-xs font-black hover:text-slate-200 disabled:opacity-40 active:scale-95 transition-all cursor-pointer">
          {{ isSyncing ? "…" : "↓ 雲端同步" }}
        </button>
        <button @click="pushToCloud" :disabled="isSyncing"
          class="flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl bg-slate-800/40 border border-white/5 text-slate-400 text-xs font-black hover:text-slate-200 disabled:opacity-40 active:scale-95 transition-all cursor-pointer">
          {{ isSyncing ? "…" : "↑ 上傳備份" }}
        </button>
      </div>

      <!-- List Container -->
      <div class="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
        <div v-if="filtered.length === 0" class="text-slate-600 text-xs text-center py-10 italic">無資料</div>
        <button v-for="m in filtered" :key="m.id" @click="selected = m"
          class="w-full text-left px-3.5 py-3 rounded-xl border transition-all cursor-pointer"
          :class="selected?.id === m.id
            ? 'bg-amber-600/20 border-amber-500/40 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.08)]'
            : 'bg-slate-950/20 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 hover:border-white/10'">
          <div class="font-black text-xs text-slate-200 truncate">{{ m.name }}</div>
          <div class="flex items-center gap-1.5 mt-1.5">
            <span class="text-[9px] font-bold bg-slate-900 px-1.5 py-0.5 rounded text-slate-500 border border-white/5 font-mono">{{ m.category }}</span>
            <span v-if="m.indication" class="text-[9px] text-slate-500 truncate flex-1 font-mono font-medium">{{ m.indication }}</span>
          </div>
        </button>
      </div>
    </div>

    <!-- ── 右側詳情 ─────────────────────────────── -->
    <div class="flex-1 rounded-2xl bg-zinc-900/50 backdrop-blur-md border border-white/10 p-6 overflow-y-auto shadow-2xl flex flex-col min-w-0 custom-scrollbar">
      <div v-if="!selected" class="flex flex-col items-center justify-center h-full gap-3 text-slate-600 text-xs font-bold italic py-16">
        <span class="text-5xl animate-pulse">💊</span>
        <span>選擇右側/左側藥物配製參考，或按 ＋ 新增</span>
        <span class="text-[10px] text-center text-slate-700 max-w-xs mt-1 leading-relaxed font-mono not-italic uppercase tracking-wide">收錄升壓劑泡法、特殊稀釋步驟、抗生素劑量注意事項等</span>
      </div>

      <div v-else class="space-y-6">
        <!-- Detail Header -->
        <div class="flex items-start justify-between pb-5 border-b border-white/5">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-lg font-black text-slate-100 tracking-wide truncate">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              <span v-if="selected.category"
                class="text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-0.5 rounded-full">
                {{ selected.category }}
              </span>
              <span v-if="selected.indication" class="text-amber-200/60 text-xs font-mono font-medium">
                {{ selected.indication }}
              </span>
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            <button @click="copySteps"
              class="px-3.5 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:text-slate-100 hover:bg-slate-700 transition-all cursor-pointer">
              📋 複製步驟
            </button>
            <button @click="openEdit"
              class="px-3.5 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:text-slate-100 hover:bg-slate-700 transition-all cursor-pointer">
              ✏️ 編輯
            </button>
            <button @click="showDeleteConfirm = true"
              class="px-3.5 py-2 rounded-xl bg-rose-950/40 border border-rose-900/30 text-rose-400 text-xs font-bold hover:bg-rose-900/40 hover:text-rose-300 transition-all cursor-pointer">
              🗑 刪除
            </button>
          </div>
        </div>

        <!-- 配製步驟 -->
        <div class="bg-white/[0.02] border border-white/5 rounded-xl p-5">
          <p class="text-slate-500 text-[10px] font-black uppercase tracking-widest font-mono mb-4">
            配製 &amp; 給藥步驟 · {{ parseSteps(selected.orders).length }} 步
          </p>
          <ol class="space-y-3.5">
            <li v-for="(o, i) in parseSteps(selected.orders)" :key="i"
              class="flex items-start gap-3.5 text-slate-200 text-xs leading-relaxed font-bold">
              <span class="shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white text-[10px] flex items-center justify-center font-black font-mono shadow-md shadow-amber-900/20">
                {{ i + 1 }}
              </span>
              <span class="font-mono mt-0.5 leading-relaxed flex-1 select-all">{{ o }}</span>
            </li>
            <li v-if="parseSteps(selected.orders).length === 0"
              class="text-slate-600 text-xs text-center py-8 italic font-bold">
              尚無步驟，點「✏️ 編輯」新增
            </li>
          </ol>
        </div>

        <!-- 注意事項 -->
        <div v-if="selected.notes" class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 shadow-[0_0_15px_rgba(239,68,68,0.05)]">
          <p class="text-rose-400 text-xs font-black uppercase tracking-wider font-mono mb-2 flex items-center gap-1.5">
            <span>⚠️</span> 注意事項 / 警語
          </p>
          <p class="text-rose-200/80 text-xs leading-relaxed whitespace-pre-line font-medium pl-1">{{ selected.notes }}</p>
        </div>
      </div>
    </div>

    <!-- ── Modal ──────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showModal"
        class="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
        @click.self="showModal = false">
        <div class="w-full max-w-lg bg-slate-900 border border-white/10 shadow-2xl rounded-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
          <div class="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-slate-950/30 shrink-0">
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-slate-200">
              {{ modalMode === "add" ? "新增藥物配製參考" : "編輯藥物配製參考" }}
            </h3>
            <button @click="showModal = false" class="text-slate-500 hover:text-white text-xl leading-none transition-colors cursor-pointer">×</button>
          </div>
          <div class="overflow-y-auto px-5 py-4 space-y-4 flex-1 custom-scrollbar">
            <div>
              <label class="text-slate-500 text-[10px] font-black uppercase tracking-wider font-mono block mb-1.5">藥物 / 處方名稱 <span class="text-rose-400">*</span></label>
              <input v-model="form.name"
                class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/10 text-slate-200 focus:outline-none focus:border-amber-500/50 font-bold"
                placeholder="如：Dopamine、FOY、Ceftriaxone" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-slate-500 text-[10px] font-black uppercase tracking-wider font-mono block mb-1.5">分類</label>
                <input v-model="form.category"
                  class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/10 text-slate-200 focus:outline-none focus:border-amber-500/50 font-bold"
                  placeholder="如：升壓劑、抗生素、消化科" />
              </div>
              <div>
                <label class="text-slate-500 text-[10px] font-black uppercase tracking-wider font-mono block mb-1.5">濃度 / 規格</label>
                <input v-model="form.indication"
                  class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/10 text-slate-200 focus:outline-none focus:border-amber-500/50 font-mono font-bold"
                  placeholder="如：200mg in 250mL NS" />
              </div>
            </div>
            <div>
              <label class="text-slate-500 text-[10px] font-black uppercase tracking-wider font-mono flex items-center justify-between mb-1.5">
                <span>配製 &amp; 給藥步驟（每行一步）</span>
                <span class="text-slate-600 font-bold font-mono">{{ stepCount }} 步</span>
              </label>
              <textarea v-model="form.orders" rows="8"
                placeholder="取 200mg Dopamine HCl&#10;加入 250mL NS → 800mcg/mL&#10;以 5mcg/kg/min 起始，每 5min 上調 2.5mcg/kg/min&#10;最高劑量 20mcg/kg/min"
                class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs font-mono focus:outline-none focus:border-amber-500/50 resize-none custom-scrollbar leading-relaxed" />
            </div>
            <div>
              <label class="text-rose-400/80 text-[10px] font-black uppercase tracking-wider font-mono block mb-1.5">⚠️ 注意事項 / 警語</label>
              <textarea v-model="form.notes" rows="3"
                placeholder="如：腎功能不全需減量；避免與 alkaline solution 混用"
                class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-rose-900/30 text-slate-200 text-xs focus:outline-none focus:border-red-500 resize-none leading-relaxed" />
            </div>
          </div>
          <div class="flex justify-end gap-2.5 px-5 py-4 border-t border-white/5 bg-slate-950/20 shrink-0">
            <button @click="showModal = false"
              class="px-4 py-2 text-xs font-bold bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-xl transition-all cursor-pointer">取消</button>
            <button @click="save" :disabled="!form.name.trim()"
              class="px-5 py-2 text-xs font-black bg-amber-600 hover:bg-amber-500 border border-amber-500/30 text-white rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
              儲存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 刪除確認 ───────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm"
        class="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
        @click.self="showDeleteConfirm = false">
        <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center text-slate-100">
          <div class="text-3xl mb-3">🗑️</div>
          <p class="text-sm font-bold mb-1">確認刪除配製參考？</p>
          <p class="text-xs text-slate-500 mb-5 leading-normal">確定刪除「{{ selected?.name }}」？此操作將無法復原。</p>
          <div class="flex justify-center gap-3">
            <button @click="showDeleteConfirm = false"
              class="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 border border-white/5 cursor-pointer">取消</button>
            <button @click="deleteSelected"
              class="px-4 py-2 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-500 text-white border border-rose-500/30 cursor-pointer">確定刪除</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-slate-900 border border-white/15 text-slate-200 text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
          {{ toastMsg }}
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
