<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";

interface ShiftMemo {
  id: number;
  category: string;
  title: string;
  content: string;
  sort_order: number;
  updated_at: string;
}

const memos       = ref<ShiftMemo[]>([]);
const activeMemo  = ref<ShiftMemo | null>(null);
const activeCategory = ref<string>("全部");
const toastMsg    = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2000);
}

const cloud     = useCloudSettings();
const isSyncing = ref(false);

// ── Tiptap editor ────────────────────────────────────────────
let saveDebounce: ReturnType<typeof setTimeout> | null = null;

const editor = useEditor({
  extensions: [StarterKit],
  content: "",
  editorProps: {
    attributes: { class: "prose prose-invert prose-sm max-w-none focus:outline-none min-h-[200px] px-1" }
  },
  onUpdate: () => {
    if (!activeMemo.value) return;
    if (saveDebounce) clearTimeout(saveDebounce);
    saveDebounce = setTimeout(autoSave, 800);
  },
});

async function autoSave() {
  if (!activeMemo.value || !editor.value) return;
  const content = editor.value.getHTML();
  activeMemo.value.content = content;
  const db = await getDb();
  await db.execute(
    "UPDATE shift_memos SET content=?, updated_at=datetime('now','localtime') WHERE id=?",
    [content, activeMemo.value.id]
  );
  const idx = memos.value.findIndex(m => m.id === activeMemo.value!.id);
  if (idx >= 0) memos.value[idx].updated_at = new Date().toLocaleString("zh-TW");
}

// ── 載入 ─────────────────────────────────────────────────────
onMounted(() => { cloud.load(); load(); });
async function load() {
  const db = await getDb();
  memos.value = await db.select<ShiftMemo[]>(
    "SELECT * FROM shift_memos ORDER BY category, sort_order, id"
  );
}

// ── 類別列表 ─────────────────────────────────────────────────
const categories = computed(() => {
  const cats = [...new Set(memos.value.map(m => m.category))];
  return ["全部", ...cats];
});

const filteredMemos = computed(() => {
  if (activeCategory.value === "全部") return memos.value;
  return memos.value.filter(m => m.category === activeCategory.value);
});

// ── 選中備忘 ─────────────────────────────────────────────────
function selectMemo(m: ShiftMemo) {
  if (saveDebounce) { clearTimeout(saveDebounce); autoSave(); }
  activeMemo.value = m;
  editor.value?.commands.setContent(m.content || "");
}

// ── 新增備忘 ─────────────────────────────────────────────────
const showAddModal  = ref(false);
const addForm       = ref({ category: "", title: "" });

function openAdd() {
  addForm.value = { category: activeCategory.value === "全部" ? "" : activeCategory.value, title: "" };
  showAddModal.value = true;
}
async function confirmAdd() {
  const { category, title } = addForm.value;
  if (!title.trim()) return;
  const db = await getDb();
  const res = await db.execute(
    "INSERT INTO shift_memos (category, title, content) VALUES (?,?,?)",
    [category.trim() || "一般", title.trim(), ""]
  );
  showAddModal.value = false;
  await load();
  const newMemo = memos.value.find(m => m.id === res.lastInsertId);
  if (newMemo) selectMemo(newMemo);
  if (addForm.value.category && activeCategory.value !== "全部") {
    activeCategory.value = addForm.value.category.trim() || "一般";
  }
}

// ── 刪除 ─────────────────────────────────────────────────────
const deleteTarget = ref<ShiftMemo | null>(null);
async function doDelete() {
  if (!deleteTarget.value) return;
  const db = await getDb();
  await db.execute("DELETE FROM shift_memos WHERE id=?", [deleteTarget.value.id]);
  if (activeMemo.value?.id === deleteTarget.value.id) {
    activeMemo.value = null;
    editor.value?.commands.setContent("");
  }
  deleteTarget.value = null;
  await load();
  toast("已刪除");
}

// ── 雲端同步 ─────────────────────────────────────────────────
async function pushToCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  // 先儲存目前編輯中的內容
  if (saveDebounce) { clearTimeout(saveDebounce); await autoSave(); }
  isSyncing.value = true; setGlobalSyncing("shiftMemos", true);
  try {
    await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveShiftMemos", data: memos.value }),
      mode: "no-cors",
    });
    toast(`已上傳 ${memos.value.length} 筆至雲端`);
  } catch (e) {
    toast(`上傳失敗：${(e as Error).message}`);
  } finally { isSyncing.value = false; setGlobalSyncing("shiftMemos", false); }
}

