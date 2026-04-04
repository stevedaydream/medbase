<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";

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

onMounted(async () => { await reload(); });

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
}

async function deleteSelected() {
  if (!selected.value) return;
  const db = await getDb();
  await db.execute("DELETE FROM disease WHERE id=?", [selected.value.id]);
  selected.value = null;
  showDeleteConfirm.value = false;
  await reload();
}
</script>

<template>
  <div class="flex gap-4 h-full">

    <!-- ── 左側列表 ─────────────────────────────── -->
    <div class="flex flex-col w-72 shrink-0">
      <div class="flex gap-2 mb-3">
        <input v-model="search" placeholder="搜尋疾病、ICD-10…"
          class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-green-500" />
        <button @click="openAdd"
          class="px-3 rounded-lg bg-green-700 text-white text-lg hover:bg-green-600 transition-colors shrink-0"
          title="新增疾病入院流程">＋</button>
      </div>
      <p class="text-gray-600 text-xs mb-2 px-1">{{ filtered.length }} 筆</p>
      <div class="flex-1 overflow-y-auto space-y-1">
        <div v-if="filtered.length === 0" class="text-gray-500 text-sm text-center py-8">無資料</div>
        <button v-for="m in filtered" :key="m.id"
          @click="selected = m; activeTab = 'workup'"
          class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors"
          :class="selected?.id === m.id ? 'bg-green-700 text-white' : 'text-gray-300 hover:bg-gray-800'">
          <div class="font-medium truncate">{{ m.name }}</div>
          <div class="text-xs opacity-60 mt-0.5 truncate">
            <span v-if="m.icd10" class="font-mono">{{ m.icd10 }}</span>
            <span v-if="m.icd10 && m.category"> · </span>
            {{ m.category }}
          </div>
        </button>
      </div>
    </div>

    <!-- ── 右側詳情 ─────────────────────────────── -->
    <div class="flex-1 rounded-xl bg-gray-900 border border-gray-800 p-5 overflow-y-auto">
      <div v-if="!selected" class="flex flex-col items-center justify-center h-full gap-2 text-gray-600 text-sm">
        <span class="text-3xl">🦠</span>
        <span>選擇疾病，或按 ＋ 新增</span>
        <span class="text-xs text-center text-gray-700 max-w-xs mt-1">收錄入院需開哪些 Labs/影像、需會診哪科及流程、常規醫囑</span>
      </div>
      <div v-else>
        <div class="flex items-start justify-between mb-4">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-xl font-semibold text-white truncate">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              <span v-if="selected.icd10" class="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded font-mono">{{ selected.icd10 }}</span>
              <span v-if="selected.category" class="text-xs bg-green-900/50 text-green-300 px-2 py-0.5 rounded-full">{{ selected.category }}</span>
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            <button @click="copyActive"
              class="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 transition-colors">📋 複製</button>
            <button @click="openEdit"
              class="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 transition-colors">✏️ 編輯</button>
            <button @click="showDeleteConfirm = true"
              class="px-3 py-1.5 rounded-lg bg-red-900/40 text-red-400 text-xs hover:bg-red-900/70 transition-colors">🗑</button>
          </div>
        </div>

        <!-- 三個 Tab -->
        <div class="flex gap-2 mb-4">
          <button @click="activeTab = 'workup'"
            class="px-4 py-1.5 rounded-lg text-sm transition-colors"
            :class="activeTab === 'workup' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'">
            入院 Workup <span class="text-xs opacity-70 ml-1">{{ parse(selected.workup).length }}</span>
          </button>
          <button @click="activeTab = 'consult'"
            class="px-4 py-1.5 rounded-lg text-sm transition-colors"
            :class="activeTab === 'consult' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'">
            會診流程
          </button>
          <button @click="activeTab = 'orders'"
            class="px-4 py-1.5 rounded-lg text-sm transition-colors"
            :class="activeTab === 'orders' ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'">
            常規醫囑 <span class="text-xs opacity-70 ml-1">{{ parse(selected.treatment_orders).length }}</span>
          </button>
        </div>

        <!-- Workup -->
        <div v-if="activeTab === 'workup'" class="bg-gray-800 rounded-lg p-4">
          <p class="text-gray-500 text-xs mb-3 uppercase tracking-wide">入院需開 Labs / 影像</p>
          <ul class="space-y-1.5">
            <li v-for="(o, i) in parse(selected.workup)" :key="i"
              class="flex items-start gap-2 text-gray-200 text-sm font-mono bg-gray-900 rounded px-3 py-1.5">
              <span class="text-gray-600 text-xs pt-0.5 w-5 shrink-0 select-none">{{ i + 1 }}</span>
              <span>{{ o }}</span>
            </li>
            <li v-if="parse(selected.workup).length === 0" class="text-gray-600 text-sm text-center py-6">
              尚無 Workup，點「✏️ 編輯」新增
            </li>
          </ul>
        </div>

        <!-- 會診流程 -->
        <div v-if="activeTab === 'consult'" class="bg-gray-800 rounded-lg p-4">
          <p class="text-gray-500 text-xs mb-3 uppercase tracking-wide">會診流程</p>
          <div v-if="selected.consult_flow" class="space-y-2">
            <div v-for="(line, i) in (selected.consult_flow ?? '').split('\n').filter(l => l.trim())" :key="i"
              class="flex items-start gap-3 text-gray-200 text-sm">
              <span class="shrink-0 w-6 h-6 rounded-full bg-green-800/60 text-green-300 text-xs flex items-center justify-center font-bold mt-0.5">
                {{ i + 1 }}
              </span>
              <span class="leading-relaxed">{{ line }}</span>
            </div>
          </div>
          <p v-else class="text-gray-600 text-sm text-center py-6">
            尚無會診流程，點「✏️ 編輯」新增
          </p>
        </div>

        <!-- 常規醫囑 -->
        <div v-if="activeTab === 'orders'" class="bg-gray-800 rounded-lg p-4">
          <p class="text-gray-500 text-xs mb-3 uppercase tracking-wide">常規醫囑</p>
          <ul class="space-y-1.5">
            <li v-for="(o, i) in parse(selected.treatment_orders)" :key="i"
              class="flex items-start gap-2 text-gray-200 text-sm font-mono bg-gray-900 rounded px-3 py-1.5">
              <span class="text-gray-600 text-xs pt-0.5 w-5 shrink-0 select-none">{{ i + 1 }}</span>
              <span>{{ o }}</span>
            </li>
            <li v-if="parse(selected.treatment_orders).length === 0" class="text-gray-600 text-sm text-center py-6">
              尚無常規醫囑，點「✏️ 編輯」新增
            </li>
          </ul>
        </div>

        <div v-if="selected.notes" class="mt-3 bg-gray-800 rounded-lg p-3">
          <p class="text-gray-500 text-xs mb-1 uppercase tracking-wide">備註</p>
          <p class="text-gray-300 text-sm whitespace-pre-line">{{ selected.notes }}</p>
        </div>
      </div>
    </div>

    <!-- ── Modal ──────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showModal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
        @click.self="showModal = false">
        <div class="w-full max-w-2xl bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl flex flex-col max-h-[92vh]">
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
            <h3 class="text-white font-semibold">{{ modalMode === "add" ? "新增疾病入院流程" : "編輯疾病入院流程" }}</h3>
            <button @click="showModal = false" class="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
          </div>
          <div class="overflow-y-auto px-5 py-4 space-y-4 flex-1">
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-gray-400 text-xs block mb-1">疾病 / 入院診斷 <span class="text-red-400">*</span></label>
                <input v-model="form.name"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-green-500"
                  placeholder="如：急性闌尾炎、膽管炎、腸阻塞" />
              </div>
              <div class="w-32">
                <label class="text-gray-400 text-xs block mb-1">ICD-10</label>
                <input v-model="form.icd10"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-green-500"
                  placeholder="如：K37" />
              </div>
              <div class="w-28">
                <label class="text-gray-400 text-xs block mb-1">科別</label>
                <input v-model="form.category"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-green-500"
                  placeholder="一般外科" />
              </div>
            </div>

            <!-- Workup + 常規醫囑 並排 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-gray-400 text-xs block mb-1">入院 Workup（每行一筆）</label>
                <textarea v-model="form.workup" rows="10"
                  placeholder="CBC+DC&#10;BMP&#10;LFT, amylase, lipase&#10;CXR&#10;Abdominal CT with contrast&#10;…"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-green-500 resize-none" />
              </div>
              <div>
                <label class="text-gray-400 text-xs block mb-1">常規醫囑（每行一筆）</label>
                <textarea v-model="form.treatment_orders" rows="10"
                  placeholder="NPO&#10;IV access, NS 1L bolus&#10;Morphine 2mg IV prn pain&#10;…"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-green-500 resize-none" />
              </div>
            </div>

            <!-- 會診流程 -->
            <div>
              <label class="text-gray-400 text-xs block mb-1">會診流程（每行一步）</label>
              <textarea v-model="form.consult_flow" rows="5"
                placeholder="1. 先電話通知 Anesthesia 評估手術風險&#10;2. 視 CT 結果決定是否需要 IR 介入&#10;3. 若 Bilirubin > 5，加會 GI/ERCP&#10;…"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-green-500 resize-none" />
            </div>

            <div>
              <label class="text-gray-400 text-xs block mb-1">備註</label>
              <textarea v-model="form.notes" rows="2"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-green-500 resize-none" />
            </div>
          </div>
          <div class="flex justify-end gap-3 px-5 py-4 border-t border-gray-800 shrink-0">
            <button @click="showModal = false" class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700">取消</button>
            <button @click="save" :disabled="!form.name.trim()"
              class="px-4 py-2 rounded-lg bg-green-700 text-white text-sm hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
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
            <button @click="showDeleteConfirm = false" class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700">取消</button>
            <button @click="deleteSelected" class="px-4 py-2 rounded-lg bg-red-700 text-white text-sm hover:bg-red-600">確定刪除</button>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>
