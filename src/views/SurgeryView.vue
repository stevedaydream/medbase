<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";

interface Surgery {
  id: number; name: string; category: string; indication: string;
  pre_op_orders: string; post_op_orders: string; notes: string;
}
interface Form {
  name: string; category: string; indication: string;
  pre_op_orders: string; post_op_orders: string; notes: string;
}

const items    = ref<Surgery[]>([]);
const search   = ref("");
const selected = ref<Surgery | null>(null);
const activeTab = ref<"pre" | "post">("pre");
const showModal = ref(false);
const modalMode = ref<"add" | "edit">("add");
const form = ref<Form>({ name: "", category: "", indication: "", pre_op_orders: "", post_op_orders: "", notes: "" });
const showDeleteConfirm = ref(false);

onMounted(async () => { await reload(); });

async function reload() {
  const db = await getDb();
  items.value = await db.select<Surgery[]>(
    "SELECT * FROM surgery ORDER BY category, name"
  );
}

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  if (!q) return items.value;
  return items.value.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    (m.category ?? "").toLowerCase().includes(q)
  );
});

function parse(s: string | null): string[] {
  try { return JSON.parse(s ?? "[]") ?? []; } catch { return []; }
}

function copyOrders() {
  if (!selected.value) return;
  const orders = activeTab.value === "pre" ? selected.value.pre_op_orders : selected.value.post_op_orders;
  navigator.clipboard.writeText(parse(orders).join("\n"));
}

function openAdd() {
  modalMode.value = "add";
  form.value = { name: "", category: "", indication: "", pre_op_orders: "", post_op_orders: "", notes: "" };
  showModal.value = true;
}

function openEdit() {
  if (!selected.value) return;
  modalMode.value = "edit";
  form.value = {
    name:           selected.value.name ?? "",
    category:       selected.value.category ?? "",
    indication:     selected.value.indication ?? "",
    pre_op_orders:  parse(selected.value.pre_op_orders).join("\n"),
    post_op_orders: parse(selected.value.post_op_orders).join("\n"),
    notes:          selected.value.notes ?? "",
  };
  showModal.value = true;
}