async function pullFromCloud() {
  if (!cloud.gasUrl) { toast("請先在「設定」頁面填入 GAS Web App URL"); return; }
  isSyncing.value = true; setGlobalSyncing("shiftMemos", true);
  try {
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "getShiftMemos" }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 回傳錯誤");
    const data: ShiftMemo[] = json.data;
    if (!data.length) { toast("雲端無備忘資料"); return; }
    const db = await getDb();
    await db.execute("DELETE FROM shift_memos");
    for (const r of data) {
      await db.execute(
        "INSERT INTO shift_memos (id, category, title, content, sort_order, updated_at) VALUES (?,?,?,?,?,?)",
        [r.id, r.category, r.title, r.content, r.sort_order ?? 0, r.updated_at ?? ""]
      );
    }
    activeMemo.value = null;
    editor.value?.commands.setContent("");
    await load();
    toast(`已從雲端同步 ${data.length} 筆備忘`);
  } catch (e) {
    toast(`下載失敗：${(e as Error).message}`);
  } finally { isSyncing.value = false; setGlobalSyncing("shiftMemos", false); }
}

// ── 編輯標題 ─────────────────────────────────────────────────
const editingTitle = ref(false);
const titleDraft   = ref("");
async function saveTitle() {
  if (!activeMemo.value || !titleDraft.value.trim()) { editingTitle.value = false; return; }
  const db = await getDb();
  await db.execute("UPDATE shift_memos SET title=? WHERE id=?", [titleDraft.value.trim(), activeMemo.value.id]);
  activeMemo.value.title = titleDraft.value.trim();
  const idx = memos.value.findIndex(m => m.id === activeMemo.value!.id);
  if (idx >= 0) memos.value[idx].title = titleDraft.value.trim();
  editingTitle.value = false;
}
</script>

