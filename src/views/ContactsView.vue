<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { exportToXlsx, autoCloudSync, xlsxPath } from "@/composables/useXlsxSync";

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

const cloud     = useCloudSettings();
const isSyncing = ref(false);
onMounted(() => cloud.load());

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
// 加 migration flag，確保只執行一次，不再每次開頁面都清空醫師 ext
async function migratePhysicianExts() {
  const db = await getDb();

  const flagRow = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key='physician_ext_migrated'"
  );
  if (flagRow[0]?.value === "1") return;

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

  // 清空已遷移者的 ext（只執行這一次）
  await db.execute(`
    UPDATE physicians SET ext = NULL
    WHERE ext IS NOT NULL AND (title IS NULL OR title != '主治醫師')
  `);

  await db.execute(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('physician_ext_migrated', '1')"
  );

  if (migrated > 0) showToast(`已從醫師通訊錄匯入 ${migrated} 筆分機資料`);
}

// 一次性還原：把常用分機裡與 physicians.name 相符的條目移回通訊錄
// 讓常用分機只保留「非人員」的分機號（如護理站、檢查室等）
async function restorePhysicianExts() {
  const db = await getDb();
  const flag = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key='physician_ext_restored'"
  );
  if (flag[0]?.value === "1") return;

  // 找出 contacts 中 label 與某位醫師名字相符、且該醫師 ext 目前為空的條目
  const rows = await db.select<{ id: number; label: string; ext: string }[]>(`
    SELECT c.id, c.label, c.ext
    FROM contacts c
    INNER JOIN physicians p ON p.name = c.label
    WHERE (p.ext IS NULL OR p.ext = '')
  `);

  for (const r of rows) {
    await db.execute("UPDATE physicians SET ext=? WHERE name=? AND (ext IS NULL OR ext='')", [r.ext, r.label]);
    await db.execute("DELETE FROM contacts WHERE id=?", [r.id]);
  }

  await db.execute("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('physician_ext_restored','1')");
  if (rows.length > 0) showToast(`已將 ${rows.length} 筆人員分機還原至通訊錄`);
}

onMounted(async () => {
  await migratePhysicianExts();
  await restorePhysicianExts();
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
  showToast(`已複製分機：${ext}`);
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
      "INSERT INTO contacts (label, ext, category, notes, updated_at) VALUES (?,?,?,?,datetime('now','localtime'))",
      [f.label.trim(), f.ext.trim(), f.category?.trim() || "常用分機", f.notes || null]
    );
  } else {
    await db.execute(
      "UPDATE contacts SET label=?, ext=?, category=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?",
      [f.label.trim(), f.ext.trim(), f.category?.trim() || "常用分機", f.notes || null, f.id]
    );
  }
  showModal.value = false;
  await load();
  showToast(modalMode.value === "add" ? "已新增" : "已儲存");
  if (xlsxPath.value) { exportToXlsx(); autoCloudSync(); }
}

