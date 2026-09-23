<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";
import { touchTable, markDeletedById, onTableSynced } from "@/composables/useTableSync";
import CloudSyncButtons from "@/components/CloudSyncButtons.vue";

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

// 套組名稱 inline 編輯
const renamingSet  = ref(false);
const renameValue  = ref("");


async function saveRename() {
  if (!activeSet.value || !renamingSet.value) return;
  renamingSet.value = false;
  const newName = renameValue.value.trim();
  if (!newName || newName === activeSet.value.name) return;
  try {
    const db = await getDb();
    await db.execute("UPDATE sets SET name=? WHERE id=?", [newName, activeSet.value.id]);
    activeSet.value = { ...activeSet.value, name: newName };
    const idx = sets.value.findIndex(s => s.id === activeSet.value!.id);
    if (idx >= 0) sets.value[idx] = { ...sets.value[idx], name: newName };
    toast("套組名稱已更新");
    await touchTable("sets");
  } catch (e) { toast(`更新失敗：${(e as Error).message}`); }
}

// 刪除確認
const deleteTarget = ref<{ type: "set"|"item"; row: any } | null>(null);

// Toast
const toastMsg = ref("");
function toast(msg: string, ms = 2000) { toastMsg.value = msg; setTimeout(() => toastMsg.value = "", ms); }

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
             COALESCE(si.price, i.price) AS price,
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
    const wasEdit = setModalMode.value === "edit";
    const editedId = f.id;
    await loadAll();
    // 編輯後重新指向更新後的套組物件（讓右側 header 立即顯示新資料）
    if (wasEdit && editedId) {
      const updated = sets.value.find(s => s.id === editedId);
      if (updated) activeSet.value = updated;
    }
    toast(wasEdit ? "套組已更新" : "套組已新增");
    await touchTable("sets");
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
    await touchTable("sets");
  } catch (e) { toast(`新增失敗：${(e as Error).message}`); }
}

async function updateQty(si: SetItem, delta: number) {
  try {
    const newQty = Math.max(1, (si.quantity ?? 1) + delta);
    const db = await getDb();
    await db.execute("UPDATE set_items SET quantity=? WHERE id=?", [newQty, si.id]);
    si.quantity = newQty;
    await touchTable("sets");
  } catch (e) { toast(`更新失敗：${(e as Error).message}`); }
}

async function toggleOptional(si: SetItem) {
  try {
    const db = await getDb();
    const newVal = si.is_optional ? 0 : 1;
    await db.execute("UPDATE set_items SET is_optional=? WHERE id=?", [newVal, si.id]);
    si.is_optional = newVal;
    await touchTable("sets");
  } catch (e) { toast(`更新失敗：${(e as Error).message}`); }
}

async function removeItem(si: SetItem) {
  try {
    const db = await getDb();
    await db.execute("DELETE FROM set_items WHERE id=?", [si.id]);
    setItems.value = setItems.value.filter(x => x.id !== si.id);
    toast("品項已移除");
    await touchTable("sets");
  } catch (e) { toast(`刪除失敗：${(e as Error).message}`); }
}

// ── 雲端同步 ──────────────────────────────────────────────────────
// 背景或其他頁面同步後重新載入，保留目前選取的套組
async function onSynced() {
  const activeId = activeSet.value?.id;
  await loadAll();
  activeSet.value = sets.value.find(x => x.id === activeId) ?? null;
  if (activeSet.value) await loadSetItems(activeSet.value.id);
  else setItems.value = [];
}
onTableSynced("sets", onSynced);

async function doDelete() {
  if (!deleteTarget.value) return;
  try {
    const db = await getDb();
    if (deleteTarget.value.type === "set") {
      await markDeletedById("sets", deleteTarget.value.row.id);
      await db.execute("DELETE FROM set_items WHERE set_id=?", [deleteTarget.value.row.id]);
      await db.execute("DELETE FROM sets WHERE id=?", [deleteTarget.value.row.id]);
      if (activeSet.value?.id === deleteTarget.value.row.id) {
        activeSet.value = null; setItems.value = [];
      }
      await loadAll();
      toast("套組已刪除");
      await touchTable("sets");
    }
  } catch (e) { toast(`刪除失敗：${(e as Error).message}`); }
  finally { deleteTarget.value = null; }
}
</script>