<template>
  <div class="flex h-full overflow-hidden">
    <!-- Left panel -->
    <div class="w-52 shrink-0 flex flex-col border-r border-gray-800 h-full overflow-hidden">
      <!-- Category tabs -->
      <div class="px-3 py-3 border-b border-gray-800 overflow-x-auto flex gap-1 shrink-0">
        <button v-for="cat in categories" :key="cat"
          @click="activeCategory = cat"
          class="shrink-0 px-2.5 py-1 rounded-full text-xs transition-colors"
          :class="activeCategory === cat ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'">
          {{ cat }}
        </button>
      </div>

      <!-- Memo list -->
      <div class="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <div v-if="!filteredMemos.length" class="text-gray-600 text-xs text-center py-6">暫無備忘</div>
        <div v-for="m in filteredMemos" :key="m.id"
          @click="selectMemo(m)"
          class="group flex items-start justify-between gap-1 px-2.5 py-2 rounded-lg cursor-pointer transition-colors"
          :class="activeMemo?.id === m.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'">
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate">{{ m.title }}</p>
            <p class="text-xs text-gray-600 truncate">{{ m.category }}</p>
          </div>
          <button @click.stop="deleteTarget = m"
            class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-xs px-1 transition-opacity shrink-0 mt-0.5">
            ×
          </button>
        </div>
      </div>

      <!-- Sync + Add buttons -->
      <div class="px-3 py-3 border-t border-gray-800 shrink-0 space-y-1.5">
        <div class="flex gap-1.5">
          <button @click="pullFromCloud" :disabled="isSyncing"
            class="flex-1 py-1 rounded-lg bg-blue-800/60 text-blue-200 text-xs hover:bg-blue-700/60 disabled:opacity-40 transition-colors">
            {{ isSyncing ? "…" : "↓ 同步" }}
          </button>
          <button @click="pushToCloud" :disabled="isSyncing"
            class="flex-1 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs hover:bg-gray-600 disabled:opacity-40 transition-colors">
            {{ isSyncing ? "…" : "↑ 上傳" }}
          </button>
        </div>
        <button @click="openAdd"
          class="w-full py-1.5 rounded-lg bg-blue-700/60 text-blue-200 text-sm hover:bg-blue-700 transition-colors">
          ＋ 新增備忘
        </button>
      </div>
    </div>

    <!-- Right editor panel -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <div v-if="!activeMemo" class="flex-1 flex items-center justify-center text-gray-600 text-sm">
        選擇左側備忘或新增
      </div>
      <template v-else>
        <!-- Title bar -->
        <div class="px-5 py-3 border-b border-gray-800 flex items-center gap-3 shrink-0">
          <div class="flex-1 min-w-0">
            <div v-if="editingTitle" class="flex items-center gap-2">
              <input v-model="titleDraft" @keydown.enter="saveTitle" @keydown.escape="editingTitle = false"
                class="flex-1 px-2 py-1 rounded-lg bg-gray-800 border border-blue-600 text-white text-base focus:outline-none"
                autofocus />
              <button @click="saveTitle" class="text-xs px-2 py-1 bg-blue-700 text-white rounded hover:bg-blue-600">儲存</button>
            </div>
            <h2 v-else
              class="text-base font-semibold text-white cursor-pointer hover:text-blue-300 transition-colors"
              @click="titleDraft = activeMemo.title; editingTitle = true"
              title="點擊編輯標題">
              {{ activeMemo.title }}
            </h2>
          </div>
          <span class="text-xs text-gray-600 shrink-0">{{ activeMemo.category }}</span>
        </div>

        <!-- Toolbar -->
        <div v-if="editor" class="px-5 py-1.5 border-b border-gray-800 flex gap-1 shrink-0">
          <button @click="editor.chain().focus().toggleBold().run()"
            :class="editor.isActive('bold') ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
            class="px-2 py-0.5 rounded text-sm font-bold transition-colors">B</button>
          <button @click="editor.chain().focus().toggleItalic().run()"
            :class="editor.isActive('italic') ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
            class="px-2 py-0.5 rounded text-sm italic transition-colors">I</button>
          <button @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
            :class="editor.isActive('heading', { level: 3 }) ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
            class="px-2 py-0.5 rounded text-xs transition-colors">H3</button>
          <div class="w-px bg-gray-800 mx-1" />
          <button @click="editor.chain().focus().toggleBulletList().run()"
            :class="editor.isActive('bulletList') ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
            class="px-2 py-0.5 rounded text-sm transition-colors">•—</button>
          <button @click="editor.chain().focus().toggleOrderedList().run()"
            :class="editor.isActive('orderedList') ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
            class="px-2 py-0.5 rounded text-sm transition-colors">1.</button>
          <div class="w-px bg-gray-800 mx-1" />
          <button @click="editor.chain().focus().setHardBreak().run()"
            class="px-2 py-0.5 rounded text-xs text-gray-500 hover:text-gray-300 transition-colors">↵</button>
        </div>

        <!-- Editor body -->
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <EditorContent :editor="editor" />
        </div>
      </template>
    </div>
  </div>

  <!-- Add modal -->
  <Teleport to="body">
    <div v-if="showAddModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="showAddModal = false">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[400px] max-w-[90vw] p-6 space-y-4">
        <h2 class="text-white font-semibold">新增備忘</h2>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-gray-400 mb-1 block">類別</label>
            <input v-model="addForm.category" placeholder="外圍分配 / 輪序規則 / 注意事項…"
              class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1 block">標題 *</label>
            <input v-model="addForm.title" placeholder="備忘標題"
              class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500"
              @keydown.enter="confirmAdd" autofocus />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-1">
          <button @click="showAddModal = false" class="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">取消</button>
          <button @click="confirmAdd" class="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-600">建立</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="deleteTarget = null">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-80 p-6 space-y-4">
        <p class="text-white">確定刪除「<span class="text-red-400">{{ deleteTarget.title }}</span>」？</p>
        <div class="flex gap-3 justify-end">
          <button @click="deleteTarget = null" class="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-sm bg-red-700 text-white rounded-lg hover:bg-red-600">刪除</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-[9999] pointer-events-none">
        {{ toastMsg }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>

<style>
/* Tiptap prose overrides for dark theme */
.ProseMirror { color: #d1d5db; }
.ProseMirror h3 { color: #f3f4f6; font-size: 1rem; font-weight: 600; margin: 0.75rem 0 0.25rem; }
.ProseMirror ul { list-style: disc; padding-left: 1.25rem; }
.ProseMirror ol { list-style: decimal; padding-left: 1.25rem; }
.ProseMirror li { margin: 0.15rem 0; }
.ProseMirror strong { color: #f9fafb; }
.ProseMirror p { margin: 0.25rem 0; }
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #4b5563;
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
