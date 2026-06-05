<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";

interface Examination {
  id: number; name: string; his_code: string; category: string;
  indication: string; orders: string; notes: string;
}
interface Form {
  name: string; his_code: string; category: string;
  indication: string; orders: string; notes: string;
}

const items    = ref<Examination[]>([]);
const search   = ref("");
const selected = ref<Examination | null>(null);
const showModal = ref(false);
const modalMode = ref<"add" | "edit">("add");
const form = ref<Form>({ name: "", his_code: "", category: "", indication: "", orders: "", notes: "" });
const showDeleteConfirm = ref(false);
const codeCopied = ref(false);
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
  items.value = await db.select<Examination[]>(
    "SELECT * FROM examination ORDER BY category, name"
  );
}

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return items.value;
  return items.value.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    (m.his_code ?? "").toLowerCase().includes(q) ||
    (m.category ?? "").toLowerCase().includes(q) ||
    (m.indication ?? "").toLowerCase().includes(q)
  );
});

function parseTips(s: string | null): string[] {
  try { return JSON.parse(s ?? "[]") ?? []; } catch { return []; }
}

async function copyCode() {
  if (!selected.value?.his_code) return;
  await navigator.clipboard.writeText(selected.value.his_code);
  codeCopied.value = true;
  setTimeout(() => { codeCopied.value = false; }, 1500);
}

function copyTips() {
  if (!selected.value) return;
  navigator.clipboard.writeText(parseTips(selected.value.orders).join("\n"));
}

function openAdd() {
  modalMode.value = "add";
  form.value = { name: "", his_code: "", category: "", indication: "", orders: "", notes: "" };
  showModal.value = true;
}

function openEdit() {
  if (!selected.value) return;
  modalMode.value = "edit";
  form.value = {
    name:       selected.value.name ?? "",
    his_code:   selected.value.his_code ?? "",
    category:   selected.value.category ?? "",
    indication: selected.value.indication ?? "",
    orders:     parseTips(selected.value.orders).join("\n"),
    notes:      selected.value.notes ?? "",
  };
  showModal.value = true;
}

async function save() {
  const db = await getDb();
  const tipsJson = JSON.stringify(
    form.value.orders.split("\n").map((s) => s.trim()).filter(Boolean)
  );
  if (modalMode.value === "add") {
    await db.execute(
      "INSERT INTO examination (name, his_code, category, indication, orders, notes) VALUES (?,?,?,?,?,?)",
      [form.value.name, form.value.his_code, form.value.category, form.value.indication, tipsJson, form.value.notes]
    );
  } else {
    await db.execute(
      "UPDATE examination SET name=?, his_code=?, category=?, indication=?, orders=?, notes=? WHERE id=?",
      [form.value.name, form.value.his_code, form.value.category, form.value.indication, tipsJson, form.value.notes, selected.value!.id]
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
  await db.execute("DELETE FROM examination WHERE id=?", [selected.value.id]);
  selected.value = null;
  showDeleteConfirm.value = false;
  await reload();
}

async function pushToCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("examination", true);
  try {
    await fetch(cloud.gasUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveExamination", data: items.value }),
      mode: "no-cors",
    });
    toast(`已上傳 ${items.value.length} 筆至雲端`);
  } catch (e) { toast(`上傳失敗：${(e as Error).message}`); }
  finally { isSyncing.value = false; setGlobalSyncing("examination", false); }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("examination", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getExamination" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const data: Examination[] = json.data;
    if (!data.length) { toast("雲端無資料"); return; }
    const db = await getDb();
    await db.execute("DELETE FROM examination");
    for (const r of data) {
      await db.execute(
        "INSERT INTO examination (id, name, his_code, category, indication, orders, notes) VALUES (?,?,?,?,?,?,?)",
        [r.id, r.name, r.his_code ?? "", r.category ?? "", r.indication ?? "", r.orders ?? "[]", r.notes ?? ""]
      );
    }
    const prevId = selected.value?.id;
    await reload();
    selected.value = items.value.find(m => m.id === prevId) ?? null;
    toast(`已從雲端同步 ${data.length} 筆`);
  } catch (e) { toast(`下載失敗：${(e as Error).message}`); }
  finally { isSyncing.value = false; setGlobalSyncing("examination", false); }
}

const tipCount = computed(() =>
  form.value.orders.split("\n").filter((s) => s.trim()).length
);
</script>

