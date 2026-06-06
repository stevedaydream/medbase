<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { markLocalModified, saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { useLogger } from "@/composables/useLogger";

interface Disease {
  id: number; name: string; icd10: string; category: string;
  workup: string; treatment_orders: string; consult_flow: string; notes: string;
}
interface Form {
  name: string; icd10: string; category: string;
  workup: string; treatment_orders: string; consult_flow: string; notes: string;
}

const items    = ref<Disease[]>([]);
const search   = ref("");
const selected = ref<Disease | null>(null);
const activeTab = ref<"workup" | "consult" | "orders">("workup");
const showModal = ref(false);
const modalMode = ref<"add" | "edit">("add");
const form = ref<Form>({ name: "", icd10: "", category: "", workup: "", treatment_orders: "", consult_flow: "", notes: "" });
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
  items.value = await db.select<Disease[]>(
    "SELECT * FROM disease ORDER BY category, name"
  );
}

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return items.value;
  return items.value.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    (m.icd10 ?? "").toLowerCase().includes(q) ||
    (m.category ?? "").toLowerCase().includes(q)
  );
});

function parse(s: string | null): string[] {
  try { return JSON.parse(s ?? "[]") ?? []; } catch { return []; }
}

function copyActive() {
  if (!selected.value) return;
  if (activeTab.value === "workup")
    navigator.clipboard.writeText(parse(selected.value.workup).join("\n"));
  else if (activeTab.value === "consult")
    navigator.clipboard.writeText(selected.value.consult_flow ?? "");
  else
    navigator.clipboard.writeText(parse(selected.value.treatment_orders).join("\n"));
}

function openAdd() {
  modalMode.value = "add";
  form.value = { name: "", icd10: "", category: "", workup: "", treatment_orders: "", consult_flow: "", notes: "" };
  showModal.value = true;
}

function openEdit() {
  if (!selected.value) return;
  modalMode.value = "edit";
  form.value = {
    name:             selected.value.name ?? "",
    icd10:            selected.value.icd10 ?? "",
    category:         selected.value.category ?? "",
    workup:           parse(selected.value.workup).join("\n"),
    treatment_orders: parse(selected.value.treatment_orders).join("\n"),
    consult_flow:     selected.value.consult_flow ?? "",
    notes:            selected.value.notes ?? "",
  };
  showModal.value = true;
}

async function save() {
  const db = await getDb();
  const toJson = (s: string) => JSON.stringify(s.split("\n").map((l) => l.trim()).filter(Boolean));
  if (modalMode.value === "add") {
    await db.execute(
      "INSERT INTO disease (name, icd10, category, workup, treatment_orders, consult_flow, notes) VALUES (?,?,?,?,?,?,?)",
      [form.value.name, form.value.icd10, form.value.category,
       toJson(form.value.workup), toJson(form.value.treatment_orders),
       form.value.consult_flow, form.value.notes]
    );
  } else {
    await db.execute(
      "UPDATE disease SET name=?, icd10=?, category=?, workup=?, treatment_orders=?, consult_flow=?, notes=? WHERE id=?",
      [form.value.name, form.value.icd10, form.value.category,
       toJson(form.value.workup), toJson(form.value.treatment_orders),
       form.value.consult_flow, form.value.notes, selected.value!.id]
    );
  }
  showModal.value = false;
  const prevId = selected.value?.id;
  await reload();
  selected.value = items.value.find((m) => m.id === prevId) ?? null;
  await markLocalModified("disease");
  pushToCloud().catch(() => {});
}

async function deleteSelected() {
  if (!selected.value) return;
  const db = await getDb();
  await db.execute("DELETE FROM disease WHERE id=?", [selected.value.id]);
  selected.value = null;
  showDeleteConfirm.value = false;
  await reload();
}

