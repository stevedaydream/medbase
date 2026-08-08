<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { getDb } from "@/db";
import { useCloudSettings } from "@/stores/cloudSettings";
import { setGlobalSyncing } from "@/composables/useCloudSync";
import { markLocalModified, saveSyncTimestamp } from "@/composables/useSyncMonitor";
import { useLogger } from "@/composables/useLogger";

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
    attributes: { class: "prose prose-invert prose-sm max-w-none focus:outline-none min-h-[350px] px-2 text-fg-secondary font-sans" }
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
  await markLocalModified("shiftMemos");
  pushToCloud().catch(() => {});
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
    const res = await fetch(cloud.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "saveShiftMemos", data: memos.value }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "GAS 錯誤");
    toast(`已上傳 ${memos.value.length} 筆至雲端`);
    await saveSyncTimestamp("shiftMemos");
    useLogger().addLog("info", `[雲端同步] push 規則備忘錄 — ${memos.value.length} 筆`, JSON.stringify({ table: "shiftMemos", action: "push", timestamp: new Date().toISOString() }));
  } catch (e) {
    toast(`上傳失敗：${(e as Error).message}`);
    useLogger().addLog("warn", "[雲端同步] push 規則備忘錄 失敗", String(e));
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
  await markLocalModified("shiftMemos");
  pushToCloud().catch(() => {});
}
</script>

