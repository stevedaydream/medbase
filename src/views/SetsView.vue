<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";

// ── 型別 ────────────────────────────────────────────────────────
interface Physician { id: number; name: string; department: string | null; is_vs: number; }
interface SetRow {
  id: number; name: string; surgery_type: string | null;
  physician_id: number | null; department_id: number | null; notes: string | null;
  phys_name?: string | null;
}
interface SetItem {
  id: number; set_id: number; hospital_code: string | null;
  quantity: number; is_optional: number; sort_order: number;
  price: number | null; notes: string | null;
  name_zh?: string | null; name_en?: string | null;  // joined from items
}
interface ItemSuggestion {
  hospital_code: string; name_zh: string | null; name_en: string | null; price: number | null;
}

// ── 狀態 ────────────────────────────────────────────────────────
const sets       = ref<SetRow[]>([]);
const physicians = ref<Physician[]>([]);
const activeSet  = ref<SetRow | null>(null);
const setItems   = ref<SetItem[]>([]);
const allItems   = ref<ItemSuggestion[]>([]);

// 搜尋
const searchSet  = ref("");

// 新增/編輯套組
const showSetModal = ref(false);
const setModalMode = ref<"add"|"edit">("add");
const setForm = ref<Partial<SetRow>>({});

// 新增品項
const showAddItem   = ref(false);
const itemSearch    = ref("");
const itemForm      = ref({ hospital_code: "", quantity: 1, is_optional: 0, notes: "" });
const suggestions   = computed(() => {
  const q = itemSearch.value.toLowerCase().trim();
  if (!q || q.length < 1) return [];
  return allItems.value
    .filter(i =>
      i.hospital_code.toLowerCase().includes(q) ||
      i.name_zh?.toLowerCase().includes(q) ||
      i.name_en?.toLowerCase().includes(q))
    .slice(0, 8);
});

// 刪除確認
const deleteTarget = ref<{ type: "set"|"item"; row: any } | null>(null);

// Toast
const toastMsg = ref("");
function toast(msg: string) { toastMsg.value = msg; setTimeout(() => toastMsg.value = "", 2000); }

// ── 載入 ─────────────────────────────────────────────────────────
onMounted(loadAll);

async function loadAll() {
  try {
    const db = await getDb();
    physicians.value = await db.select<Physician[]>(
      "SELECT id, name, department, is_vs FROM physicians ORDER BY department, name"
    );
    sets.value = await db.select<SetRow[]>(`
      SELECT s.*, p.name AS phys_name
      FROM sets s LEFT JOIN physicians p ON s.physician_id = p.id
      ORDER BY p.name, s.surgery_type
    `);
    allItems.value = await db.select<ItemSuggestion[]>(
      "SELECT hospital_code, name_zh, name_en, price FROM items ORDER BY name_zh"
    );
    if (activeSet.value) await loadSetItems(activeSet.value.id);
  } catch (e) { toast(`載入失敗：${(e as Error).message}`); }
}

async function loadSetItems(setId: number) {
  try {
    const db = await getDb();
    setItems.value = await db.select<SetItem[]>(`
      SELECT si.*,
             i.name_zh, i.name_en
      FROM set_items si
      LEFT JOIN items i ON si.hospital_code = i.hospital_code
      WHERE si.set_id = ?
      ORDER BY si.sort_order, si.id
    `, [setId]);
  } catch (e) { toast(`載入品項失敗：${(e as Error).message}`); }
}

async function selectSet(s: SetRow) {
  activeSet.value = s;
  await loadSetItems(s.id);
}

// ── 分組顯示：依醫師姓名分組 ─────────────────────────────────────
const grouped = computed(() => {
  const q = searchSet.value.toLowerCase().trim();
  const filtered = q
    ? sets.value.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.phys_name?.toLowerCase().includes(q) ||
        s.surgery_type?.toLowerCase().includes(q))
    : sets.value;

  const map = new Map<string, SetRow[]>();
  for (const s of filtered) {
    const key = s.phys_name ?? "（未指定醫師）";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
});

