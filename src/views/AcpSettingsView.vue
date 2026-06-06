<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { getDb } from "@/db";

const router = useRouter();

interface AcpSet {
  id: number;
  name: string;
}

interface AcpItem {
  id: number;
  set_id: number;
  category_type: string;
  name: string;
}

type CategoryType = 'general' | 'medication' | 'procedure';

const sets = ref<AcpSet[]>([]);
const items = ref<AcpItem[]>([]);
const selectedSetId = ref<number | null>(null);
const activeTab = ref<CategoryType>('general');

// Form States
const setFormName = ref("");
const itemFormName = ref("");
const editingItemId = ref<number | null>(null);
const editingItemName = ref("");
const toastMsg = ref("");
function showToast(msg: string) { toastMsg.value = msg; setTimeout(() => { toastMsg.value = ""; }, 2500); }

async function loadData() {
  try {
    const db = await getDb();
    sets.value = await db.select<AcpSet[]>("SELECT * FROM acp_sets WHERE is_active = 1");
    if (selectedSetId.value) {
      items.value = await db.select<AcpItem[]>(
        "SELECT * FROM acp_items WHERE set_id = ? AND category_type = ?",
        [selectedSetId.value, activeTab.value]
      );
    }
  } catch (e) { showToast(`載入失敗：${(e as Error).message}`); }
}

onMounted(loadData);

async function saveSet() {
  if (!setFormName.value.trim()) return;
  try {
    const db = await getDb();
    await db.execute("INSERT OR IGNORE INTO acp_sets (name) VALUES (?)", [setFormName.value]);
    setFormName.value = "";
    await loadData();
    showToast("評估集已新增");
  } catch (e) { showToast(`新增失敗：${(e as Error).message}`); }
}

async function saveItem() {
  if (!itemFormName.value.trim() || !selectedSetId.value) return;
  try {
    const db = await getDb();
    await db.execute(
      "INSERT INTO acp_items (set_id, category_type, name) VALUES (?, ?, ?)",
      [selectedSetId.value, activeTab.value, itemFormName.value]
    );
    itemFormName.value = "";
    await loadData();
    showToast("項目已新增");
  } catch (e) { showToast(`新增失敗：${(e as Error).message}`); }
}

async function updateItem() {
  if (!editingItemId.value || !editingItemName.value.trim()) return;
  try {
    const db = await getDb();
    await db.execute("UPDATE acp_items SET name = ? WHERE id = ?", [editingItemName.value, editingItemId.value]);
    editingItemId.value = null;
    await loadData();
    showToast("項目已更新");
  } catch (e) { showToast(`更新失敗：${(e as Error).message}`); }
}

async function deleteItem(id: number) {
  try {
    const db = await getDb();
    await db.execute("DELETE FROM acp_items WHERE id = ?", [id]);
    await loadData();
    showToast("項目已刪除");
  } catch (e) { showToast(`刪除失敗：${(e as Error).message}`); }
}

function selectSet(id: number) {
  selectedSetId.value = id;
  loadData();
}

function switchTab(tab: CategoryType) {
  activeTab.value = tab;
  loadData();
}

const tabs: { key: CategoryType; label: string; icon: string }[] = [
  { key: 'general',    label: '一般囑言', icon: '📝' },
  { key: 'medication', label: '藥囑',     icon: '💊' },
  { key: 'procedure',  label: '處置',     icon: '🏥' },
];
</script>

