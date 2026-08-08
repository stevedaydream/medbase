<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { markLocalModified, saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { useLogger } from "@/composables/useLogger";

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
  await markLocalModified("examination");
  pushToCloud().catch(() => {});
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
    const res = await fetch(cloud.gasUrl, {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveExamination", data: items.value }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 錯誤");
    toast(`已上傳 ${items.value.length} 筆至雲端`);
    await saveSyncTimestamp("examination");
    useLogger().addLog("info", `[雲端同步] push 檢查處置 — ${items.value.length} 筆`, JSON.stringify({ table: "examination", action: "push", timestamp: new Date().toISOString() }));
  } catch (e) {
    toast(`上傳失敗：${(e as Error).message}`);
    useLogger().addLog("warn", "[雲端同步] push 檢查處置 失敗", String(e));
  }
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
  <div class="accent-teal flex gap-6 h-full text-fg select-none bg-sunken">

    <!-- ── 左側列表 ─────────────────────────────── -->
    <div class="flex flex-col w-80 shrink-0 bg-surface border border-hairline rounded-2xl p-4 shadow-xl overflow-hidden">
      <div class="flex gap-2 mb-3 shrink-0">
        <input v-model="search" placeholder="搜尋檢查名稱、HIS 代碼…"
          class="flex-1 px-3 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs placeholder-muted outline-none focus:border-accent/50 font-bold" />
        <button @click="openAdd"
          class="w-10 h-10 flex items-center justify-center rounded-xl bg-accent hover:bg-accent border border-accent/30 text-white text-lg font-bold transition-all active:scale-95 shadow-lg shadow-accent/10 cursor-pointer"
          title="新增 HIS 開單備忘">＋</button>
      </div>
      
      <div class="flex items-center justify-between px-1.5 mb-3 shrink-0">
        <span class="text-muted text-2xs font-black uppercase tracking-widest font-mono">{{ filtered.length }} EXAMINATIONS</span>
        <div class="flex gap-1">
          <button @click="pullFromCloud" :disabled="isSyncing"
            class="text-2xs font-bold px-2.5 py-1.5 rounded-lg border border-accent/30 text-accent hover:border-indigo-500 hover:bg-accent/10 disabled:opacity-40 transition-colors cursor-pointer">
            {{ isSyncing ? "…" : "↓ 同步" }}
          </button>
          <button @click="pushToCloud" :disabled="isSyncing"
            class="text-2xs font-bold px-2.5 py-1.5 rounded-lg border border-hairline bg-elevated text-fg-secondary hover:text-fg disabled:opacity-40 transition-colors cursor-pointer">
            {{ isSyncing ? "…" : "↑ 上傳" }}
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
        <div v-if="filtered.length === 0" class="text-muted text-xs italic text-center py-12">無資料</div>
        <button v-for="m in filtered" :key="m.id" @click="selected = m"
          class="w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer group"
          :class="selected?.id === m.id 
            ? 'bg-accent/20 border-accent/50 text-white shadow-[0_0_15px_rgba(168,85,247,0.08)]' 
            : 'bg-sunken border-hairline text-fg-secondary hover:border-hairline hover:text-fg hover:bg-surface/30'">
          <div class="flex items-center gap-2">
            <span class="font-bold text-xs truncate flex-1">{{ m.name }}</span>
            <span v-if="m.his_code"
              class="text-2xs font-mono shrink-0 opacity-70 bg-sunken px-1.5 py-0.5 rounded border border-hairline text-fg-secondary font-bold">
              {{ m.his_code }}
            </span>
          </div>
          <div class="text-2xs font-mono mt-1 opacity-65">{{ m.category }}</div>
        </button>
      </div>
    </div>

    <!-- ── 右側詳情 ─────────────────────────────── -->
    <div class="flex-1 rounded-2xl bg-surface border border-hairline p-6 overflow-y-auto flex flex-col shadow-xl">
      <div v-if="!selected" class="flex-1 flex flex-col items-center justify-center gap-3 text-muted py-12">
        <span class="text-4xl animate-pulse">🔬</span>
        <p class="text-xs font-black">請選擇檢查項目，或點擊 ＋ 新增</p>
        <span class="text-2xs text-center text-muted max-w-xs mt-1 leading-relaxed">
          收錄 HIS 代碼、特殊開法、需搭配的項目、預約限制等細節。
        </span>
      </div>
      <div v-else class="space-y-6 flex-1 flex flex-col">
        <!-- Detail Header -->
        <div class="flex items-start justify-between border-b border-hairline pb-4 shrink-0">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-base font-black text-fg tracking-wider">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-2 flex-wrap font-mono">
              <span v-if="selected.category" class="text-2xs font-black uppercase bg-accent/10 border border-accent/30 text-accent px-2 py-0.5 rounded-full">{{ selected.category }}</span>
              <span v-if="selected.indication" class="text-fg-secondary text-xs font-bold">{{ selected.indication }}</span>
            </div>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <button @click="copyTips"
              class="px-3.5 py-2 rounded-xl border border-hairline bg-sunken hover:bg-elevated text-fg-secondary text-xs font-bold transition-all active:scale-95 cursor-pointer">📋 複製備忘</button>
            <button @click="openEdit"
              class="px-3.5 py-2 rounded-xl border border-hairline bg-sunken hover:bg-elevated text-fg-secondary text-xs font-bold transition-all active:scale-95 cursor-pointer">✏️ 編輯</button>
            <button @click="showDeleteConfirm = true"
              class="px-3.5 py-2 rounded-xl border border-danger/30 bg-danger/20 hover:bg-danger/30 text-danger text-xs font-bold transition-all active:scale-95 cursor-pointer">🗑 刪除</button>
          </div>
        </div>

        <!-- HIS 代碼區塊 -->
        <div v-if="selected.his_code"
          class="shrink-0 flex items-center justify-between bg-accent/20 border border-accent/30 rounded-2xl px-5 py-4 shadow-lg">
          <div>
            <p class="text-accent text-2xs font-black mb-1">HIS 系統代碼</p>
            <p class="text-accent text-lg font-mono font-black tracking-wider">{{ selected.his_code }}</p>
          </div>
          <button @click="copyCode"
            class="px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-md"
            :class="codeCopied
              ? 'bg-emerald-600 text-white shadow-success/10 border border-success/20'
              : 'bg-accent/60 text-accent border border-accent/20 hover:bg-accent/60'">
            {{ codeCopied ? '✓ 已複製' : '複製代碼' }}
          </button>
        </div>

        <!-- 開單注意事項 -->
        <div class="bg-sunken border border-hairline rounded-2xl p-5 flex flex-col flex-1 overflow-hidden shadow-inner">
          <p class="text-2xs font-black text-muted mb-4">開單注意事項</p>
          <div class="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            <div v-for="(tip, i) in parseTips(selected.orders)" :key="i"
              class="flex items-start gap-3 text-fg-secondary text-xs font-mono bg-sunken border border-hairline rounded-xl px-4 py-3 hover:border-hairline transition-colors">
              <span class="text-accent text-xs font-bold pt-0.5 w-5 shrink-0 select-none">▸</span>
              <span class="leading-relaxed">{{ tip }}</span>
            </div>
            <div v-if="parseTips(selected.orders).length === 0" class="text-muted text-xs italic text-center py-12">
              尚無注意事項，點「✏️ 編輯」新增
            </div>
          </div>
        </div>

        <!-- 備註 -->
        <div v-if="selected.notes" class="bg-sunken border border-hairline rounded-2xl p-4 shrink-0 shadow-md">
          <p class="text-xs font-black text-muted mb-2">備註說明 / 注意事項</p>
          <p class="text-fg-secondary text-xs leading-relaxed whitespace-pre-line font-bold">{{ selected.notes }}</p>
        </div>
      </div>
    </div>

    <!-- ── Modal：新增 / 編輯 ──────────────────── -->
    <Teleport to="body">
      <div v-if="showModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
        @click.self="showModal = false">
        <div class="w-full max-w-lg bg-surface border border-hairline rounded-2xl shadow-2xl flex flex-col max-h-[90vh] text-fg overflow-hidden">
          <div class="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0 bg-sunken">
            <h3 class="text-xs font-black text-fg">
              {{ modalMode === "add" ? "新增 HIS 開單備忘" : "編輯 HIS 開單備忘" }}
            </h3>
            <button @click="showModal = false" class="text-muted hover:text-fg text-xl leading-none cursor-pointer">×</button>
          </div>
          
          <div class="overflow-y-auto px-6 py-5 space-y-4 flex-1 custom-scrollbar">
            <div>
              <label class="text-muted text-2xs font-black block mb-1.5">檢查名稱 <span class="text-danger">*</span></label>
              <input v-model="form.name"
                class="w-full px-3 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs outline-none focus:border-accent/50 font-bold"
                placeholder="如：MRCP、無痛大腸鏡、Frozen Section" />
            </div>
            
            <div>
              <label class="text-accent text-2xs font-black block mb-1.5 font-bold">HIS 系統代碼 ★</label>
              <input v-model="form.his_code"
                class="w-full px-3 py-2 bg-accent/40 border border-accent/60 rounded-xl text-accent text-xs font-mono outline-none focus:border-accent"
                placeholder="如：R2-7 #201、R7401+R602、電話預約" />
            </div>
            
            <div class="flex gap-4">
              <div class="flex-1">
                <label class="text-muted text-2xs font-black block mb-1.5">分類</label>
                <input v-model="form.category"
                  class="w-full px-3 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs outline-none focus:border-accent/50 font-bold"
                  placeholder="如：影像、內視鏡、病理、核醫" />
              </div>
              <div class="flex-1">
                <label class="text-muted text-2xs font-black block mb-1.5">適應症 / 說明</label>
                <input v-model="form.indication"
                  class="w-full px-3 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs outline-none focus:border-accent/50 font-bold"
                  placeholder="如：膽道疾病評估" />
              </div>
            </div>
            
            <div>
              <label class="text-muted text-2xs font-black block mb-1.5">
                開單注意事項（每行一條）
                <span class="text-muted font-bold ml-2">({{ tipCount }} 條)</span>
              </label>
              <textarea v-model="form.orders" rows="7"
                placeholder="無痛需同時開 R7401 + R602&#10;需會診麻醉科後才可執行&#10;禁食 6 小時以上&#10;…"
                class="w-full px-3 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs outline-none focus:border-accent/50 resize-none custom-scrollbar font-medium" />
            </div>
            
            <div>
              <label class="text-muted text-2xs font-black block mb-1.5">備註（時間限制、預約方式等）</label>
              <textarea v-model="form.notes" rows="2"
                placeholder="如：一三五才可預約 Frozen；需先打電話到病理科（分機 3456）"
                class="w-full px-3 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs outline-none focus:border-accent/50 resize-none custom-scrollbar font-medium" />
            </div>
          </div>
          
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-hairline shrink-0 bg-sunken">
            <button @click="showModal = false" class="px-4 py-2 bg-elevated hover:bg-raised text-fg-secondary text-xs font-bold rounded-xl cursor-pointer">取消</button>
            <button @click="save" :disabled="!form.name.trim()"
              class="px-5 py-2 bg-accent border border-accent/30 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-accent/10 cursor-pointer">
              儲存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 刪除確認 ───────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
        @click.self="showDeleteConfirm = false">
        <div class="bg-surface border border-hairline rounded-2xl shadow-2xl p-6 w-full max-w-sm text-fg">
          <p class="font-bold text-sm mb-1 text-fg">確認刪除</p>
          <p class="text-fg-secondary text-xs mb-5 font-medium">確定刪除「{{ selected?.name }}」？此操作無法復原。</p>
          <div class="flex justify-end gap-3">
            <button @click="showDeleteConfirm = false" class="px-4 py-2 bg-elevated hover:bg-raised text-fg-secondary text-xs font-bold rounded-xl cursor-pointer">取消</button>
            <button @click="deleteSelected" class="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl cursor-pointer">確定刪除</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-surface/90 border border-hairline text-fg text-xs font-bold rounded-2xl shadow-2xl pointer-events-none z-50 backdrop-blur-md">
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