const setTotal = computed(() => {
  if (!setItems.value.length) return 0;
  return setItems.value.reduce((sum, si) => sum + (si.price ?? 0) * (si.is_optional ? 0 : (si.quantity ?? 1)), 0);
});

// ── CRUD：套組 ───────────────────────────────────────────────────
function openAddSet() {
  setModalMode.value = "add";
  setForm.value = { physician_id: null, surgery_type: "", name: "", notes: "" };
  showSetModal.value = true;
}
function openEditSet(s: SetRow) {
  setModalMode.value = "edit";
  setForm.value = { ...s };
  showSetModal.value = true;
}

// 當醫師或術式改變時自動產生建議名稱
function updateSetName() {
  const f = setForm.value;
  if (setModalMode.value === "add") {
    const doc = physicians.value.find(p => p.id === f.physician_id);
    const parts = [doc?.name, f.surgery_type].filter(Boolean);
    f.name = parts.join(" - ");
  }
}

async function saveSet() {
  const f = setForm.value;
  if (!f.name?.trim()) return;
  try {
    const db = await getDb();
    if (setModalMode.value === "add") {
      await db.execute(
        "INSERT INTO sets (name, surgery_type, physician_id, department_id, notes) VALUES (?,?,?,?,?)",
        [f.name, f.surgery_type||null, f.physician_id||null, f.department_id||null, f.notes||null]
      );
    } else {
      await db.execute(
        "UPDATE sets SET name=?, surgery_type=?, physician_id=?, notes=? WHERE id=?",
        [f.name, f.surgery_type||null, f.physician_id||null, f.notes||null, f.id]
      );
    }
    showSetModal.value = false;
    await loadAll();
    toast(setModalMode.value === "add" ? "套組已新增" : "套組已更新");
  } catch (e) { toast(`儲存失敗：${(e as Error).message}`); }
}

// ── CRUD：套組品項 ───────────────────────────────────────────────
function openAddItem() {
  itemForm.value = { hospital_code: "", quantity: 1, is_optional: 0, notes: "" };
  itemSearch.value = "";
  showAddItem.value = true;
}

function pickSuggestion(s: ItemSuggestion) {
  itemForm.value.hospital_code = s.hospital_code;
  itemSearch.value = `${s.hospital_code}　${s.name_zh ?? s.name_en ?? ""}`;
}

async function addItem() {
  if (!activeSet.value || !itemForm.value.hospital_code) return;
  try {
    const db = await getDb();
    const maxOrder = setItems.value.length
      ? Math.max(...setItems.value.map(si => si.sort_order)) + 1
      : 0;
    await db.execute(
      `INSERT INTO set_items (set_id, hospital_code, quantity, is_optional, sort_order, notes)
       VALUES (?,?,?,?,?,?)`,
      [activeSet.value.id, itemForm.value.hospital_code,
       itemForm.value.quantity, itemForm.value.is_optional,
       maxOrder, itemForm.value.notes || null]
    );
    showAddItem.value = false;
    await loadSetItems(activeSet.value.id);
    toast("品項已加入");
  } catch (e) { toast(`新增失敗：${(e as Error).message}`); }
}

async function updateQty(si: SetItem, delta: number) {
  try {
    const newQty = Math.max(1, (si.quantity ?? 1) + delta);
    const db = await getDb();
    await db.execute("UPDATE set_items SET quantity=? WHERE id=?", [newQty, si.id]);
    si.quantity = newQty;
  } catch (e) { toast(`更新失敗：${(e as Error).message}`); }
}

async function toggleOptional(si: SetItem) {
  try {
    const db = await getDb();
    const newVal = si.is_optional ? 0 : 1;
    await db.execute("UPDATE set_items SET is_optional=? WHERE id=?", [newVal, si.id]);
    si.is_optional = newVal;
  } catch (e) { toast(`更新失敗：${(e as Error).message}`); }
}

