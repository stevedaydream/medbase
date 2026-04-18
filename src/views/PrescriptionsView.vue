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
  <div class="flex gap-4 h-full">

    <!-- ── 左側列表 ─────────────────────────────── -->
    <div class="flex flex-col w-72 shrink-0">
      <div class="flex gap-2 mb-3">
        <input
          v-model="search"
          placeholder="搜尋藥物名稱、分類…"
          class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500"
        />
        <button @click="openAdd"
          class="px-3 rounded-lg bg-amber-600 text-white text-lg hover:bg-amber-500 transition-colors shrink-0"
          title="新增藥物配製參考">＋</button>
      </div>
      <p class="text-gray-600 text-xs mb-2 px-1">{{ filtered.length }} 筆</p>
      <div class="flex gap-1.5 mb-2">
        <button @click="pullFromCloud" :disabled="isSyncing"
          class="flex-1 py-1 rounded-lg bg-blue-800/60 text-blue-200 text-xs hover:bg-blue-700/60 disabled:opacity-40 transition-colors">
          {{ isSyncing ? "…" : "↓ 同步" }}
        </button>
        <button @click="pushToCloud" :disabled="isSyncing"
          class="flex-1 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs hover:bg-gray-600 disabled:opacity-40 transition-colors">
          {{ isSyncing ? "…" : "↑ 上傳" }}
        </button>
      </div>
      <div class="flex-1 overflow-y-auto space-y-1">
        <div v-if="filtered.length === 0" class="text-gray-500 text-sm text-center py-8">無資料</div>
        <button v-for="m in filtered" :key="m.id" @click="selected = m"
          class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors"
          :class="selected?.id === m.id ? 'bg-amber-600 text-white' : 'text-gray-300 hover:bg-gray-800'">
          <div class="font-medium truncate">{{ m.name }}</div>
          <div class="text-xs opacity-60 mt-0.5 truncate">
            {{ m.category }}{{ m.indication ? ' · ' + m.indication : '' }}
          </div>
        </button>
      </div>
    </div>

    <!-- ── 右側詳情 ─────────────────────────────── -->
    <div class="flex-1 rounded-xl bg-gray-900 border border-gray-800 p-5 overflow-y-auto">
      <div v-if="!selected" class="flex flex-col items-center justify-center h-full gap-2 text-gray-600 text-sm">
        <span class="text-3xl">💊</span>
        <span>選擇藥物配製參考，或按 ＋ 新增</span>
        <span class="text-xs text-center text-gray-700 max-w-xs mt-1">收錄 Dopamine 泡法、FOY 稀釋步驟、抗生素劑量注意事項等</span>
      </div>
      <div v-else>
        <div class="flex items-start justify-between mb-4">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-xl font-semibold text-white truncate">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-1.5 flex-wrap">
              <span v-if="selected.category"
                class="text-xs bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded-full">
                {{ selected.category }}
              </span>
              <span v-if="selected.indication" class="text-amber-200/70 text-sm font-mono">
                {{ selected.indication }}
              </span>
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            <button @click="copySteps"
              class="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 transition-colors">
              📋 複製步驟
            </button>
            <button @click="openEdit"
              class="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 transition-colors">
              ✏️ 編輯
            </button>
            <button @click="showDeleteConfirm = true"
              class="px-3 py-1.5 rounded-lg bg-red-900/40 text-red-400 text-xs hover:bg-red-900/70 transition-colors">
              🗑
            </button>
          </div>
        </div>

        <!-- 配製步驟 -->
        <div class="bg-gray-800 rounded-lg p-4">
          <p class="text-gray-500 text-xs mb-3 uppercase tracking-wide">
            配製 &amp; 給藥步驟 · {{ parseSteps(selected.orders).length }} 步
          </p>
          <ol class="space-y-2">
            <li v-for="(o, i) in parseSteps(selected.orders)" :key="i"
              class="flex items-start gap-3 text-gray-200 text-sm">
              <span class="shrink-0 w-6 h-6 rounded-full bg-amber-700/50 text-amber-300 text-xs flex items-center justify-center font-bold mt-0.5">
                {{ i + 1 }}
              </span>
              <span class="font-mono leading-relaxed">{{ o }}</span>
            </li>
            <li v-if="parseSteps(selected.orders).length === 0"
              class="text-gray-600 text-sm text-center py-6">
              尚無步驟，點「✏️ 編輯」新增
            </li>
          </ol>
        </div>

        <!-- 注意事項 -->
        <div v-if="selected.notes" class="mt-3 bg-red-950/40 border border-red-900/40 rounded-lg p-3">
          <p class="text-red-400 text-xs mb-1 uppercase tracking-wide">⚠️ 注意事項</p>
          <p class="text-red-200/80 text-sm whitespace-pre-line">{{ selected.notes }}</p>
        </div>
      </div>
    </div>

    <!-- ── Modal ──────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
        @click.self="showModal = false">
        <div class="w-full max-w-lg bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
            <h3 class="text-white font-semibold">
              {{ modalMode === "add" ? "新增藥物配製參考" : "編輯藥物配製參考" }}
            </h3>
            <button @click="showModal = false" class="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
          </div>
          <div class="overflow-y-auto px-5 py-4 space-y-4 flex-1">
            <div>
              <label class="text-gray-400 text-xs block mb-1">藥物 / 處方名稱 <span class="text-red-400">*</span></label>
              <input v-model="form.name"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-amber-500"
                placeholder="如：Dopamine、FOY、Ceftriaxone" />
            </div>
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-gray-400 text-xs block mb-1">分類</label>
                <input v-model="form.category"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-amber-500"
                  placeholder="如：升壓劑、抗生素、消化科" />
              </div>
              <div class="flex-1">
                <label class="text-gray-400 text-xs block mb-1">濃度 / 規格</label>
                <input v-model="form.indication"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-amber-500"
                  placeholder="如：200mg in 250mL NS" />
              </div>
            </div>
            <div>
              <label class="text-gray-400 text-xs block mb-1">
                配製 &amp; 給藥步驟（每行一步）
                <span class="text-gray-600 ml-2">{{ stepCount }} 步</span>
              </label>
              <textarea v-model="form.orders" rows="10"
                placeholder="取 200mg Dopamine HCl&#10;加入 250mL NS → 800mcg/mL&#10;以 5mcg/kg/min 起始，每 5min 上調 2.5mcg/kg/min&#10;最高劑量 20mcg/kg/min"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-amber-500 resize-none" />
            </div>
            <div>
              <label class="text-amber-400/80 text-xs block mb-1">⚠️ 注意事項 / 警語</label>
              <textarea v-model="form.notes" rows="3"
                placeholder="如：腎功能不全需減量；避免與 alkaline solution 混用"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-red-900/40 text-gray-100 text-sm focus:outline-none focus:border-red-500 resize-none" />
            </div>
          </div>
          <div class="flex justify-end gap-3 px-5 py-4 border-t border-gray-800 shrink-0">
            <button @click="showModal = false"
              class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700">取消</button>
            <button @click="save" :disabled="!form.name.trim()"
              class="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              儲存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── 刪除確認 ───────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
        @click.self="showDeleteConfirm = false">
        <div class="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl p-6 w-full max-w-sm">
          <p class="text-white font-semibold mb-1">確認刪除</p>
          <p class="text-gray-400 text-sm mb-5">確定刪除「{{ selected?.name }}」？此操作無法復原。</p>
          <div class="flex justify-end gap-3">
            <button @click="showDeleteConfirm = false"
              class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700">取消</button>
            <button @click="deleteSelected"
              class="px-4 py-2 rounded-lg bg-red-700 text-white text-sm hover:bg-red-600">確定刪除</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-[9999] pointer-events-none">
          {{ toastMsg }}
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