async function pushToCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("disease", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveDisease", data: items.value }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 錯誤");
    toast(`已上傳 ${items.value.length} 筆至雲端`);
    await saveSyncTimestamp("disease");
    useLogger().addLog("info", `[雲端同步] push 疾病常規 — ${items.value.length} 筆`, JSON.stringify({ table: "disease", action: "push", timestamp: new Date().toISOString() }));
  } catch (e) {
    toast(`上傳失敗：${(e as Error).message}`);
    useLogger().addLog("warn", "[雲端同步] push 疾病常規 失敗", String(e));
  }
  finally { isSyncing.value = false; setGlobalSyncing("disease", false); }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("disease", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getDisease" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const data: Disease[] = json.data;
    if (!data.length) { toast("雲端無資料"); return; }
    const db = await getDb();
    await db.execute("DELETE FROM disease");
    for (const r of data) {
      await db.execute(
        "INSERT INTO disease (id, name, icd10, category, workup, treatment_orders, consult_flow, notes) VALUES (?,?,?,?,?,?,?,?)",
        [r.id, r.name, r.icd10 ?? "", r.category ?? "", r.workup ?? "[]", r.treatment_orders ?? "[]", r.consult_flow ?? "", r.notes ?? ""]
      );
    }
    const prevId = selected.value?.id;
    await reload();
    selected.value = items.value.find(m => m.id === prevId) ?? null;
    toast(`已從雲端同步 ${data.length} 筆`);
  } catch (e) { toast(`下載失敗：${(e as Error).message}`); }
  finally { isSyncing.value = false; setGlobalSyncing("disease", false); }
}
</script>

