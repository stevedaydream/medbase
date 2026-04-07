<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";

interface Contact {
  id: number;
  label: string;
  ext: string;
  category: string;
  notes: string | null;
}

const contacts  = ref<Contact[]>([]);
const search    = ref("");
const catFilter = ref("全部");
const toast     = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// Modal
const showModal  = ref(false);
const modalMode  = ref<"add" | "edit">("add");
const form       = ref<Partial<Contact>>({});
const showConfirm = ref(false);
const deleteTarget = ref<Contact | null>(null);

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

async function load() {
  const db = await getDb();
  contacts.value = await db.select<Contact[]>(
    "SELECT * FROM contacts ORDER BY category, label"
  );
}

// 一次性遷移：把醫師通訊錄的院內分機搬到 contacts（排除主治醫師）
async function migratePhysicianExts() {
  const db = await getDb();

  // 清除先前版本可能已遷移的主治醫師條目
  await db.execute(`
    DELETE FROM contacts
    WHERE label IN (SELECT name FROM physicians WHERE title = '主治醫師')
  `);

  // 只遷移非主治醫師的院內分機（如護理師、住院醫師、行政等）
  const staff = await db.select<{ name: string; ext: string; department: string | null }[]>(
    "SELECT name, ext, department FROM physicians WHERE ext IS NOT NULL AND TRIM(ext) != '' AND (title IS NULL OR title != '主治醫師')"
  );

  let migrated = 0;
  for (const p of staff) {
    const exists = await db.select<{ c: number }[]>(
      "SELECT COUNT(*) as c FROM contacts WHERE label=? AND ext=?",
      [p.name, p.ext]
    );
    if (exists[0].c > 0) continue;
    await db.execute(
      "INSERT INTO contacts (label, ext, category) VALUES (?,?,?)",
      [p.name, p.ext, p.department?.trim() || "院內分機"]
    );
    migrated++;
  }

  // 清空已遷移者的 ext（不動主治醫師，他們的 ext 保留供參考）
  await db.execute(`
    UPDATE physicians SET ext = NULL
    WHERE ext IS NOT NULL AND (title IS NULL OR title != '主治醫師')
  `);

  if (migrated > 0) showToast(`已從醫師通訊錄匯入 ${migrated} 筆分機資料`);
}

onMounted(async () => {
  await migratePhysicianExts();
  await load();
});

// 所有分類（動態）
const categories = computed(() => {
  const cats = new Set(contacts.value.map(c => c.category || "常用分機"));
  return ["全部", ...Array.from(cats).sort()];
});

const filtered = computed(() => {
  let list = contacts.value;
  if (catFilter.value !== "全部") {
    list = list.filter(c => (c.category || "常用分機") === catFilter.value);
  }
  const q = search.value.trim().toLowerCase();
  if (q) {
    list = list.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.ext.includes(q) ||
      (c.category || "").toLowerCase().includes(q) ||
      (c.notes || "").toLowerCase().includes(q)
    );
  }
  return list;
});

// 依分類分組顯示
const grouped = computed(() => {
  const map = new Map<string, Contact[]>();
  for (const c of filtered.value) {
    const cat = c.category || "常用分機";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(c);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "zh-TW"));
});

function copyExt(ext: string) {
  navigator.clipboard.writeText(ext);
  showToast(`已複製：${ext}`);
}

// ── CRUD ─────────────────────────────────────────────────────────
function openAdd() {
  modalMode.value = "add";
  form.value = { category: catFilter.value !== "全部" ? catFilter.value : "常用分機" };
  showModal.value = true;
}

function openEdit(c: Contact) {
  modalMode.value = "edit";
  form.value = { ...c };
  showModal.value = true;
}

function confirmDelete(c: Contact) {
  deleteTarget.value = c;
  showConfirm.value = true;
}

async function save() {
  const f = form.value;
  if (!f.label?.trim() || !f.ext?.trim()) return;
  const db = await getDb();
  if (modalMode.value === "add") {
    await db.execute(
      "INSERT INTO contacts (label, ext, category, notes) VALUES (?,?,?,?)",
      [f.label.trim(), f.ext.trim(), f.category?.trim() || "常用分機", f.notes || null]
    );
  } else {
    await db.execute(
      "UPDATE contacts SET label=?, ext=?, category=?, notes=? WHERE id=?",
      [f.label.trim(), f.ext.trim(), f.category?.trim() || "常用分機", f.notes || null, f.id]
    );
  }
  showModal.value = false;
  await load();
  showToast(modalMode.value === "add" ? "已新增" : "已儲存");
}