<template>
  <div class="flex gap-6 h-full text-slate-100 select-none bg-slate-950/20">

    <!-- ── 左側列表 ─────────────────────────────── -->
    <div class="flex flex-col w-80 shrink-0 bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-xl overflow-hidden">
      <div class="flex gap-2 mb-3 shrink-0">
        <input v-model="search" placeholder="搜尋檢查名稱、HIS 代碼…"
          class="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs placeholder-slate-600 outline-none focus:border-purple-500/50 font-bold" />
        <button @click="openAdd"
          class="w-10 h-10 flex items-center justify-center rounded-xl bg-purple-600 hover:bg-purple-500 border border-purple-500/30 text-white text-lg font-bold transition-all active:scale-95 shadow-lg shadow-purple-500/10 cursor-pointer"
          title="新增 HIS 開單備忘">＋</button>
      </div>
      
      <div class="flex items-center justify-between px-1.5 mb-3 shrink-0">
        <span class="text-slate-500 text-[10px] font-black uppercase tracking-widest font-mono">{{ filtered.length }} EXAMINATIONS</span>
        <div class="flex gap-1">
          <button @click="pullFromCloud" :disabled="isSyncing"
            class="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-400 hover:border-indigo-500 hover:bg-indigo-500/10 disabled:opacity-40 transition-colors cursor-pointer">
            {{ isSyncing ? "…" : "↓ 同步" }}
          </button>
          <button @click="pushToCloud" :disabled="isSyncing"
            class="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-white/5 bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors cursor-pointer">
            {{ isSyncing ? "…" : "↑ 上傳" }}
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
        <div v-if="filtered.length === 0" class="text-slate-600 text-xs italic text-center py-12">無資料</div>
        <button v-for="m in filtered" :key="m.id" @click="selected = m"
          class="w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer group"
          :class="selected?.id === m.id 
            ? 'bg-purple-600/20 border-purple-500/50 text-white shadow-[0_0_15px_rgba(168,85,247,0.08)]' 
            : 'bg-slate-950/40 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200 hover:bg-slate-900/30'">
          <div class="flex items-center gap-2">
            <span class="font-bold text-xs truncate flex-1">{{ m.name }}</span>
            <span v-if="m.his_code"
              class="text-[9px] font-mono shrink-0 opacity-70 bg-slate-950 px-1.5 py-0.5 rounded border border-white/5 text-slate-400 font-bold">
              {{ m.his_code }}
            </span>
          </div>
          <div class="text-[10px] font-mono mt-1 opacity-65">{{ m.category }}</div>
        </button>
      </div>
    </div>

    <!-- ── 右側詳情 ─────────────────────────────── -->
    <div class="flex-1 rounded-2xl bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 overflow-y-auto flex flex-col shadow-xl">
      <div v-if="!selected" class="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 py-12">
        <span class="text-4xl animate-pulse">🔬</span>
        <p class="text-xs font-black uppercase tracking-widest font-mono">請選擇檢查項目，或點擊 ＋ 新增</p>
        <span class="text-[10px] text-center text-slate-600 max-w-xs mt-1 leading-relaxed">
          收錄 HIS 代碼、特殊開法、需搭配的項目、預約限制等細節。
        </span>
      </div>
      <div v-else class="space-y-6 flex-1 flex flex-col">
        <!-- Detail Header -->
        <div class="flex items-start justify-between border-b border-white/5 pb-4 shrink-0">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-base font-black text-slate-200 tracking-wider">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-2 flex-wrap font-mono">
              <span v-if="selected.category" class="text-[9px] font-black uppercase bg-purple-500/10 border border-purple-500/30 text-purple-400 px-2 py-0.5 rounded-full">{{ selected.category }}</span>
              <span v-if="selected.indication" class="text-slate-400 text-xs font-bold">{{ selected.indication }}</span>
            </div>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <button @click="copyTips"
              class="px-3.5 py-2 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-slate-800 text-slate-300 text-xs font-bold transition-all active:scale-95 cursor-pointer">📋 複製備忘</button>
            <button @click="openEdit"
              class="px-3.5 py-2 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-slate-800 text-slate-300 text-xs font-bold transition-all active:scale-95 cursor-pointer">✏️ 編輯</button>
            <button @click="showDeleteConfirm = true"
              class="px-3.5 py-2 rounded-xl border border-rose-950/30 bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 text-xs font-bold transition-all active:scale-95 cursor-pointer">🗑 刪除</button>
          </div>
        </div>

        <!-- HIS 代碼區塊 -->
        <div v-if="selected.his_code"
          class="shrink-0 flex items-center justify-between bg-purple-950/20 border border-purple-500/30 rounded-2xl px-5 py-4 shadow-lg">
          <div>
            <p class="text-purple-400 text-[10px] uppercase tracking-widest font-mono font-black mb-1">HIS 系統代碼</p>
            <p class="text-purple-200 text-lg font-mono font-black tracking-wider">{{ selected.his_code }}</p>
          </div>
          <button @click="copyCode"
            class="px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-md"
            :class="codeCopied
              ? 'bg-emerald-600 text-white shadow-emerald-500/10 border border-emerald-500/20'
              : 'bg-purple-800/60 text-purple-300 border border-purple-500/20 hover:bg-purple-700/60'">
            {{ codeCopied ? '✓ 已複製' : '複製代碼' }}
          </button>
        </div>

        <!-- 開單注意事項 -->
        <div class="bg-slate-950/40 border border-white/5 rounded-2xl p-5 flex flex-col flex-1 overflow-hidden shadow-inner">
          <p class="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono mb-4">開單注意事項</p>
          <div class="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            <div v-for="(tip, i) in parseTips(selected.orders)" :key="i"
              class="flex items-start gap-3 text-slate-300 text-xs font-mono bg-slate-950/60 border border-white/[0.03] rounded-xl px-4 py-3 hover:border-white/10 transition-colors">
              <span class="text-purple-400 text-xs font-bold pt-0.5 w-5 shrink-0 select-none">▸</span>
              <span class="leading-relaxed">{{ tip }}</span>
            </div>
            <div v-if="parseTips(selected.orders).length === 0" class="text-slate-500 text-xs italic text-center py-12">
              尚無注意事項，點「✏️ 編輯」新增
            </div>
          </div>
        </div>

        <!-- 備註 -->
        <div v-if="selected.notes" class="bg-slate-950/30 border border-white/5 rounded-2xl p-4 shrink-0 shadow-md">
          <p class="text-[9px] font-black text-slate-500 uppercase tracking-widest font-mono mb-2">備註說明 / 注意事項</p>
          <p class="text-slate-300 text-xs leading-relaxed whitespace-pre-line font-bold">{{ selected.notes }}</p>
        </div>
      </div>
    </div>

    <!-- ── Modal：新增 / 編輯 ──────────────────── -->
    <Teleport to="body">
      <div v-if="showModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
        @click.self="showModal = false">
        <div class="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] text-slate-100 overflow-hidden">
          <div class="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0 bg-slate-950/30">
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-slate-200">
              {{ modalMode === "add" ? "新增 HIS 開單備忘" : "編輯 HIS 開單備忘" }}
            </h3>
            <button @click="showModal = false" class="text-slate-500 hover:text-slate-200 text-xl leading-none cursor-pointer">×</button>
          </div>
          
          <div class="overflow-y-auto px-6 py-5 space-y-4 flex-1 custom-scrollbar">
            <div>
              <label class="text-slate-500 text-[10px] font-black uppercase tracking-widest font-mono block mb-1.5">檢查名稱 <span class="text-rose-400">*</span></label>
              <input v-model="form.name"
                class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-purple-500/50 font-bold"
                placeholder="如：MRCP、無痛大腸鏡、Frozen Section" />
            </div>
            
            <div>
              <label class="text-purple-400 text-[10px] font-black uppercase tracking-widest font-mono block mb-1.5 font-bold">HIS 系統代碼 ★</label>
              <input v-model="form.his_code"
                class="w-full px-3 py-2 bg-purple-950/40 border border-purple-800/60 rounded-xl text-purple-100 text-xs font-mono outline-none focus:border-purple-400"
                placeholder="如：R2-7 #201、R7401+R602、電話預約" />
            </div>
            
            <div class="flex gap-4">
              <div class="flex-1">
                <label class="text-slate-500 text-[10px] font-black uppercase tracking-widest font-mono block mb-1.5">分類</label>
                <input v-model="form.category"
                  class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-purple-500/50 font-bold"
                  placeholder="如：影像、內視鏡、病理、核醫" />
              </div>
              <div class="flex-1">
                <label class="text-slate-500 text-[10px] font-black uppercase tracking-widest font-mono block mb-1.5">適應症 / 說明</label>
                <input v-model="form.indication"
                  class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-purple-500/50 font-bold"
                  placeholder="如：膽道疾病評估" />
              </div>
            </div>
            
            <div>
              <label class="text-slate-500 text-[10px] font-black uppercase tracking-widest font-mono block mb-1.5">
                開單注意事項（每行一條）
                <span class="text-slate-600 font-mono font-bold ml-2">({{ tipCount }} 條)</span>
              </label>
              <textarea v-model="form.orders" rows="7"
                placeholder="無痛需同時開 R7401 + R602&#10;需會診麻醉科後才可執行&#10;禁食 6 小時以上&#10;…"
                class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-purple-500/50 resize-none custom-scrollbar font-medium" />
            </div>
            
            <div>
              <label class="text-slate-500 text-[10px] font-black uppercase tracking-widest font-mono block mb-1.5">備註（時間限制、預約方式等）</label>
              <textarea v-model="form.notes" rows="2"
                placeholder="如：一三五才可預約 Frozen；需先打電話到病理科（分機 3456）"
                class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-purple-500/50 resize-none custom-scrollbar font-medium" />
            </div>
          </div>
          
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-white/5 shrink-0 bg-slate-950/30">
            <button @click="showModal = false" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl cursor-pointer">取消</button>
            <button @click="save" :disabled="!form.name.trim()"
              class="px-5 py-2 bg-purple-600 border border-purple-500/30 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-purple-500/10 cursor-pointer">
              儲存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 刪除確認 ───────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
        @click.self="showDeleteConfirm = false">
        <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-sm text-slate-100">
          <p class="font-bold text-sm mb-1 text-slate-200">確認刪除</p>
          <p class="text-slate-400 text-xs mb-5 font-medium">確定刪除「{{ selected?.name }}」？此操作無法復原。</p>
          <div class="flex justify-end gap-3">
            <button @click="showDeleteConfirm = false" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl cursor-pointer">取消</button>
            <button @click="deleteSelected" class="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl cursor-pointer">確定刪除</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-slate-900/90 border border-white/10 text-slate-200 text-xs font-bold rounded-2xl shadow-2xl pointer-events-none z-50 backdrop-blur-md">
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