<template>
  <div class="accent-blue flex h-full bg-sunken rounded-2xl border border-hairline shadow-2xl overflow-hidden">
    <!-- Left panel -->
    <div class="w-60 shrink-0 flex flex-col border-r border-hairline bg-surface h-full overflow-hidden">
      
      <!-- Category Tabs (Horizontal Scrollable) -->
      <div class="px-4 py-3.5 border-b border-hairline overflow-x-auto flex gap-1.5 shrink-0 no-scrollbar">
        <button v-for="cat in categories" :key="cat"
          @click="activeCategory = cat"
          class="shrink-0 px-3 py-1.5 rounded-full text-2xs font-bold tracking-wide uppercase transition-all cursor-pointer border"
          :class="activeCategory === cat 
            ? 'bg-gradient-to-r from-accent/10 to-accent/10 border-accent/30 text-accent shadow-[0_0_10px_rgba(59,130,246,0.05)]' 
            : 'bg-sunken border-hairline text-muted hover:text-fg-secondary hover:bg-surface/60'">
          {{ cat }}
        </button>
      </div>

      <!-- Memo list -->
      <div class="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        <div v-if="!filteredMemos.length" class="text-muted text-xs font-mono text-center py-10">NO MEMOS FOUND</div>
        <div v-for="m in filteredMemos" :key="m.id"
          @click="selectMemo(m)"
          class="group flex items-start justify-between gap-2 px-3.5 py-3 rounded-xl cursor-pointer transition-all border relative overflow-hidden"
          :class="activeMemo?.id === m.id 
            ? 'bg-surface border-accent/10 text-accent shadow-[0_0_15px_rgba(6,182,212,0.03)]' 
            : 'bg-transparent border-transparent text-fg-secondary hover:bg-overlay/5 hover:text-fg'">
          
          <!-- Selected active left indicator bar -->
          <div v-if="activeMemo?.id === m.id" class="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
          
          <div class="flex-1 min-w-0">
            <p class="text-xs font-bold truncate tracking-wide" :class="activeMemo?.id === m.id ? 'text-accent' : 'text-fg'">{{ m.title }}</p>
            <p class="text-2xs text-muted font-medium tracking-wide uppercase mt-0.5">{{ m.category }}</p>
          </div>
          <button @click.stop="deleteTarget = m"
            class="opacity-0 group-hover:opacity-100 text-muted hover:text-danger text-xs px-1.5 transition-all shrink-0 cursor-pointer">
            ×
          </button>
        </div>
      </div>

      <!-- Sync + Add buttons -->
      <div class="px-4 py-4 border-t border-hairline bg-sunken shrink-0 space-y-2">
        <div class="flex gap-2">
          <button @click="pullFromCloud" :disabled="isSyncing"
            class="flex-1 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-bold hover:bg-accent/20 disabled:opacity-40 transition-all cursor-pointer">
            {{ isSyncing ? "…" : "↓ 同步" }}
          </button>
          <button @click="pushToCloud" :disabled="isSyncing"
            class="flex-1 py-2 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised disabled:opacity-40 transition-all cursor-pointer">
            {{ isSyncing ? "…" : "↑ 上傳" }}
          </button>
        </div>
        <button @click="openAdd"
          class="w-full py-2.5 rounded-xl bg-gradient-to-r from-accent to-accent text-fg text-xs font-bold hover:from-accent hover:to-accent transition-all shadow-lg shadow-accent/10 cursor-pointer">
          ＋ 新增備忘
        </button>
      </div>
    </div>

    <!-- Right editor panel -->
    <div class="flex-1 flex flex-col bg-sunken overflow-hidden">
      <div v-if="!activeMemo" class="flex-1 flex flex-col items-center justify-center text-muted text-center space-y-3">
        <span class="text-4xl opacity-20">📝</span>
        <p class="text-xs uppercase tracking-widest font-mono">Select a memo or create a new one to begin editing</p>
      </div>
      
      <template v-else>
        <!-- Title bar -->
        <div class="px-6 py-4 border-b border-hairline flex items-center justify-between gap-4 shrink-0 bg-surface">
          <div class="flex-1 min-w-0">
            <div v-if="editingTitle" class="flex items-center gap-2 max-w-xl">
              <input v-model="titleDraft" @keydown.enter="saveTitle" @keydown.escape="editingTitle = false"
                class="flex-1 px-3 py-1.5 rounded-xl bg-surface border border-accent/30 text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent/15"
                autofocus />
              <button @click="saveTitle" class="text-xs font-bold px-3 py-1.5 bg-accent hover:bg-accent text-white rounded-xl transition-all cursor-pointer">儲存</button>
            </div>
            <h2 v-else
              class="text-sm font-black text-fg cursor-pointer hover:text-accent transition-all flex items-center gap-1.5 group"
              @click="titleDraft = activeMemo.title; editingTitle = true"
              title="點擊編輯標題">
              {{ activeMemo.title }}
              <span class="text-xs text-muted group-hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
            </h2>
          </div>
          <span class="text-2xs font-bold bg-overlay/5 border border-hairline text-muted px-2.5 py-1 rounded-lg uppercase tracking-wider shrink-0 font-mono">{{ activeMemo.category }}</span>
        </div>

        <!-- Editor Toolbar -->
        <div v-if="editor" class="px-6 py-2 border-b border-hairline flex items-center gap-1 shrink-0 bg-surface">
          <button @click="editor.chain().focus().toggleBold().run()"
            :class="editor.isActive('bold') ? 'bg-overlay/10 text-accent font-extrabold' : 'text-muted hover:text-fg-secondary'"
            class="p-2 rounded-lg text-xs font-bold transition-all cursor-pointer">B</button>
          
          <button @click="editor.chain().focus().toggleItalic().run()"
            :class="editor.isActive('italic') ? 'bg-overlay/10 text-accent font-extrabold' : 'text-muted hover:text-fg-secondary'"
            class="p-2 rounded-lg text-xs italic transition-all cursor-pointer">I</button>
          
          <button @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
            :class="editor.isActive('heading', { level: 3 }) ? 'bg-overlay/10 text-accent font-extrabold' : 'text-muted hover:text-fg-secondary'"
            class="p-2 rounded-lg text-2xs font-bold transition-all cursor-pointer">H3</button>
          
          <div class="w-px h-4 bg-overlay/5 mx-2" />
          
          <button @click="editor.chain().focus().toggleBulletList().run()"
            :class="editor.isActive('bulletList') ? 'bg-overlay/10 text-accent' : 'text-muted hover:text-fg-secondary'"
            class="p-2 rounded-lg text-xs transition-all cursor-pointer">•—</button>
          
          <button @click="editor.chain().focus().toggleOrderedList().run()"
            :class="editor.isActive('orderedList') ? 'bg-overlay/10 text-accent' : 'text-muted hover:text-fg-secondary'"
            class="p-2 rounded-lg text-xs transition-all cursor-pointer">1.</button>
          
          <div class="w-px h-4 bg-overlay/5 mx-2" />
          
          <button @click="editor.chain().focus().setHardBreak().run()"
            class="p-2 rounded-lg text-xs text-muted hover:text-fg-secondary transition-all cursor-pointer">↵</button>
        </div>

        <!-- Editor body viewport -->
        <div class="flex-1 overflow-y-auto px-6 py-5 bg-surface">
          <EditorContent :editor="editor" />
        </div>
      </template>
    </div>
  </div>

  <!-- Add memo modal -->
  <Teleport to="body">
    <div v-if="showAddModal" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="showAddModal = false">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-[400px] max-w-[90vw] p-6 space-y-4">
        <h2 class="text-fg font-black text-sm border-b border-hairline pb-2">✏️ 新增備忘</h2>
        <div class="space-y-3">
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">分類目錄</label>
            <input v-model="addForm.category" placeholder="例如: 輪序規則、外圍分配、注意事項"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">備忘標題 *</label>
            <input v-model="addForm.title" placeholder="請輸入標題"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 font-bold"
              @keydown.enter="confirmAdd" autofocus />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button @click="showAddModal = false" class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised hover:text-fg">取消</button>
          <button @click="confirmAdd" class="px-5 py-2 text-xs font-bold bg-gradient-to-r from-accent to-accent text-fg rounded-xl hover:from-accent hover:to-accent transition-all shadow-lg">建立備忘</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="deleteTarget = null">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-80 p-6 space-y-4">
        <p class="text-sm text-fg-secondary">確定刪除「<span class="text-danger font-bold">{{ deleteTarget.title }}</span>」備忘嗎？</p>
        <div class="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button @click="deleteTarget = null" class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-xs font-bold bg-danger text-white rounded-xl hover:bg-danger">確認刪除</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-surface border border-hairline text-fg text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
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