<template>
  <div class="accent-violet flex gap-6 h-full p-1 overflow-hidden">

    <!-- ── 左：套組列表 ──────────────────────────── -->
    <div class="flex flex-col w-80 shrink-0 bg-sunken border border-hairline rounded-2xl p-4 shadow-xl overflow-hidden">
      <!-- 搜尋 + 新增 -->
      <div class="flex gap-2 mb-3 shrink-0">
        <input v-model="searchSet" placeholder="搜尋套組…"
          class="flex-1 px-3 py-2 text-xs rounded-xl bg-sunken border border-hairline text-fg placeholder-muted focus:outline-none focus:border-accent/50 focus:shadow-[0_0_12px_rgba(139,92,246,0.15)] transition-all font-bold" />
        <button @click="openAddSet"
          class="w-9 h-9 rounded-xl bg-accent border border-accent/30 text-white text-lg font-black hover:bg-accent active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
          title="新增套組">＋</button>
      </div>

      <!-- 雲端同步 -->
      <CloudSyncButtons table="sets" class="mb-3 shrink-0" @synced="onSynced" @message="toast" />

      <!-- 分組列表 -->
      <div class="flex-1 overflow-y-auto pr-1 custom-scrollbar">
        <div v-for="group in grouped" :key="group.name" class="mb-2">
          <!-- 醫師群組標題 -->
          <div class="px-2 pt-2.5 pb-1.5 flex items-center gap-2 sticky top-0 bg-sunken/20 backdrop-blur-sm z-[2]">
            <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0"></span>
            <span class="text-xs font-black text-fg tracking-wide truncate flex-1">{{ group.name }}</span>
            <span class="text-2xs font-mono font-bold text-muted bg-surface px-1.5 py-0.5 rounded border border-hairline">{{ group.items.length }}</span>
          </div>
          <!-- 套組項目 -->
          <div class="space-y-1 mt-1 pl-3.5 border-l border-hairline">
            <div
              v-for="s in group.items" :key="s.id"
              @click="selectSet(s)"
              class="group w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all cursor-pointer"
              :class="activeSet?.id === s.id
                ? 'bg-accent/10 border-accent/40 text-accent shadow-[0_0_12px_rgba(139,92,246,0.08)]'
                : 'bg-sunken border-hairline text-fg-secondary hover:text-fg hover:bg-surface/40 hover:border-hairline'"
            >
              <span class="text-xs font-bold truncate flex-1 min-w-0">{{ s.surgery_type || s.name }}</span>
              <button
                @click.stop="deleteTarget = { type: 'set', row: s }"
                class="opacity-0 group-hover:opacity-100 hover:text-danger px-1 transition-opacity shrink-0 cursor-pointer text-sm leading-none"
                :class="activeSet?.id === s.id ? 'text-accent' : 'text-muted'"
                title="刪除套組"
              >×</button>
            </div>
          </div>
        </div>
        <div v-if="grouped.length === 0" class="text-center text-muted text-xs py-10 italic">
          {{ searchSet ? "找不到套組資料" : "目前無套組" }}
        </div>
      </div>
    </div>

    <!-- ── 右：套組內容 ─────────────────────────── -->
    <div class="flex flex-col flex-1 bg-surface border border-hairline rounded-2xl overflow-hidden shadow-2xl min-w-0">

      <!-- 空白提示 -->
      <div v-if="!activeSet" class="flex-1 flex flex-col items-center justify-center text-muted gap-3 py-16">
        <span class="text-5xl">🔪</span>
        <p class="text-xs font-bold tracking-wide">選擇左側套組，或點 ＋ 新增套組</p>
      </div>

      <template v-else>
        <!-- 套組 Header -->
        <div class="flex items-start justify-between p-6 border-b border-hairline shrink-0 bg-sunken">
          <div class="min-w-0 flex-1 mr-4">
            <div class="flex items-center gap-2">
              <template v-if="renamingSet">
                <input
                  v-model="renameValue"
                  @keyup.enter="saveRename"
                  @keyup.esc="renamingSet = false"
                  @blur="saveRename"
                  autofocus
                  class="text-fg font-bold text-base bg-sunken border border-accent/30 rounded-xl px-3 py-1.5 focus:outline-none w-72 focus:shadow-[0_0_12px_rgba(139,92,246,0.15)] transition-all"
                />
              </template>
              <template v-else>
                <h2 class="text-fg font-black text-lg tracking-wide hover:bg-overlay/5 hover:text-fg px-2 py-0.5 rounded-lg cursor-pointer transition-colors" @click="renamingSet = true; renameValue = activeSet.name">
                  {{ activeSet.name }}
                </h2>
              </template>
            </div>
            <div class="flex items-center gap-2.5 mt-2 flex-wrap">
              <span v-if="activeSet.phys_name" class="text-2xs font-bold bg-surface border border-hairline text-fg-secondary px-2 py-0.5 rounded-full">👨‍⚕️ {{ activeSet.phys_name }}</span>
              <span v-if="activeSet.surgery_type" class="text-2xs font-bold bg-accent/10 border border-accent/20 text-accent px-2 py-0.5 rounded-full">🔪 {{ activeSet.surgery_type }}</span>
              <span v-if="activeSet.notes" class="text-2xs text-muted italic max-w-sm truncate">{{ activeSet.notes }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-2xs font-bold text-muted mr-2 bg-sunken px-2 py-1 border border-hairline rounded-lg">
              {{ setItems.filter(i => !i.is_optional).length }} 必用 /
              {{ setItems.filter(i => i.is_optional).length }} PRN
            </span>
            <button @click="openEditSet(activeSet)"
              class="px-3.5 py-2 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:text-fg hover:bg-raised transition-all cursor-pointer">
              編輯套組
            </button>
            <button @click="openAddItem"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent border border-accent/30 text-white text-xs font-black hover:bg-accent active:scale-95 transition-all cursor-pointer">
              ＋ 加入品項
            </button>
          </div>
        </div>

        <!-- 品項列表 -->
        <div class="flex-1 overflow-auto custom-scrollbar">
          <table class="w-full text-xs border-collapse">
            <thead class="sticky top-0 bg-surface border-b border-hairline z-10">
              <tr class="text-fg-secondary text-2xs font-black">
                <th class="text-left px-5 py-4 font-bold">院內碼</th>
                <th class="text-left px-5 py-4 font-bold">品名</th>
                <th class="text-center px-4 py-4 font-bold w-28">數量</th>
                <th class="text-center px-4 py-4 font-bold w-20">PRN (按需)</th>
                <th class="text-right px-5 py-4 font-bold">自費單價</th>
                <th class="text-left px-5 py-4 font-bold">備註</th>
                <th class="w-12 px-4 py-4"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="setItems.length === 0">
                <td colspan="7" class="text-center text-muted py-16 italic font-bold">
                  尚無品項資料，點擊右上角「＋ 加入品項」開始編輯
                </td>
              </tr>
              <tr
                v-for="si in setItems" :key="si.id"
                class="border-b border-hairline hover:bg-overlay/[0.01] transition-colors"
                :class="si.is_optional ? 'opacity-50' : ''"
              >
                <td class="px-5 py-3 font-mono text-xs text-muted select-all">{{ si.hospital_code }}</td>
                <td class="px-5 py-3 text-fg font-bold leading-normal">
                  {{ si.name_zh || si.name_en || si.hospital_code || "—" }}
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center justify-center gap-2">
                    <button @click="updateQty(si, -1)"
                      class="w-5 h-5 rounded-lg border border-hairline bg-sunken text-fg-secondary hover:text-fg hover:bg-elevated transition-colors text-xs leading-none flex items-center justify-center cursor-pointer font-bold">−</button>
                    <span class="text-fg-secondary font-mono text-xs font-bold w-6 text-center">{{ si.quantity }}</span>
                    <button @click="updateQty(si, +1)"
                      class="w-5 h-5 rounded-lg border border-hairline bg-sunken text-fg-secondary hover:text-fg hover:bg-elevated transition-colors text-xs leading-none flex items-center justify-center cursor-pointer font-bold">＋</button>
                  </div>
                </td>
                <td class="px-4 py-3 text-center">
                  <button @click="toggleOptional(si)"
                    class="w-10 h-5 rounded-full transition-all relative border border-hairline cursor-pointer"
                    :class="si.is_optional ? 'bg-warning/30 border-warning/40 shadow-inner' : 'bg-sunken'">
                    <span class="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-fg-secondary transition-all shadow-md"
                      :class="si.is_optional ? 'right-0.5 bg-warning/15 shadow-warning/50' : 'left-0.5 bg-muted'"></span>
                  </button>
                </td>
                <td class="px-5 py-3 text-right font-mono text-xs font-bold"
                  :class="si.is_optional ? 'text-muted' : 'text-success'">
                  {{ si.price ? `$${si.price.toLocaleString()}` : "—" }}
                </td>
                <td class="px-5 py-3 text-muted text-xs">{{ si.notes || "—" }}</td>
                <td class="px-4 py-3 text-center">
                  <button @click="removeItem(si)" class="text-muted hover:text-danger transition-colors text-sm cursor-pointer shrink-0">×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 底部：小計 -->
        <div v-if="setItems.length > 0"
          class="flex items-center justify-end gap-5 px-6 py-4.5 border-t border-hairline bg-sunken text-2xs font-bold font-mono text-muted shrink-0">
          <span>必用 {{ setItems.filter(i=>!i.is_optional).length }} 項</span>
          <span class="text-muted">PRN {{ setItems.filter(i=>i.is_optional).length }} 項（未計費）</span>
          <span class="text-xs text-success font-black tracking-wide bg-success/10 border border-success/20 px-3 py-1 rounded-lg">
            合計 ${{ setTotal.toLocaleString() }}
          </span>
        </div>
      </template>
    </div>
  </div>

  <!-- ════ Modal：新增/編輯套組 ════ -->
  <Teleport to="body">
    <div v-if="showSetModal"
      class="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showSetModal = false">
      <div class="w-full max-w-md bg-surface border border-hairline shadow-2xl rounded-2xl overflow-hidden text-fg">
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline bg-sunken">
          <h3 class="text-xs font-black text-fg">{{ setModalMode === "add" ? "新增套組" : "編輯套組" }}</h3>
          <button @click="showSetModal = false" class="text-muted hover:text-fg text-xl leading-none cursor-pointer">×</button>
        </div>
        <div class="px-5 py-4 space-y-4">
          <!-- 醫師 -->
          <div>
            <label class="text-2xs font-black text-muted mb-1.5 block">主治醫師</label>
            <div class="relative">
              <select v-model="setForm.physician_id" @change="updateSetName"
                class="w-full pl-3 pr-8 py-2 bg-sunken border border-hairline rounded-xl text-fg text-xs focus:outline-none focus:border-accent/50 font-bold appearance-none cursor-pointer">
                <option :value="null">— 未指定醫師 —</option>
                <optgroup label="VS 主治醫師">
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
              <span class="absolute right-3 top-2.5 text-2xs text-muted pointer-events-none">▼</span>
            </div>
          </div>
          <!-- 術式 -->
          <div>
            <label class="text-2xs font-black text-muted mb-1.5 block">術式名稱</label>
            <input v-model="setForm.surgery_type" @input="updateSetName" placeholder="如 TKR / THR / 肩關節鏡…"
              class="w-full px-3.5 py-2 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 font-bold" />
          </div>
          <!-- 套組名稱 -->
          <div>
            <label class="text-2xs font-black text-muted mb-1.5 block">套組顯示名稱 *</label>
            <input v-model="setForm.name" placeholder="系統自動產生，或手動覆寫"
              class="w-full px-3.5 py-2 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 font-bold" />
          </div>
          <!-- 備註 -->
          <div>
            <label class="text-2xs font-black text-muted mb-1.5 block">備註說明</label>
            <input v-model="setForm.notes" placeholder="其他配製或備註"
              class="w-full px-3.5 py-2 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 font-bold" />
          </div>
        </div>
        <div class="flex justify-end gap-2.5 px-5 py-4 border-t border-hairline bg-sunken shrink-0">
          <button @click="showSetModal = false" class="px-4 py-2 text-xs font-bold bg-elevated text-fg-secondary hover:text-fg hover:bg-raised rounded-xl transition-all cursor-pointer">取消</button>
          <button @click="saveSet" :disabled="!setForm.name?.trim()" class="px-5 py-2 text-xs font-black bg-accent hover:bg-accent border border-accent/30 text-white rounded-xl transition-all disabled:opacity-40 cursor-pointer">儲存套組</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ════ Modal：加入品項 ════ -->
  <Teleport to="body">
    <div v-if="showAddItem"
      class="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showAddItem = false">
      <div class="w-full max-w-md bg-surface border border-hairline shadow-2xl rounded-2xl overflow-hidden text-fg">
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline bg-sunken">
          <h3 class="text-xs font-black text-fg">加入品項</h3>
          <button @click="showAddItem = false" class="text-muted hover:text-fg text-xl leading-none cursor-pointer">×</button>
        </div>
        <div class="px-5 py-4 space-y-4">
          <!-- 品項搜尋 -->
          <div class="relative">
            <label class="text-2xs font-black text-muted mb-1.5 block">搜尋品項（院內碼 / 中文 / 英文）</label>
            <input v-model="itemSearch" placeholder="請輸入院內碼或自費品名搜尋…"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 font-bold" />
            <!-- 建議下拉 -->
            <div v-if="suggestions.length > 0"
              class="absolute z-10 w-full mt-1.5 bg-sunken border border-hairline rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto custom-scrollbar">
              <button
                v-for="s in suggestions" :key="s.hospital_code"
                @click="pickSuggestion(s)"
                class="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface transition-colors border-b border-hairline cursor-pointer">
                <span class="font-mono text-xs text-fg-secondary w-20 shrink-0 font-bold">{{ s.hospital_code }}</span>
                <span class="text-fg text-xs truncate flex-1 font-bold">{{ s.name_zh || s.name_en }}</span>
                <span class="text-success font-mono text-xs shrink-0 font-bold">
                  {{ s.price ? `$${s.price.toLocaleString()}` : "" }}
                </span>
              </button>
            </div>
          </div>
          <!-- 院內碼（選完後顯示） -->
          <div v-if="itemForm.hospital_code" class="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/20 border border-accent/30 shadow-inner">
            <span class="font-mono text-xs text-accent font-bold">{{ itemForm.hospital_code }}</span>
            <button @click="itemForm.hospital_code=''; itemSearch=''" class="ml-auto text-muted hover:text-fg-secondary cursor-pointer">×</button>
          </div>
          <!-- 數量 + PRN -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-2xs font-black text-muted mb-1.5 block">數量</label>
              <input v-model.number="itemForm.quantity" type="number" min="1"
                class="w-full px-3.5 py-2 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 font-mono font-bold" />
            </div>
            <div class="flex flex-col justify-end">
              <label class="flex items-center gap-2 cursor-pointer pb-2 select-none">
                <input type="checkbox" v-model="itemForm.is_optional" :true-value="1" :false-value="0"
                  class="w-4 h-4 rounded accent-accent bg-sunken border border-hairline" />
                <span class="text-xs font-bold text-fg-secondary">PRN 按需（不計費）</span>
              </label>
            </div>
          </div>
          <!-- 備註 -->
          <div>
            <label class="text-2xs font-black text-muted mb-1.5 block">備註說明</label>
            <input v-model="itemForm.notes" placeholder="e.g. 特殊指名才使用 / 次要選擇…"
              class="w-full px-3.5 py-2 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 font-bold" />
          </div>
        </div>
        <div class="flex justify-end gap-2.5 px-5 py-4 border-t border-hairline bg-sunken shrink-0">
          <button @click="showAddItem = false" class="px-4 py-2 text-xs font-bold bg-elevated text-fg-secondary hover:text-fg hover:bg-raised rounded-xl transition-all cursor-pointer">取消</button>
          <button @click="addItem"
            :disabled="!itemForm.hospital_code"
            class="px-5 py-2 text-xs font-black bg-accent hover:bg-accent border border-accent/30 text-white rounded-xl transition-all disabled:opacity-40 cursor-pointer">
            確認加入
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ════ 刪除確認 ════ -->
  <Teleport to="body">
    <div v-if="deleteTarget"
      class="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-surface border border-hairline shadow-2xl p-6 rounded-2xl text-center text-fg">
        <div class="text-3xl mb-3">🗑️</div>
        <p class="text-sm font-bold mb-1">確認刪除套組？</p>
        <p class="text-xs text-muted mb-5 leading-normal">套組內包含的所有自費品項清單關聯也會一併刪除（此動作無法復原）。</p>
        <div class="flex gap-3 justify-center">
          <button @click="deleteTarget = null"
            class="px-5 py-2 rounded-xl text-xs font-bold bg-elevated text-fg-secondary hover:text-fg hover:bg-raised border border-hairline cursor-pointer">取消</button>
          <button @click="doDelete"
            class="px-5 py-2 rounded-xl bg-danger hover:bg-danger border border-danger/30 text-white text-xs font-black cursor-pointer">確認刪除</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="toastMsg"
        class="fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl bg-surface border border-hairline text-fg text-xs font-bold shadow-2xl">
        {{ toastMsg }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }

/* Custom scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