<template>
  <div class="flex gap-6 h-full text-slate-100 select-none bg-slate-950/20">

    <!-- ── 左側列表 ─────────────────────────────── -->
    <div class="flex flex-col w-80 shrink-0 bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-xl overflow-hidden">
      <div class="flex gap-2 mb-3 shrink-0">
        <input v-model="search" placeholder="搜尋疾病、ICD-10…"
          class="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs placeholder-slate-600 outline-none focus:border-emerald-500/50 font-bold" />
        <button @click="openAdd"
          class="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/30 text-white text-lg font-bold transition-all active:scale-95 shadow-lg shadow-emerald-500/10 cursor-pointer"
          title="新增疾病入院流程">＋</button>
      </div>
      
      <div class="flex items-center justify-between px-1.5 mb-3 shrink-0">
        <span class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono">{{ filtered.length }} RECORDS</span>
        <div class="flex gap-1">
          <button @click="pullFromCloud" :disabled="isSyncing"
            class="text-2xs font-bold px-2.5 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-400 hover:border-indigo-500 hover:bg-indigo-500/10 disabled:opacity-40 transition-colors cursor-pointer">
            {{ isSyncing ? "…" : "↓ 同步" }}
          </button>
          <button @click="pushToCloud" :disabled="isSyncing"
            class="text-2xs font-bold px-2.5 py-1.5 rounded-lg border border-white/5 bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors cursor-pointer">
            {{ isSyncing ? "…" : "↑ 上傳" }}
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
        <div v-if="filtered.length === 0" class="text-slate-600 text-xs italic text-center py-12">無資料</div>
        <button v-for="m in filtered" :key="m.id"
          @click="selected = m; activeTab = 'workup'"
          class="w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer group"
          :class="selected?.id === m.id 
            ? 'bg-emerald-600/20 border-emerald-500/50 text-white shadow-[0_0_15px_rgba(16,185,129,0.08)]' 
            : 'bg-slate-950/40 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200 hover:bg-slate-900/30'">
          <div class="font-bold text-xs truncate">{{ m.name }}</div>
          <div class="text-2xs font-mono mt-1 flex items-center gap-1.5 opacity-65">
            <span v-if="m.icd10" class="bg-slate-950 px-1.5 py-0.5 rounded text-emerald-400 font-semibold">{{ m.icd10 }}</span>
            <span v-if="m.category" class="truncate">{{ m.category }}</span>
          </div>
        </button>
      </div>
    </div>

    <!-- ── 右側詳情 ─────────────────────────────── -->
    <div class="flex-1 rounded-2xl bg-slate-900/40 backdrop-blur-md border border-white/5 p-6 overflow-y-auto flex flex-col shadow-xl">
      <div v-if="!selected" class="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 py-12">
        <span class="text-4xl animate-pulse">🦠</span>
        <p class="text-xs font-black uppercase tracking-widest font-mono">請選擇疾病，或點擊 ＋ 新增</p>
        <span class="text-2xs text-center text-slate-600 max-w-xs mt-1 leading-relaxed">
          收錄入院需開哪些 Labs / 影像、需會診科別與流程、常規醫囑。
        </span>
      </div>
      <div v-else class="space-y-6 flex-1 flex flex-col">
        <!-- Detail Header -->
        <div class="flex items-start justify-between border-b border-white/5 pb-4 shrink-0">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-base font-black text-slate-200 tracking-wider">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-2 flex-wrap font-mono">
              <span v-if="selected.icd10" class="text-2xs font-bold bg-slate-950 border border-white/5 text-slate-400 px-2 py-0.5 rounded">{{ selected.icd10 }}</span>
              <span v-if="selected.category" class="text-3xs font-black uppercase bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full">{{ selected.category }}</span>
            </div>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <button @click="copyActive"
              class="px-3.5 py-2 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-slate-800 text-slate-300 text-xs font-bold transition-all active:scale-95 cursor-pointer">📋 複製</button>
            <button @click="openEdit"
              class="px-3.5 py-2 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-slate-800 text-slate-300 text-xs font-bold transition-all active:scale-95 cursor-pointer">✏️ 編輯</button>
            <button @click="showDeleteConfirm = true"
              class="px-3.5 py-2 rounded-xl border border-rose-950/30 bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 text-xs font-bold transition-all active:scale-95 cursor-pointer">🗑 刪除</button>
          </div>
        </div>

        <!-- 三個 Tab -->
        <nav class="flex gap-1 p-1 bg-slate-950/60 rounded-xl border border-white/5 shrink-0 shadow-inner max-w-lg">
          <button @click="activeTab = 'workup'"
            class="flex-1 py-2 rounded-lg text-xs font-black transition-all cursor-pointer"
            :class="activeTab === 'workup' ? 'bg-slate-800 text-emerald-400 shadow border border-white/[0.02]' : 'text-slate-500 hover:text-slate-300'">
            入院 Workup <span class="text-2xs font-mono opacity-70 ml-1 font-bold">({{ parse(selected.workup).length }})</span>
          </button>
          <button @click="activeTab = 'consult'"
            class="flex-1 py-2 rounded-lg text-xs font-black transition-all cursor-pointer"
            :class="activeTab === 'consult' ? 'bg-slate-800 text-emerald-400 shadow border border-white/[0.02]' : 'text-slate-500 hover:text-slate-300'">
            會診流程
          </button>
          <button @click="activeTab = 'orders'"
            class="flex-1 py-2 rounded-lg text-xs font-black transition-all cursor-pointer"
            :class="activeTab === 'orders' ? 'bg-slate-800 text-emerald-400 shadow border border-white/[0.02]' : 'text-slate-500 hover:text-slate-300'">
            常規醫囑 <span class="text-2xs font-mono opacity-70 ml-1 font-bold">({{ parse(selected.treatment_orders).length }})</span>
          </button>
        </nav>

        <!-- Tab Content -->
        <div class="flex-1 flex flex-col min-h-0 space-y-4">
          <!-- Workup -->
          <div v-if="activeTab === 'workup'" class="bg-slate-950/40 border border-white/5 rounded-2xl p-5 flex flex-col flex-1 overflow-hidden shadow-inner">
            <p class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-4">入院需開 Labs / 影像</p>
            <div class="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              <div v-for="(o, i) in parse(selected.workup)" :key="i"
                class="flex items-start gap-3 text-slate-300 text-xs font-mono bg-slate-950/60 border border-white/[0.03] rounded-xl px-4 py-3 hover:border-white/10 transition-colors">
                <span class="text-slate-600 text-xs font-bold pt-0.5 w-5 shrink-0 select-none">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="leading-relaxed">{{ o }}</span>
              </div>
              <div v-if="parse(selected.workup).length === 0" class="text-slate-500 text-xs italic text-center py-12">
                尚無 Workup，點「✏️ 編輯」新增
              </div>
            </div>
          </div>

          <!-- 會診流程 -->
          <div v-if="activeTab === 'consult'" class="bg-slate-950/40 border border-white/5 rounded-2xl p-5 flex flex-col flex-1 overflow-hidden shadow-inner">
            <p class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-4">會診科別與流程說明</p>
            <div class="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
              <div v-if="selected.consult_flow" class="space-y-3">
                <div v-for="(line, i) in (selected.consult_flow ?? '').split('\n').filter(l => l.trim())" :key="i"
                  class="flex items-start gap-4 text-slate-300 text-xs">
                  <span class="shrink-0 w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-2xs flex items-center justify-center font-bold font-mono mt-0.5">
                    {{ i + 1 }}
                  </span>
                  <span class="leading-relaxed font-bold pt-0.5">{{ line }}</span>
                </div>
              </div>
              <div v-else class="text-slate-500 text-xs italic text-center py-12">
                尚無會診流程，點「✏️ 編輯」新增
              </div>
            </div>
          </div>

          <!-- 常規醫囑 -->
          <div v-if="activeTab === 'orders'" class="bg-slate-950/40 border border-white/5 rounded-2xl p-5 flex flex-col flex-1 overflow-hidden shadow-inner">
            <p class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-4">常規入院醫囑參考</p>
            <div class="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              <div v-for="(o, i) in parse(selected.treatment_orders)" :key="i"
                class="flex items-start gap-3 text-slate-300 text-xs font-mono bg-slate-950/60 border border-white/[0.03] rounded-xl px-4 py-3 hover:border-white/10 transition-colors">
                <span class="text-slate-600 text-xs font-bold pt-0.5 w-5 shrink-0 select-none">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="leading-relaxed">{{ o }}</span>
              </div>
              <div v-if="parse(selected.treatment_orders).length === 0" class="text-slate-500 text-xs italic text-center py-12">
                尚無常規醫囑，點「✏️ 編輯」新增
              </div>
            </div>
          </div>

          <!-- 備註 -->
          <div v-if="selected.notes" class="bg-slate-950/30 border border-white/5 rounded-2xl p-4 shrink-0 shadow-md">
            <p class="text-3xs font-black text-slate-500 uppercase tracking-widest font-mono mb-2">備註說明 / 注意事項</p>
            <p class="text-slate-300 text-xs leading-relaxed whitespace-pre-line font-bold">{{ selected.notes }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Modal：新增 / 編輯疾病 ────────────────── -->
    <Teleport to="body">
      <div v-if="showModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
        @click.self="showModal = false">
        <div class="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] text-slate-100 overflow-hidden">
          <div class="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0 bg-slate-950/30">
            <h3 class="text-xs font-black uppercase tracking-widest font-mono text-slate-200">
              {{ modalMode === "add" ? "新增疾病入院流程" : "編輯疾病入院流程" }}
            </h3>
            <button @click="showModal = false" class="text-slate-500 hover:text-slate-200 text-xl leading-none cursor-pointer">×</button>
          </div>
          
          <div class="overflow-y-auto px-6 py-5 space-y-4 flex-1 custom-scrollbar">
            <div class="flex gap-4">
              <div class="flex-1">
                <label class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono block mb-1.5">疾病 / 入院診斷 <span class="text-rose-400">*</span></label>
                <input v-model="form.name"
                  class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-emerald-500/50 font-bold"
                  placeholder="如：急性闌尾炎、膽管炎、腸阻塞" />
              </div>
              <div class="w-32">
                <label class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono block mb-1.5">ICD-10</label>
                <input v-model="form.icd10"
                  class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs font-mono outline-none focus:border-emerald-500/50 font-bold"
                  placeholder="如：K37" />
              </div>
              <div class="w-32">
                <label class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono block mb-1.5">科別</label>
                <input v-model="form.category"
                  class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-emerald-500/50 font-bold"
                  placeholder="一般外科" />
              </div>
            </div>

            <!-- Workup + 常規醫囑 並排 -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono block mb-1.5">入院 Workup（每行一筆）</label>
                <textarea v-model="form.workup" rows="10"
                  placeholder="CBC+DC&#10;BMP&#10;LFT, amylase, lipase&#10;CXR&#10;Abdominal CT with contrast&#10;…"
                  class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs font-mono outline-none focus:border-emerald-500/50 resize-none custom-scrollbar font-medium" />
              </div>
              <div>
                <label class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono block mb-1.5">常規醫囑（每行一筆）</label>
                <textarea v-model="form.treatment_orders" rows="10"
                  placeholder="NPO&#10;IV access, NS 1L bolus&#10;Morphine 2mg IV prn pain&#10;…"
                  class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs font-mono outline-none focus:border-emerald-500/50 resize-none custom-scrollbar font-medium" />
              </div>
            </div>

            <!-- 會診流程 -->
            <div>
              <label class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono block mb-1.5">會診流程（每行一步）</label>
              <textarea v-model="form.consult_flow" rows="4"
                placeholder="1. 先電話通知 Anesthesia 評估手術風險&#10;2. 視 CT 結果決定是否需要 IR 介入&#10;3. 若 Bilirubin > 5，加會 GI/ERCP&#10;…"
                class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-emerald-500/50 resize-none custom-scrollbar font-medium" />
            </div>

            <div>
              <label class="text-slate-500 text-2xs font-black uppercase tracking-widest font-mono block mb-1.5">備註</label>
              <textarea v-model="form.notes" rows="2"
                class="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-slate-200 text-xs outline-none focus:border-emerald-500/50 resize-none custom-scrollbar font-medium" />
            </div>
          </div>
          
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-white/5 shrink-0 bg-slate-950/30">
            <button @click="showModal = false" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl cursor-pointer">取消</button>
            <button @click="save" :disabled="!form.name.trim()"
              class="px-5 py-2 bg-emerald-600 border border-emerald-500/30 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/10 cursor-pointer">
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