// ── 雲端同步 ─────────────────────────────────────────────────────
async function pushToCloud() {
  if (!cloud.gasUrl) { showToast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("contacts", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveContacts", data: contacts.value }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    showToast(`已上傳 ${contacts.value.length} 筆至雲端`);
  } catch (e) {
    showToast(`上傳失敗：${(e as Error).message}`);
  } finally { isSyncing.value = false; setGlobalSyncing("contacts", false); }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { showToast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("contacts", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getContacts" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const data: Omit<Contact, "id">[] = json.data;
    if (!data.length) { showToast("雲端無分機資料"); return; }
    const db = await getDb();
    // 以雲端為主全量取代（清空重建）
    await db.execute("DELETE FROM contacts");
    for (const c of data) {
      await db.execute(
        "INSERT INTO contacts (label, ext, category, notes) VALUES (?,?,?,?)",
        [c.label, c.ext, c.category || "常用分機", c.notes || null]
      );
    }
    await load();
    showToast(`已從雲端同步 ${data.length} 筆分機資料`);
  } catch (e) {
    showToast(`下載失敗：${(e as Error).message}`);
  } finally {
    isSyncing.value = false;
    setGlobalSyncing("contacts", false);
  }
}

async function doDelete() {
  if (!deleteTarget.value) return;
  const db = await getDb();
  await db.execute("DELETE FROM contacts WHERE id=?", [deleteTarget.value.id]);
  showConfirm.value = false;
  deleteTarget.value = null;
  await load();
  showToast("已刪除");
  if (xlsxPath.value) { exportToXlsx(); autoCloudSync(); }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-slate-950/20 rounded-2xl border border-white/5 shadow-2xl">

    <!-- Header / Search & Sync bar -->
    <div class="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0 bg-slate-900/30 backdrop-blur-md flex-wrap md:flex-nowrap">
      <!-- Search Input -->
      <div class="relative flex-1 min-w-[200px]">
        <span class="absolute left-3 top-3 text-slate-500 text-sm">🔍</span>
        <input
          v-model="search"
          placeholder="搜尋分機名稱、號碼、備註…"
          class="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900/50 border border-white/10 text-slate-200 text-xs placeholder-slate-600 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 transition-all font-sans"
        />
        <button v-if="search" @click="search = ''" class="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 text-lg leading-none cursor-pointer">×</button>
      </div>

      <!-- Sync actions & Add button -->
      <div class="flex gap-2 shrink-0 w-full md:w-auto justify-end">
        <button @click="pullFromCloud" :disabled="isSyncing"
          class="px-4 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-bold hover:bg-cyan-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer">
          <span class="animate-pulse">⟳</span>
          {{ isSyncing ? "…" : "雲端同步" }}
        </button>
        <button @click="pushToCloud" :disabled="isSyncing"
          class="px-4 py-2.5 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:bg-slate-700 disabled:opacity-40 transition-all cursor-pointer">
          ↑ 上傳
        </button>
        <button
          @click="openAdd"
          class="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white text-xs font-bold hover:from-blue-500 hover:to-cyan-500 transition-all shadow-lg shadow-blue-500/10 flex items-center gap-1.5 cursor-pointer"
        >
          <span>＋</span> 新增分機
        </button>
      </div>
    </div>

    <!-- Category Filter Pill Selector -->
    <div class="flex gap-1.5 px-6 py-3 border-b border-white/5 overflow-x-auto shrink-0 bg-slate-900/10 no-scrollbar">
      <button
        v-for="cat in categories" :key="cat"
        @click="catFilter = cat"
        class="px-4 py-1.5 rounded-full text-[10px] font-bold tracking-wide uppercase transition-all whitespace-nowrap border cursor-pointer"
        :class="catFilter === cat
          ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.05)]'
          : 'bg-slate-950/40 border-white/5 text-slate-500 hover:text-slate-300 hover:bg-slate-900/60'"
      >{{ cat }}</button>
    </div>

    <!-- List panel viewport -->
    <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">

      <!-- Empty state -->
      <div v-if="filtered.length === 0" class="text-center py-20 rounded-2xl border border-dashed border-white/5 bg-slate-900/10">
        <div class="text-4xl mb-3 opacity-20">📞</div>
        <p class="text-slate-500 text-xs font-medium uppercase tracking-wider">No contacts found</p>
        <p class="text-slate-600 text-[10px] font-mono mt-1">Press "+ 新增分機" to create a new directory record</p>
      </div>

      <!-- Categories dossier -->
      <div v-for="[cat, items] in grouped" :key="cat" class="space-y-3">
        <!-- Section divider label -->
        <div class="flex items-center gap-2.5">
          <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{{ cat }}</span>
          <span class="text-[9px] text-slate-600 font-mono border border-white/5 px-2 py-0.5 rounded-md bg-white/[0.01]">{{ items.length }}</span>
          <div class="flex-1 border-t border-white/5"></div>
        </div>

        <!-- Cards grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            v-for="c in items" :key="c.id"
            class="group flex flex-col justify-between bg-slate-900/30 border border-white/5 rounded-2xl p-5 hover:border-cyan-500/30 hover:bg-slate-900/50 shadow-md transition-all duration-300 relative overflow-hidden"
          >
            <!-- Card top row -->
            <div class="flex items-start justify-between gap-3">
              <span class="text-xs font-bold text-slate-200 tracking-wide leading-normal">{{ c.label }}</span>
              <div class="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                <button @click="openEdit(c)" class="text-[10px] font-bold px-2 py-1 rounded bg-slate-800 border border-white/5 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/20 transition-all cursor-pointer">編輯</button>
                <button @click="confirmDelete(c)" class="text-[10px] font-bold px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer">刪除</button>
              </div>
            </div>

            <!-- Card dial row -->
            <div class="mt-4 flex items-center justify-between border-t border-white/[0.03] pt-3.5">
              <button
                @click="copyExt(c.ext)"
                class="font-mono text-xl font-black text-cyan-400 hover:text-cyan-300 tracking-widest transition-colors flex items-center gap-1.5 cursor-pointer transform active:scale-98"
                title="點擊複製"
              >
                <span>📞</span> {{ c.ext }}
              </button>
              <span class="text-[8px] font-bold text-slate-600 uppercase tracking-widest pointer-events-none">COPY</span>
            </div>

            <!-- Notes -->
            <p v-if="c.notes" class="mt-2.5 text-[10px] text-slate-500 font-sans truncate leading-normal" :title="c.notes">{{ c.notes }}</p>
          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- Add / Edit Modal -->
  <Teleport to="body">
    <div v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="showModal = false"
    >
      <div class="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 class="text-slate-100 font-black text-xs uppercase tracking-wider">{{ modalMode === "add" ? "✨ 新增" : "⚙️ 編輯" }}分機資料</h3>
          <button @click="showModal = false" class="text-slate-500 hover:text-slate-300 text-xl leading-none cursor-pointer">×</button>
        </div>
        
        <!-- Form -->
        <div class="px-5 py-4 space-y-3.5">
          <div>
            <label class="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wide">名稱 *</label>
            <input v-model="form.label" autofocus
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/50"
              placeholder="護理站、值班室、藥局…" />
          </div>
          <div>
            <label class="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wide">分機號碼 *</label>
            <input v-model="form.ext"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500/50"
              placeholder="12345" />
          </div>
          <div>
            <label class="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wide">類別分類</label>
            <input v-model="form.category"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/50"
              placeholder="常用分機" />
          </div>
          <div>
            <label class="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wide">備註說明</label>
            <input v-model="form.notes"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/50"
              placeholder="選填說明" />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2.5 px-5 py-3.5 border-t border-white/5">
          <button @click="showModal = false" class="px-4 py-2 text-xs font-bold bg-slate-800 border border-white/5 text-slate-400 rounded-xl hover:bg-slate-700 hover:text-slate-200 transition-colors">取消</button>
          <button @click="save" class="px-5 py-2 text-xs font-bold bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl hover:from-blue-500 hover:to-cyan-500 transition-all shadow-lg">儲存記錄</button>
        </div>
      </div>
    </div>

    <!-- Confirm delete modal -->
    <div v-if="showConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="showConfirm = false"
    >
      <div class="w-full max-w-xs bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-5 text-center">
        <p class="text-slate-200 text-sm font-semibold mb-1">確定刪除此分機紀錄？</p>
        <p class="text-xs text-slate-500 font-mono mb-6">「{{ deleteTarget?.label }}」{{ deleteTarget?.ext }}</p>
        <div class="flex gap-2.5 justify-center">
          <button @click="showConfirm = false" class="px-4 py-2 text-xs font-bold bg-slate-800 border border-white/5 text-slate-400 rounded-xl hover:bg-slate-700 hover:text-slate-200">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white rounded-xl shadow-lg shadow-rose-500/10">確認刪除</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast notification -->
  <Teleport to="body">
    <Transition name="slide-up">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4.5 py-2.5 bg-slate-900 border border-white/10 text-slate-200 text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
        {{ toast }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.25s ease-out; }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translate(-50%, 8px); }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
