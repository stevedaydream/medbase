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
    attributes: { class: "prose prose-invert prose-sm max-w-none focus:outline-none min-h-[350px] px-2 text-slate-300 font-sans" }
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
  <div class="flex h-full bg-slate-950/20 rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
    <!-- Left panel -->
    <div class="w-60 shrink-0 flex flex-col border-r border-white/5 bg-slate-900/60 backdrop-blur-xl h-full overflow-hidden">
      
      <!-- Category Tabs (Horizontal Scrollable) -->
      <div class="px-4 py-3.5 border-b border-white/5 overflow-x-auto flex gap-1.5 shrink-0 no-scrollbar">
        <button v-for="cat in categories" :key="cat"
          @click="activeCategory = cat"
          class="shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wide uppercase transition-all cursor-pointer border"
          :class="activeCategory === cat 
            ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-blue-500/30 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.05)]' 
            : 'bg-slate-950/40 border-white/5 text-slate-500 hover:text-slate-300 hover:bg-slate-900/60'">
          {{ cat }}
        </button>
      </div>

      <!-- Memo list -->
      <div class="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        <div v-if="!filteredMemos.length" class="text-slate-600 text-xs font-mono text-center py-10">NO MEMOS FOUND</div>
        <div v-for="m in filteredMemos" :key="m.id"
          @click="selectMemo(m)"
          class="group flex items-start justify-between gap-2 px-3.5 py-3 rounded-xl cursor-pointer transition-all border relative overflow-hidden"
          :class="activeMemo?.id === m.id 
            ? 'bg-slate-900/50 border-cyan-500/10 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.03)]' 
            : 'bg-transparent border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'">
          
          <!-- Selected active left indicator bar -->
          <div v-if="activeMemo?.id === m.id" class="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500" />
          
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold truncate tracking-wide" :class="activeMemo?.id === m.id ? 'text-cyan-300' : 'text-slate-200'">{{ m.title }}</p>
            <p class="text-[9px] text-slate-500 font-medium tracking-wide uppercase mt-0.5">{{ m.category }}</p>
          </div>
          <button @click.stop="deleteTarget = m"
            class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 text-xs px-1.5 transition-all shrink-0 cursor-pointer">
            ×
          </button>
        </div>
      </div>

      <!-- Sync + Add buttons -->
      <div class="px-4 py-4 border-t border-white/5 bg-slate-950/40 shrink-0 space-y-2">
        <div class="flex gap-2">
          <button @click="pullFromCloud" :disabled="isSyncing"
            class="flex-1 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold hover:bg-blue-500/20 disabled:opacity-40 transition-all cursor-pointer">
            {{ isSyncing ? "…" : "↓ 同步" }}
          </button>
          <button @click="pushToCloud" :disabled="isSyncing"
            class="flex-1 py-2 rounded-xl bg-slate-800 border border-white/5 text-slate-300 text-xs font-bold hover:bg-slate-700 disabled:opacity-40 transition-all cursor-pointer">
            {{ isSyncing ? "…" : "↑ 上傳" }}
          </button>
        </div>
        <button @click="openAdd"
          class="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold hover:from-blue-500 hover:to-indigo-500 transition-all shadow-lg shadow-blue-500/10 cursor-pointer">
          ＋ 新增備忘
        </button>
      </div>
    </div>

    <!-- Right editor panel -->
    <div class="flex-1 flex flex-col bg-slate-950/40 backdrop-blur-md overflow-hidden">
      <div v-if="!activeMemo" class="flex-1 flex flex-col items-center justify-center text-slate-600 text-center space-y-3">
        <span class="text-4xl opacity-20">📝</span>
        <p class="text-xs uppercase tracking-widest font-mono">Select a memo or create a new one to begin editing</p>
      </div>
      
      <template v-else>
        <!-- Title bar -->
        <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between gap-4 shrink-0 bg-slate-900/10">
          <div class="flex-1 min-w-0">
            <div v-if="editingTitle" class="flex items-center gap-2 max-w-xl">
              <input v-model="titleDraft" @keydown.enter="saveTitle" @keydown.escape="editingTitle = false"
                class="flex-1 px-3 py-1.5 rounded-xl bg-slate-900 border border-blue-500/30 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/15"
                autofocus />
              <button @click="saveTitle" class="text-xs font-bold px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-xl transition-all cursor-pointer">儲存</button>
            </div>
            <h2 v-else
              class="text-sm font-black text-slate-100 cursor-pointer hover:text-cyan-400 transition-all flex items-center gap-1.5 group"
              @click="titleDraft = activeMemo.title; editingTitle = true"
              title="點擊編輯標題">
              {{ activeMemo.title }}
              <span class="text-xs text-slate-600 group-hover:text-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
            </h2>
          </div>
          <span class="text-[10px] font-bold bg-white/5 border border-white/5 text-slate-500 px-2.5 py-1 rounded-lg uppercase tracking-wider shrink-0 font-mono">{{ activeMemo.category }}</span>
        </div>

        <!-- Editor Toolbar -->
        <div v-if="editor" class="px-6 py-2 border-b border-white/5 flex items-center gap-1 shrink-0 bg-slate-900/20">
          <button @click="editor.chain().focus().toggleBold().run()"
            :class="editor.isActive('bold') ? 'bg-white/10 text-cyan-400 font-extrabold' : 'text-slate-500 hover:text-slate-300'"
            class="p-2 rounded-lg text-xs font-bold transition-all cursor-pointer">B</button>
          
          <button @click="editor.chain().focus().toggleItalic().run()"
            :class="editor.isActive('italic') ? 'bg-white/10 text-cyan-400 font-extrabold' : 'text-slate-500 hover:text-slate-300'"
            class="p-2 rounded-lg text-xs italic transition-all cursor-pointer">I</button>
          
          <button @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
            :class="editor.isActive('heading', { level: 3 }) ? 'bg-white/10 text-cyan-400 font-extrabold' : 'text-slate-500 hover:text-slate-300'"
            class="p-2 rounded-lg text-[10px] font-bold transition-all cursor-pointer">H3</button>
          
          <div class="w-px h-4 bg-white/5 mx-2" />
          
          <button @click="editor.chain().focus().toggleBulletList().run()"
            :class="editor.isActive('bulletList') ? 'bg-white/10 text-cyan-400' : 'text-slate-500 hover:text-slate-300'"
            class="p-2 rounded-lg text-xs transition-all cursor-pointer">•—</button>
          
          <button @click="editor.chain().focus().toggleOrderedList().run()"
            :class="editor.isActive('orderedList') ? 'bg-white/10 text-cyan-400' : 'text-slate-500 hover:text-slate-300'"
            class="p-2 rounded-lg text-xs transition-all cursor-pointer">1.</button>
          
          <div class="w-px h-4 bg-white/5 mx-2" />
          
          <button @click="editor.chain().focus().setHardBreak().run()"
            class="p-2 rounded-lg text-xs text-slate-500 hover:text-slate-300 transition-all cursor-pointer">↵</button>
        </div>

        <!-- Editor body viewport -->
        <div class="flex-1 overflow-y-auto px-6 py-5 bg-slate-900/5">
          <EditorContent :editor="editor" />
        </div>
      </template>
    </div>
  </div>

  <!-- Add memo modal -->
  <Teleport to="body">
    <div v-if="showAddModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="showAddModal = false">
      <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-[400px] max-w-[90vw] p-6 space-y-4">
        <h2 class="text-slate-100 font-black text-sm uppercase tracking-wide border-b border-white/5 pb-2">✏️ 新增備忘</h2>
        <div class="space-y-3">
          <div>
            <label class="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wide">分類目錄</label>
            <input v-model="addForm.category" placeholder="例如: 輪序規則、外圍分配、注意事項"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/50" />
          </div>
          <div>
            <label class="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wide">備忘標題 *</label>
            <input v-model="addForm.title" placeholder="請輸入標題"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/50 font-bold"
              @keydown.enter="confirmAdd" autofocus />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-2 border-t border-white/5">
          <button @click="showAddModal = false" class="px-4 py-2 text-xs font-bold bg-slate-800 border border-white/5 text-slate-400 rounded-xl hover:bg-slate-700 hover:text-slate-200">取消</button>
          <button @click="confirmAdd" class="px-5 py-2 text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-500 hover:to-indigo-500 transition-all shadow-lg">建立備忘</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="deleteTarget = null">
      <div class="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-80 p-6 space-y-4">
        <p class="text-sm text-slate-300">確定刪除「<span class="text-rose-400 font-bold">{{ deleteTarget.title }}</span>」備忘嗎？</p>
        <div class="flex gap-3 justify-end pt-2 border-t border-white/5">
          <button @click="deleteTarget = null" class="px-4 py-2 text-xs font-bold bg-slate-800 border border-white/5 text-slate-400 rounded-xl hover:bg-slate-700">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-xs font-bold bg-rose-600 text-white rounded-xl hover:bg-rose-500">確認刪除</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-slate-900 border border-white/10 text-slate-200 text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
        {{ toastMsg }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>

<style>
/* Tiptap prose overrides for clinical dark workspace theme */
.ProseMirror { color: #cbd5e1; }
.ProseMirror h3 { color: #f8fafc; font-size: 0.95rem; font-weight: 800; margin: 1rem 0 0.5rem; letter-spacing: 0.025em; border-left: 3px solid #06b6d4; padding-left: 0.5rem; }
.ProseMirror ul { list-style: disc; padding-left: 1.25rem; font-size: 0.8rem; line-height: 1.6; }
.ProseMirror ol { list-style: decimal; padding-left: 1.25rem; font-size: 0.8rem; line-height: 1.6; }
.ProseMirror li { margin: 0.25rem 0; color: #cbd5e1; }
.ProseMirror strong { color: #f8fafc; font-weight: 700; }
.ProseMirror p { margin: 0.5rem 0; font-size: 0.8rem; line-height: 1.6; }
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: #475569;
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