async function save() {
  const db = await getDb();
  const toJson = (s: string) => JSON.stringify(s.split("\n").map((l) => l.trim()).filter(Boolean));
  if (modalMode.value === "add") {
    await db.execute(
      "INSERT INTO surgery (name, category, indication, pre_op_orders, post_op_orders, notes) VALUES (?,?,?,?,?,?)",
      [form.value.name, form.value.category, form.value.indication,
       toJson(form.value.pre_op_orders), toJson(form.value.post_op_orders), form.value.notes]
    );
  } else {
    await db.execute(
      "UPDATE surgery SET name=?, category=?, indication=?, pre_op_orders=?, post_op_orders=?, notes=? WHERE id=?",
      [form.value.name, form.value.category, form.value.indication,
       toJson(form.value.pre_op_orders), toJson(form.value.post_op_orders), form.value.notes, selected.value!.id]
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
  await db.execute("DELETE FROM surgery WHERE id=?", [selected.value.id]);
  selected.value = null;
  showDeleteConfirm.value = false;
  await reload();
}

const preCount  = computed(() => form.value.pre_op_orders.split("\n").filter((s) => s.trim()).length);
const postCount = computed(() => form.value.post_op_orders.split("\n").filter((s) => s.trim()).length);
</script>

<template>
  <div class="flex gap-4 h-full">

    <!-- ── 左側列表 ─────────────────────────────── -->
    <div class="flex flex-col w-72 shrink-0">
      <div class="flex gap-2 mb-3">
        <input v-model="search" placeholder="搜尋術式名稱、科別…"
          class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500" />
        <button @click="openAdd"
          class="px-3 rounded-lg bg-orange-600 text-white text-lg hover:bg-orange-500 transition-colors shrink-0"
          title="新增術前後常規">＋</button>
      </div>
      <p class="text-gray-600 text-xs mb-2 px-1">{{ filtered.length }} 筆</p>
      <div class="flex-1 overflow-y-auto space-y-1">
        <div v-if="filtered.length === 0" class="text-gray-500 text-sm text-center py-8">無資料</div>
        <button v-for="m in filtered" :key="m.id"
          @click="selected = m; activeTab = 'pre'"
          class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors"
          :class="selected?.id === m.id ? 'bg-orange-600 text-white' : 'text-gray-300 hover:bg-gray-800'">
          <div class="font-medium truncate">{{ m.name }}</div>
          <div class="text-xs opacity-60 mt-0.5 truncate">{{ m.category }}</div>
        </button>
      </div>
    </div>

    <!-- ── 右側詳情 ─────────────────────────────── -->
    <div class="flex-1 rounded-xl bg-gray-900 border border-gray-800 p-5 overflow-y-auto">
      <div v-if="!selected" class="flex flex-col items-center justify-center h-full gap-2 text-gray-600 text-sm">
        <span class="text-3xl">🔪</span>
        <span>選擇術式，或按 ＋ 新增</span>
        <span class="text-xs text-center text-gray-700 max-w-xs mt-1">收錄各術式術前禁食/備血/consent、術後引流/換藥/飲食等 Order Set</span>
      </div>
      <div v-else>
        <div class="flex items-start justify-between mb-4">
          <div class="min-w-0 flex-1 mr-4">
            <h2 class="text-xl font-semibold text-white truncate">{{ selected.name }}</h2>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              <span v-if="selected.category"
                class="text-xs bg-orange-900/50 text-orange-300 px-2 py-0.5 rounded-full">{{ selected.category }}</span>
              <span v-if="selected.indication" class="text-gray-400 text-sm">{{ selected.indication }}</span>
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            <button @click="copyOrders"
              class="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 transition-colors">📋 複製</button>
            <button @click="openEdit"
              class="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 text-xs hover:bg-gray-600 transition-colors">✏️ 編輯</button>
            <button @click="showDeleteConfirm = true"
              class="px-3 py-1.5 rounded-lg bg-red-900/40 text-red-400 text-xs hover:bg-red-900/70 transition-colors">🗑</button>
          </div>
        </div>

        <!-- Tab -->
        <div class="flex gap-2 mb-4">
          <button @click="activeTab = 'pre'"
            class="px-4 py-1.5 rounded-lg text-sm transition-colors"
            :class="activeTab === 'pre' ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'">
            術前常規 <span class="text-xs opacity-70 ml-1">{{ parse(selected.pre_op_orders).length }}</span>
          </button>
          <button @click="activeTab = 'post'"
            class="px-4 py-1.5 rounded-lg text-sm transition-colors"
            :class="activeTab === 'post' ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'">
            術後常規 <span class="text-xs opacity-70 ml-1">{{ parse(selected.post_op_orders).length }}</span>
          </button>
        </div>

        <div class="bg-gray-800 rounded-lg p-4">
          <p class="text-gray-500 text-xs mb-3 uppercase tracking-wide">
            {{ activeTab === 'pre' ? '術前醫囑' : '術後醫囑' }}
          </p>
          <ul class="space-y-1.5">
            <li v-for="(o, i) in parse(activeTab === 'pre' ? selected.pre_op_orders : selected.post_op_orders)"
              :key="i"
              class="flex items-start gap-2 text-gray-200 text-sm font-mono bg-gray-900 rounded px-3 py-1.5">
              <span class="text-gray-600 text-xs pt-0.5 w-5 shrink-0 select-none">{{ i + 1 }}</span>
              <span>{{ o }}</span>
            </li>
            <li v-if="parse(activeTab === 'pre' ? selected.pre_op_orders : selected.post_op_orders).length === 0"
              class="text-gray-600 text-sm text-center py-6">
              尚無醫囑，點「✏️ 編輯」新增
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
            <h3 class="text-white font-semibold">{{ modalMode === "add" ? "新增術前後常規" : "編輯術前後常規" }}</h3>
            <button @click="showModal = false" class="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
          </div>
          <div class="overflow-y-auto px-5 py-4 space-y-4 flex-1">
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="text-gray-400 text-xs block mb-1">術式名稱 <span class="text-red-400">*</span></label>
                <input v-model="form.name"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="如：腹腔鏡膽囊切除、TKA、右半大腸切除" />
              </div>
              <div class="w-36">
                <label class="text-gray-400 text-xs block mb-1">科別</label>
                <input v-model="form.category"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="如：一般外科" />
              </div>
            </div>
            <div>
              <label class="text-gray-400 text-xs block mb-1">備註說明</label>
              <input v-model="form.indication"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-orange-500"
                placeholder="如：限擇期手術，急診另行修改" />
            </div>
            <!-- 術前/術後並排 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-gray-400 text-xs block mb-1">
                  術前常規（每行一筆）
                  <span class="text-gray-600 ml-1">{{ preCount }}</span>
                </label>
                <textarea v-model="form.pre_op_orders" rows="12"
                  placeholder="NPO after midnight&#10;備血 2U PRBC&#10;Cefazolin 1g IV 於切皮前30min&#10;Consent signed&#10;…"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-orange-500 resize-none" />
              </div>
              <div>
                <label class="text-gray-400 text-xs block mb-1">
                  術後常規（每行一筆）
                  <span class="text-gray-600 ml-1">{{ postCount }}</span>
                </label>
                <textarea v-model="form.post_op_orders" rows="12"
                  placeholder="Diet: NPO → 清流 → 軟食&#10;Foley keep&#10;JP drain keep, record output&#10;Cefazolin 1g IV q8h x 3 doses&#10;…"
                  class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-orange-500 resize-none" />
              </div>
            </div>
            <div>
              <label class="text-gray-400 text-xs block mb-1">備註</label>
              <textarea v-model="form.notes" rows="2"
                class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-orange-500 resize-none" />
            </div>
          </div>
          <div class="flex justify-end gap-3 px-5 py-4 border-t border-gray-800 shrink-0">
            <button @click="showModal = false" class="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700">取消</button>
            <button @click="save" :disabled="!form.name.trim()"
              class="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
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