async function doDelete() {
  if (!deleteTarget.value) return;
  const db = await getDb();
  await db.execute("DELETE FROM contacts WHERE id=?", [deleteTarget.value.id]);
  showConfirm.value = false;
  deleteTarget.value = null;
  await load();
  showToast("已刪除");
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">

    <!-- Header -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-800 shrink-0">
      <input
        v-model="search"
        placeholder="搜尋分機名稱、號碼…"
        class="flex-1 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      <button
        @click="openAdd"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors shrink-0"
      >
        <span>＋</span> 新增
      </button>
    </div>

    <!-- Category filter -->
    <div class="flex gap-1.5 px-5 py-2.5 border-b border-gray-800 overflow-x-auto shrink-0">
      <button
        v-for="cat in categories" :key="cat"
        @click="catFilter = cat"
        class="px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap"
        :class="catFilter === cat
          ? 'bg-blue-600 text-white'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'"
      >{{ cat }}</button>
    </div>

    <!-- List -->
    <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">

      <div v-if="filtered.length === 0" class="text-center text-gray-600 py-16">
        <div class="text-4xl mb-3">📞</div>
        <p class="text-sm">無資料，按「＋ 新增」建立常用分機</p>
      </div>

      <div v-for="[cat, items] in grouped" :key="cat">
        <!-- Category header -->
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">{{ cat }}</span>
          <span class="text-xs text-gray-700 font-mono">{{ items.length }}</span>
          <div class="flex-1 border-t border-gray-800"></div>
        </div>

        <!-- Contact cards -->
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <div
            v-for="c in items" :key="c.id"
            class="group flex flex-col justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-700 transition-colors"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="text-sm text-gray-200 font-medium leading-snug">{{ c.label }}</span>
              <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button @click="openEdit(c)"   class="text-xs text-blue-400 hover:text-blue-300 px-1">編</button>
                <button @click="confirmDelete(c)" class="text-xs text-red-500 hover:text-red-400 px-1">刪</button>
              </div>
            </div>

            <div class="mt-2 flex items-center justify-between">
              <button
                @click="copyExt(c.ext)"
                class="font-mono text-lg font-bold text-blue-400 hover:text-blue-300 tracking-widest transition-colors"
                title="點擊複製"
              >{{ c.ext }}</button>
              <span class="text-[10px] text-gray-700">點擊複製</span>
            </div>

            <p v-if="c.notes" class="mt-1.5 text-xs text-gray-500 truncate">{{ c.notes }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="slide-up">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-full shadow-lg z-50">
        {{ toast }}
      </div>
    </Transition>

  </div>

  <!-- ── Add / Edit Modal ────────────────────────────── -->
  <Teleport to="body">
    <div v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="showModal = false"
    >
      <div class="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 class="font-semibold text-gray-100">{{ modalMode === "add" ? "新增" : "編輯" }}分機</h3>
          <button @click="showModal = false" class="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>
        <div class="px-5 py-4 space-y-3">
          <div>
            <label class="text-xs text-gray-500 mb-1 block">名稱 *</label>
            <input v-model="form.label" autofocus
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
              placeholder="護理站、值班室、藥局…" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">分機號碼 *</label>
            <input v-model="form.ext"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm font-mono focus:outline-none focus:border-blue-500"
              placeholder="12345" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">分類</label>
            <input v-model="form.category"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
              placeholder="常用分機" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">備註</label>
            <input v-model="form.notes"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-gray-500"
              placeholder="選填" />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button @click="showModal = false" class="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800">取消</button>
          <button @click="save" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">儲存</button>
        </div>
      </div>
    </div>

    <!-- Confirm delete -->
    <div v-if="showConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="showConfirm = false"
    >
      <div class="w-full max-w-xs bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl p-5 text-center">
        <p class="text-gray-200 mb-1">確定刪除？</p>
        <p class="text-sm text-gray-500 mb-5">「{{ deleteTarget?.label }}」{{ deleteTarget?.ext }}</p>
        <div class="flex gap-3 justify-center">
          <button @click="showConfirm = false" class="px-4 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">取消</button>
          <button @click="doDelete" class="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium">刪除</button>
        </div>
      </div>
    </div>
  </Teleport>

</template>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.2s ease; }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