async function removeItem(si: SetItem) {
  try {
    const db = await getDb();
    await db.execute("DELETE FROM set_items WHERE id=?", [si.id]);
    setItems.value = setItems.value.filter(x => x.id !== si.id);
    toast("品項已移除");
  } catch (e) { toast(`刪除失敗：${(e as Error).message}`); }
}

async function doDelete() {
  if (!deleteTarget.value) return;
  try {
    const db = await getDb();
    if (deleteTarget.value.type === "set") {
      await db.execute("DELETE FROM sets WHERE id=?", [deleteTarget.value.row.id]);
      if (activeSet.value?.id === deleteTarget.value.row.id) {
        activeSet.value = null; setItems.value = [];
      }
      await loadAll();
      toast("套組已刪除");
    }
  } catch (e) { toast(`刪除失敗：${(e as Error).message}`); }
  finally { deleteTarget.value = null; }
}
</script>

<template>
  <div class="flex h-full overflow-hidden">

    <!-- ── 左：套組列表 ──────────────────────────── -->
    <div class="flex flex-col w-60 shrink-0 border-r border-gray-800 overflow-hidden">
      <!-- 搜尋 + 新增 -->
      <div class="p-3 border-b border-gray-800 flex gap-2">
        <input v-model="searchSet" placeholder="搜尋套組…"
          class="flex-1 px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-xs placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        <button @click="openAddSet"
          class="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shrink-0">
          ＋
        </button>
      </div>

      <!-- 分組列表 -->
      <div class="flex-1 overflow-y-auto py-1">
        <div v-for="group in grouped" :key="group.name" class="mb-1">
          <!-- 醫師群組標題 -->
          <div class="px-3 py-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            {{ group.name }}
          </div>
          <!-- 套組項目 -->
          <button
            v-for="s in group.items" :key="s.id"
            @click="selectSet(s)"
            class="w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors"
            :class="activeSet?.id === s.id
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-800'"
          >
            <span class="truncate">{{ s.surgery_type || s.name }}</span>
            <span class="flex gap-1 shrink-0 ml-1">
              <button
                @click.stop="openEditSet(s)"
                class="opacity-0 group-hover:opacity-100 hover:text-blue-300 px-1"
                :class="activeSet?.id === s.id ? 'text-blue-200' : 'text-gray-500'"
              >✏</button>
              <button
                @click.stop="deleteTarget = { type: 'set', row: s }"
                class="hover:text-red-400 px-1"
                :class="activeSet?.id === s.id ? 'text-blue-200' : 'text-gray-600'"
              >×</button>
            </span>
          </button>
        </div>
        <div v-if="grouped.length === 0" class="text-center text-gray-600 text-xs py-8">
          {{ searchSet ? "找不到套組" : "尚無套組" }}
        </div>
      </div>
    </div>

    <!-- ── 右：套組內容 ─────────────────────────── -->
    <div class="flex flex-col flex-1 overflow-hidden">

      <!-- 空白提示 -->
      <div v-if="!activeSet" class="flex-1 flex items-center justify-center text-gray-600 text-sm">
        ← 選擇左側套組，或點 ＋ 新增
      </div>

      <template v-else>
        <!-- 套組 Header -->
        <div class="flex items-start justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 class="text-gray-100 font-semibold text-base">{{ activeSet.name }}</h2>
            <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span v-if="activeSet.phys_name">👨‍⚕️ {{ activeSet.phys_name }}</span>
              <span v-if="activeSet.surgery_type">🔪 {{ activeSet.surgery_type }}</span>
              <span v-if="activeSet.notes" class="text-gray-600">{{ activeSet.notes }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs text-gray-500">
              {{ setItems.filter(i => !i.is_optional).length }} 必用 ＋
              {{ setItems.filter(i => i.is_optional).length }} PRN
            </span>
            <button @click="openAddItem"
              class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">
              ＋ 加入品項
            </button>
          </div>
        </div>

        <!-- 品項列表 -->
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-gray-900 z-10">
              <tr class="border-b border-gray-800 text-gray-500 text-xs">
                <th class="text-left px-4 py-2.5 font-medium">院內碼</th>
                <th class="text-left px-4 py-2.5 font-medium">品名</th>
                <th class="text-center px-3 py-2.5 font-medium w-24">數量</th>
                <th class="text-center px-3 py-2.5 font-medium w-16">PRN</th>
                <th class="text-right px-4 py-2.5 font-medium">價格</th>
                <th class="text-left px-4 py-2.5 font-medium">備註</th>
                <th class="w-10 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="setItems.length === 0">
                <td colspan="7" class="text-center text-gray-600 py-10 text-xs">
                  尚無品項，點「＋ 加入品項」開始新增
                </td>
              </tr>
              <tr
                v-for="si in setItems" :key="si.id"
                class="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                :class="si.is_optional ? 'opacity-60' : ''"
              >
                <td class="px-4 py-2 font-mono text-xs text-gray-400">{{ si.hospital_code }}</td>
                <td class="px-4 py-2 text-gray-200">
                  {{ si.name_zh || si.name_en || si.hospital_code || "—" }}
                </td>
                <td class="px-3 py-2">
                  <div class="flex items-center justify-center gap-1">
                    <button @click="updateQty(si, -1)"
                      class="w-5 h-5 rounded text-gray-400 hover:bg-gray-700 hover:text-white text-xs leading-none">−</button>
                    <span class="text-gray-300 font-mono w-4 text-center text-xs">{{ si.quantity }}</span>
                    <button @click="updateQty(si, +1)"
                      class="w-5 h-5 rounded text-gray-400 hover:bg-gray-700 hover:text-white text-xs leading-none">＋</button>
                  </div>
                </td>
                <td class="px-3 py-2 text-center">
                  <button @click="toggleOptional(si)"
                    class="w-8 h-4 rounded-full transition-colors relative"
                    :class="si.is_optional ? 'bg-amber-600' : 'bg-gray-700'">
                    <span class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                      :class="si.is_optional ? 'right-0.5' : 'left-0.5'"></span>
                  </button>
                </td>
                <td class="px-4 py-2 text-right font-mono text-xs"
                  :class="si.is_optional ? 'text-gray-600' : 'text-green-400'">
                  {{ si.price ? `$${si.price.toLocaleString()}` : "—" }}
                </td>
                <td class="px-4 py-2 text-gray-500 text-xs">{{ si.notes || "—" }}</td>
                <td class="px-3 py-2">
                  <button @click="removeItem(si)" class="text-gray-600 hover:text-red-400 text-sm">×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 底部：小計 -->
        <div v-if="setItems.length > 0"
          class="flex items-center justify-end gap-4 px-5 py-3 border-t border-gray-800 text-xs text-gray-500 shrink-0">
          <span>必用 {{ setItems.filter(i=>!i.is_optional).length }} 項</span>
          <span class="text-gray-600">PRN {{ setItems.filter(i=>i.is_optional).length }} 項（不計入）</span>
          <span class="text-sm font-mono text-green-400 font-semibold">
            合計 ${{ setTotal.toLocaleString() }}
          </span>
        </div>
      </template>
    </div>
  </div>

  <!-- ════ Modal：新增/編輯套組 ════ -->
  <Teleport to="body">
    <div v-if="showSetModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="showSetModal = false">
      <div class="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 class="font-semibold text-gray-100">{{ setModalMode === "add" ? "新增套組" : "編輯套組" }}</h3>
          <button @click="showSetModal = false" class="text-gray-500 hover:text-gray-300 text-xl">×</button>
        </div>
        <div class="px-5 py-4 space-y-3">
          <!-- 醫師 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">主治醫師</label>
            <select v-model="setForm.physician_id" @change="updateSetName"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500">
              <option :value="null">— 未指定 —</option>
              <optgroup label="套組 VS（is_vs）">
                <option v-for="p in physicians.filter(p=>p.is_vs)" :key="p.id" :value="p.id">
                  {{ p.name }}{{ p.department ? ` (${p.department})` : "" }}
                </option>
              </optgroup>
              <optgroup label="其他醫師">
                <option v-for="p in physicians.filter(p=>!p.is_vs)" :key="p.id" :value="p.id">
                  {{ p.name }}{{ p.department ? ` (${p.department})` : "" }}
                </option>
              </optgroup>
            </select>
          </div>
          <!-- 術式 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">術式</label>
            <input v-model="setForm.surgery_type" @input="updateSetName" placeholder="TKR / THR / 肩關節鏡…"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <!-- 套組名稱 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">套組名稱 *</label>
            <input v-model="setForm.name" placeholder="自動產生或手動輸入"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <!-- 備註 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">備註</label>
            <input v-model="setForm.notes"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button @click="showSetModal = false" class="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-800">取消</button>
          <button @click="saveSet" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">儲存</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ════ Modal：加入品項 ════ -->
  <Teleport to="body">
    <div v-if="showAddItem"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      @click.self="showAddItem = false">
      <div class="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 class="font-semibold text-gray-100">加入品項</h3>
          <button @click="showAddItem = false" class="text-gray-500 hover:text-gray-300 text-xl">×</button>
        </div>
        <div class="px-5 py-4 space-y-3">
          <!-- 品項搜尋 -->
          <div class="relative">
            <label class="text-xs text-gray-500 mb-1 block">搜尋品項（院內碼 / 中文 / 英文）</label>
            <input v-model="itemSearch" placeholder="e.g. M1C50965 或 膝關節"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
            <!-- 建議下拉 -->
            <div v-if="suggestions.length > 0"
              class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
              <button
                v-for="s in suggestions" :key="s.hospital_code"
                @click="pickSuggestion(s)"
                class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-700 transition-colors">
                <span class="font-mono text-xs text-gray-400 w-20 shrink-0">{{ s.hospital_code }}</span>
                <span class="text-gray-200 text-xs truncate">{{ s.name_zh || s.name_en }}</span>
                <span class="ml-auto text-green-400 font-mono text-xs shrink-0">
                  {{ s.price ? `$${s.price.toLocaleString()}` : "" }}
                </span>
              </button>
            </div>
          </div>
          <!-- 院內碼（選完後顯示） -->
          <div v-if="itemForm.hospital_code" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-blue-700">
            <span class="font-mono text-xs text-blue-400">{{ itemForm.hospital_code }}</span>
            <button @click="itemForm.hospital_code=''; itemSearch=''" class="ml-auto text-gray-500 hover:text-gray-300">×</button>
          </div>
          <!-- 數量 + PRN -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-500 mb-1 block">數量</label>
              <input v-model.number="itemForm.quantity" type="number" min="1"
                class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div class="flex flex-col justify-end">
              <label class="flex items-center gap-2 cursor-pointer pb-1.5">
                <input type="checkbox" v-model="itemForm.is_optional" :true-value="1" :false-value="0"
                  class="w-4 h-4 rounded accent-amber-500" />
                <span class="text-sm text-gray-300">PRN（按需）</span>
              </label>
            </div>
          </div>
          <!-- 備註 -->
          <div>
            <label class="text-xs text-gray-500 mb-1 block">備註</label>
            <input v-model="itemForm.notes" placeholder="e.g. 主任有說才用"
              class="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-sm focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button @click="showAddItem = false" class="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-800">取消</button>
          <button @click="addItem"
            :disabled="!itemForm.hospital_code"
            class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-40">
            加入
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ════ 刪除確認 ════ -->
  <Teleport to="body">
    <div v-if="deleteTarget"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl p-6 text-center">
        <div class="text-3xl mb-3">🗑️</div>
        <p class="text-sm text-gray-300 mb-1 font-medium">確認刪除套組？</p>
        <p class="text-xs text-gray-500 mb-5">套組內所有品項也會一併刪除（無法復原）</p>
        <div class="flex gap-3 justify-center">
          <button @click="deleteTarget = null"
            class="px-5 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 border border-gray-700">取消</button>
          <button @click="doDelete"
            class="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium">確認刪除</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="toastMsg"
        class="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 text-sm shadow-2xl">
        {{ toastMsg }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