<template>
  <div class="p-6 h-full flex flex-col space-y-6 bg-slate-950 text-slate-100 select-none">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/5 pb-4 shrink-0">
      <div class="flex items-center gap-3">
        <button @click="router.back()" 
                class="flex items-center justify-center w-8 h-8 rounded-xl border border-white/5 bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition-all active:scale-95 cursor-pointer">
          ←
        </button>
        <div>
          <h2 class="text-sm font-black text-slate-200 uppercase tracking-widest font-mono">ACP 套組模板管理</h2>
          <p class="text-2xs text-slate-500 font-bold uppercase tracking-wider font-mono mt-0.5">Configure ACP sets and clinical checklist items</p>
        </div>
      </div>
    </div>

    <!-- Grid Layout -->
    <div class="grid grid-cols-12 gap-6 flex-1 overflow-hidden">
      <!-- 1. Sets Selection (Sidebar) -->
      <aside class="col-span-4 bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 flex flex-col overflow-hidden shadow-xl">
        <h3 class="text-xs font-black text-indigo-400 uppercase tracking-widest font-mono mb-4">1. 選擇或建立評估套組</h3>
        
        <div class="flex gap-2 mb-4 shrink-0">
          <input v-model="setFormName" 
                 @keyup.enter="saveSet"
                 placeholder="套組名稱 (如: 攝護腺肥大)..." 
                 class="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500/50 placeholder:text-slate-600 font-bold" />
          <button @click="saveSet" 
                  class="bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 text-white px-4 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-lg shadow-indigo-600/10 cursor-pointer">
            建立
          </button>
        </div>

        <div class="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          <div v-for="s in sets" :key="s.id" 
               @click="selectSet(s.id)"
               class="p-4 rounded-xl border cursor-pointer transition-all font-bold text-xs flex items-center justify-between group"
               :class="selectedSetId === s.id 
                 ? 'bg-indigo-600/20 border-indigo-500/50 text-white shadow-lg' 
                 : 'bg-slate-950/40 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200 hover:bg-slate-900/30'">
            <span class="truncate">{{ s.name }}</span>
            <span v-if="selectedSetId === s.id" class="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)] shrink-0"></span>
          </div>
        </div>
      </aside>

      <!-- 2. Items Management (Main Area) -->
      <section v-if="selectedSetId" class="col-span-8 bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 flex flex-col overflow-hidden shadow-xl">
        <!-- Tabs -->
        <nav class="flex gap-1 p-1 bg-slate-950/60 rounded-xl border border-white/5 mb-6 shrink-0 shadow-inner">
          <button v-for="tab in tabs" :key="tab.key"
                  @click="switchTab(tab.key)"
                  class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-black transition-all cursor-pointer"
                  :class="activeTab === tab.key 
                    ? 'bg-slate-800 text-indigo-400 shadow border border-white/[0.03]' 
                    : 'text-slate-500 hover:text-slate-300'">
            <span>{{ tab.icon }}</span>
            <span>{{ tab.label }}</span>
          </button>
        </nav>

        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="flex items-center gap-2 mb-4 shrink-0">
            <span class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono">目前類別 /</span>
            <h4 class="text-xs font-black text-slate-300 uppercase tracking-widest font-mono">管理「{{ tabs.find(t=>t.key===activeTab)?.label }}」項目細項</h4>
          </div>
          
          <div class="flex gap-2 mb-4 shrink-0">
            <input v-model="itemFormName" 
                   @keyup.enter="saveItem" 
                   placeholder="輸入醫囑項目名稱..." 
                   class="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-emerald-500/50 placeholder:text-slate-600 font-bold" />
            <button @click="saveItem" 
                    class="bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/30 text-white px-5 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-lg shadow-emerald-600/10 cursor-pointer">
              新增細項
            </button>
          </div>

          <!-- Items List -->
          <div class="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
            <div v-for="item in items" :key="item.id" 
                 class="flex items-center justify-between gap-3 p-3.5 border border-white/[0.03] bg-slate-950/20 hover:bg-slate-900/40 rounded-xl transition-all group">
              
              <div v-if="editingItemId === item.id" class="flex-1 flex gap-2">
                <input v-model="editingItemName" 
                       @keyup.enter="updateItem" 
                       class="flex-1 bg-slate-950 border border-indigo-500/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none" 
                       autofocus />
                <button @click="updateItem" 
                        class="text-2xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-bold cursor-pointer transition-colors">
                  儲存
                </button>
                <button @click="editingItemId = null" 
                        class="text-2xs text-slate-500 hover:text-slate-300 px-2 font-bold cursor-pointer">
                  取消
                </button>
              </div>
              
              <template v-else>
                <span class="flex-1 text-slate-300 text-xs font-bold leading-relaxed truncate">{{ item.name }}</span>
                <div class="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0 transition-opacity">
                  <button @click="editingItemId = item.id; editingItemName = item.name" 
                          class="w-7 h-7 flex items-center justify-center hover:bg-slate-800 rounded-lg text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                          title="編輯項目">
                    ✏️
                  </button>
                  <button @click="deleteItem(item.id)" 
                          class="w-7 h-7 flex items-center justify-center hover:bg-rose-950/40 rounded-lg text-rose-500 hover:text-rose-400 transition-colors cursor-pointer"
                          title="刪除項目">
                    🗑️
                  </button>
                </div>
              </template>
            </div>
            
            <div v-if="items.length === 0" class="flex flex-col items-center justify-center h-32 text-slate-600 italic">
              <p class="text-xs">尚無細項設定</p>
            </div>
          </div>
        </div>
      </section>
      
      <!-- Empty Set State -->
      <section v-else class="col-span-8 flex flex-col items-center justify-center border border-dashed border-white/5 rounded-2xl text-slate-500 bg-slate-900/10">
        <span class="text-5xl mb-4 animate-bounce">👈</span>
        <p class="text-xs font-black tracking-widest uppercase font-mono">請先選擇左側評估套組以管理醫囑</p>
      </section>
    </div>
  </div>

  <Transition name="toast">
    <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 border border-white/10 text-slate-200 text-xs font-bold px-5 py-2.5 rounded-2xl shadow-2xl pointer-events-none z-50 backdrop-blur-md">
      {{ toastMsg }}
    </div>
  </Transition>
</template>

<style scoped>
</style>
