<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getDb } from "@/db";

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
  <div class="p-6 h-full flex flex-col space-y-6">
    <h2 class="text-2xl font-bold text-gray-100 shrink-0">ACP 套組模板管理</h2>

    <div class="grid grid-cols-12 gap-6 flex-1 overflow-hidden">
      <!-- 1. Sets Selection (Sidebar) -->
      <div class="col-span-4 bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col">
        <h3 class="text-lg font-semibold text-blue-400 mb-4">1. 選擇/建立評估套組</h3>
        <div class="flex gap-2 mb-6 shrink-0">
          <input v-model="setFormName" placeholder="套組名稱 (如: 攝護腺肥大)" class="flex-1 bg-gray-800 border-gray-700 rounded-lg p-2 text-sm text-white focus:border-blue-500 outline-none" />
          <button @click="saveSet" class="bg-blue-600 hover:bg-blue-500 text-white px-4 rounded-lg text-sm font-bold">建立</button>
        </div>
        <div class="flex-1 overflow-y-auto space-y-2">
          <div v-for="s in sets" :key="s.id" 
               @click="selectSet(s.id)"
               class="p-4 rounded-xl border cursor-pointer transition-all font-bold"
               :class="selectedSetId === s.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800/40 border-gray-800 text-gray-400 hover:border-gray-700'">
            {{ s.name }}
          </div>
        </div>
      </div>

      <!-- 2. Items Management (Main Area) -->
      <div v-if="selectedSetId" class="col-span-8 bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col">
        <!-- Tabs -->
        <div class="flex gap-1 p-1 bg-gray-800 rounded-lg mb-6 shrink-0">
          <button v-for="tab in tabs" :key="tab.key"
                  @click="switchTab(tab.key)"
                  class="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-bold transition-all"
                  :class="activeTab === tab.key ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'">
            <span>{{ tab.icon }}</span>
            <span>{{ tab.label }}</span>
          </button>
        </div>

        <div class="flex-1 flex flex-col overflow-hidden">
          <h4 class="text-gray-100 font-bold mb-4">管理「{{ tabs.find(t=>t.key===activeTab)?.label }}」細項</h4>
          
          <div class="flex gap-2 mb-6 shrink-0">
            <input v-model="itemFormName" @keyup.enter="saveItem" placeholder="輸入醫囑名稱..." class="flex-1 bg-gray-800 border-gray-700 rounded-lg p-2 text-sm text-white focus:border-green-500 outline-none" />
            <button @click="saveItem" class="bg-green-600 hover:bg-green-500 text-white px-5 rounded-lg text-sm font-bold">新增細項</button>
          </div>

          <div class="flex-1 overflow-y-auto space-y-1">
            <div v-for="item in items" :key="item.id" class="flex items-center gap-3 p-3 border-b border-gray-800 group hover:bg-gray-800/30 rounded-lg transition-colors">
              <div v-if="editingItemId === item.id" class="flex-1 flex gap-2">
                <input v-model="editingItemName" @keyup.enter="updateItem" class="flex-1 bg-gray-700 border-blue-500 rounded p-1 text-sm text-white outline-none" autofocus />
                <button @click="updateItem" class="text-xs bg-blue-600 text-white px-2 py-1 rounded">儲存</button>
                <button @click="editingItemId = null" class="text-xs text-gray-500">取消</button>
              </div>
              <template v-else>
                <span class="flex-1 text-gray-300 text-sm leading-relaxed">{{ item.name }}</span>
                <div class="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0 transition-opacity">
                  <button @click="editingItemId = item.id; editingItemName = item.name" class="p-1.5 hover:bg-gray-700 rounded text-blue-400 transition-colors">✏️</button>
                  <button @click="deleteItem(item.id)" class="p-1.5 hover:bg-red-900/30 rounded text-red-500 transition-colors">🗑️</button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="col-span-8 flex flex-col items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-700 bg-gray-900/20">
        <span class="text-5xl mb-4">👈</span>
        <p class="font-bold">請先選擇左側評估套組</p>
      </div>
    </div>
  </div>
  <Transition name="toast">
    <div v-if="toastMsg" class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-700 text-gray-100 text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none z-50">{{ toastMsg }}</div>
  </Transition>
</template>

<style scoped>
.toast-enter-active,.toast-leave-active{transition:opacity .25s,transform .25s}
.toast-enter-from,.toast-leave-to{opacity:0;transform:translateX(-50%) translateY(8px)}
</style>
