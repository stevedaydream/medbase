<script setup lang="ts">
import { ref, watch } from "vue";
import { getDb } from "@/db";

const props = defineProps<{ panelVisible: boolean }>();
const emit  = defineEmits<{
  exit:      [];
  "slide-out": [];
  "slide-in":  [];
  activity:  [];
}>();

// ── 把手互動 ─────────────────────────────────────────────────────────
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let actThrottle = false;

function handleClick() {
  if (props.panelVisible) emit("slide-in");
  else emit("slide-out");
}

function handleEnter() {
  if (!props.panelVisible) {
    hoverTimer = setTimeout(() => emit("slide-out"), 500);
  }
}

function handleLeave() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
}

function onActivity() {
  if (actThrottle) return;
  actThrottle = true;
  setTimeout(() => { actThrottle = false; }, 2000);
  emit("activity");
}

type TabId = "medications" | "items" | "sets" | "physicians";

interface Medication  { id: number; name: string; dose: string; route: string; }
interface Item        { hospital_code: string; name_zh: string; name_en: string; }
interface Physician   { id: number; name: string; department: string; title: string; ext: string; his_account: string; }
interface SetRow      { id: number; name: string; phys_name: string | null; }
interface SetItem     { id: number; set_id: number; hospital_code: string; quantity: number; name_zh: string | null; }

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "medications", icon: "💊", label: "藥物字典" },
  { id: "items",       icon: "📦", label: "自費品項" },
  { id: "sets",        icon: "🗂️", label: "套組" },
  { id: "physicians",  icon: "👤", label: "通訊錄" },
];

const activeTab = ref<TabId>("medications");
const searchQ   = ref("");
const copiedKey = ref("");
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function markCopied(key: string) {
  copiedKey.value = key;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copiedKey.value = ""; }, 1200);
}

async function copyText(text: string, key: string) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  markCopied(key);
}

// ── 藥物字典 ─────────────────────────────────────────────────
const medList = ref<Medication[]>([]);
async function loadMeds() {
  const db = await getDb();
  const q = `%${searchQ.value.trim()}%`;
  medList.value = await db.select<Medication[]>(
    "SELECT id, name, dose, route FROM medications WHERE name LIKE ? OR generic_name LIKE ? ORDER BY name LIMIT 50",
    [q, q]
  );
}

// ── 自費品項 ─────────────────────────────────────────────────
const itemList = ref<Item[]>([]);
async function loadItems() {
  const db = await getDb();
  const q = `%${searchQ.value.trim()}%`;
  itemList.value = await db.select<Item[]>(
    "SELECT hospital_code, name_zh, name_en FROM items WHERE hospital_code LIKE ? OR name_zh LIKE ? OR name_en LIKE ? ORDER BY name_zh LIMIT 50",
    [q, q, q]
  );
}

// ── 套組 ─────────────────────────────────────────────────────
const setList       = ref<SetRow[]>([]);
const activeSet     = ref<SetRow | null>(null);
const activeSetItems = ref<SetItem[]>([]);
const physicianFilter = ref("");
const physicians    = ref<{ id: number; name: string }[]>([]);

async function loadSets() {
  const db = await getDb();
  physicians.value = await db.select<{ id: number; name: string }[]>(
    "SELECT id, name FROM physicians WHERE is_vs=1 ORDER BY name"
  );
  const q = physicianFilter.value ? `%${physicianFilter.value}%` : "%";
  setList.value = await db.select<SetRow[]>(
    `SELECT s.id, s.name, p.name AS phys_name
     FROM sets s LEFT JOIN physicians p ON s.physician_id = p.id
     WHERE (p.name LIKE ? OR s.name LIKE ?)
     ORDER BY p.name, s.name LIMIT 60`,
    [q, q]
  );
}

async function selectSet(s: SetRow) {
  activeSet.value = s;
  const db = await getDb();
  activeSetItems.value = await db.select<SetItem[]>(
    `SELECT si.id, si.set_id, si.hospital_code, si.quantity, i.name_zh
     FROM set_items si LEFT JOIN items i ON si.hospital_code = i.hospital_code
     WHERE si.set_id = ? ORDER BY si.sort_order, si.id`,
    [s.id]
  );
}

async function copyAllCodes() {
  const codes = activeSetItems.value.map(si => si.hospital_code).filter(Boolean).join("\n");
  if (!codes) return;
  await navigator.clipboard.writeText(codes);
  markCopied("all-codes");
}

// ── 通訊錄 ───────────────────────────────────────────────────
const physList       = ref<Physician[]>([]);
const physTitles     = ref<string[]>([]);
const physTitleFilter = ref("");

async function loadPhysicians() {
  const db = await getDb();
  const q = `%${searchQ.value.trim()}%`;

  // 載入所有職稱（僅首次或切換 tab 時需要，但每次都跑也無妨）
  const rows = await db.select<{ title: string }[]>(
    "SELECT DISTINCT title FROM physicians WHERE title IS NOT NULL AND title != '' ORDER BY title"
  );
  physTitles.value = rows.map(r => r.title);

  const titleCond = physTitleFilter.value ? " AND title = ?" : "";
  const params: unknown[] = [q, q];
  if (physTitleFilter.value) params.push(physTitleFilter.value);

  physList.value = await db.select<Physician[]>(
    `SELECT id, name, department, title, ext, his_account FROM physicians WHERE (name LIKE ? OR department LIKE ?)${titleCond} ORDER BY department, name LIMIT 50`,
    params
  );
}

// ── Tab 切換 & 搜尋觸發 ─────────────────────────────────────
function switchTab(id: TabId) {
  activeTab.value = id;
  searchQ.value = "";
  physTitleFilter.value = "";
  activeSet.value = null;
  refreshList();
}

function refreshList() {
  if (activeTab.value === "medications") loadMeds();
  else if (activeTab.value === "items")  loadItems();
  else if (activeTab.value === "sets")   loadSets();
  else if (activeTab.value === "physicians") loadPhysicians();
}

let debounce: ReturnType<typeof setTimeout> | null = null;
watch(searchQ, () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(refreshList, 300);
});

watch(physicianFilter, () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(loadSets, 300);
});

watch(physTitleFilter, () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(loadPhysicians, 150);
});

// Initial load
refreshList();
</script>

<template>
  <div class="flex h-screen bg-gray-950 overflow-hidden">

    <!-- 把手條：隱藏時為唯一可見區域，hover 500ms 自動滑出 -->
    <div
      class="w-7 shrink-0 flex flex-col items-center justify-center gap-1.5
             bg-gray-900 border-r border-gray-700 cursor-pointer select-none
             hover:bg-gray-800 transition-colors"
      :title="panelVisible ? '收起 (Ctrl+Shift+M)' : '展開 (Ctrl+Shift+M)'"
      @click="handleClick"
      @mouseenter="handleEnter"
      @mouseleave="handleLeave"
    >
      <!-- 三條橫線把手圖示 -->
      <span v-for="_ in 3" :key="_" class="block w-3 h-0.5 rounded-full bg-gray-600" />
      <!-- 方向箭頭 -->
      <span class="text-gray-500 text-xs mt-1 leading-none">{{ panelVisible ? '›' : '‹' }}</span>
    </div>

    <!-- 主內容：垂直排列，偵測滑鼠/鍵盤活動以重置閒置計時器 -->
    <div class="flex-1 flex flex-col overflow-hidden"
         @mousemove="onActivity" @keydown.capture="onActivity">

    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-800 shrink-0">
      <span class="text-sm font-bold text-white tracking-tight">MedBase</span>
      <button @click="emit('exit')"
        title="離開精簡模式"
        class="text-gray-500 hover:text-gray-200 text-base transition-colors px-1">
        ⇤
      </button>
    </div>

    <!-- Tab bar -->
    <div class="flex border-b border-gray-800 shrink-0">
      <button
        v-for="tab in TABS" :key="tab.id"
        @click="switchTab(tab.id)"
        :title="tab.label"
        class="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-xs transition-colors"
        :class="activeTab === tab.id ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'">
        <span class="text-base leading-none">{{ tab.icon }}</span>
        <span class="text-[10px] leading-none">{{ tab.label }}</span>
      </button>
    </div>

    <!-- Search / filter -->
    <div class="px-2.5 py-2 border-b border-gray-800 shrink-0">
      <input v-if="activeTab !== 'sets'" v-model="searchQ"
        :placeholder="activeTab === 'medications' ? '藥名…' : activeTab === 'items' ? '品項碼/名稱…' : '醫師名/科別…'"
        class="w-full px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500" />
      <input v-else v-model="physicianFilter"
        placeholder="醫師名稱篩選…"
        class="w-full px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500" />
    </div>

    <!-- Content area -->
    <div class="flex-1 overflow-y-auto">

      <!-- 💊 Medications -->
      <template v-if="activeTab === 'medications'">
        <div v-if="!medList.length" class="text-gray-600 text-xs text-center py-8">
          {{ searchQ ? '無結果' : '輸入藥名搜尋' }}
        </div>
        <div v-for="m in medList" :key="m.id"
          @click="copyText(m.name, `med-${m.id}`)"
          class="flex items-center gap-2 px-3 py-2 border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/40 transition-colors">
          <div class="flex-1 min-w-0">
            <p class="text-sm text-gray-200 truncate" :class="copiedKey === `med-${m.id}` ? 'text-green-400' : ''">
              {{ copiedKey === `med-${m.id}` ? '✓ 已複製' : m.name }}
            </p>
            <p v-if="m.dose || m.route" class="text-xs text-gray-500 truncate">{{ [m.dose, m.route].filter(Boolean).join(' · ') }}</p>
          </div>
        </div>
      </template>

      <!-- 📦 Items -->
      <template v-else-if="activeTab === 'items'">
        <div v-if="!itemList.length" class="text-gray-600 text-xs text-center py-8">
          {{ searchQ ? '無結果' : '輸入品項碼或名稱搜尋' }}
        </div>
        <div v-for="item in itemList" :key="item.hospital_code"
          @click="copyText(item.hospital_code, `item-${item.hospital_code}`)"
          class="flex items-center gap-2 px-3 py-2 border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/40 transition-colors">
          <span class="font-mono text-xs shrink-0 px-1.5 py-0.5 rounded"
            :class="copiedKey === `item-${item.hospital_code}` ? 'bg-green-800 text-green-200' : 'bg-gray-800 text-blue-300'">
            {{ copiedKey === `item-${item.hospital_code}` ? '✓' : item.hospital_code }}
          </span>
          <span class="text-sm text-gray-200 truncate">{{ item.name_zh || item.name_en }}</span>
        </div>
      </template>

      <!-- 🗂️ Sets -->
      <template v-else-if="activeTab === 'sets'">
        <!-- Set list -->
        <template v-if="!activeSet">
          <div v-if="!setList.length" class="text-gray-600 text-xs text-center py-8">無套組</div>
          <div v-for="s in setList" :key="s.id"
            @click="selectSet(s)"
            class="px-3 py-2 border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/40 transition-colors">
            <p class="text-sm text-gray-200 truncate">{{ s.name }}</p>
            <p v-if="s.phys_name" class="text-xs text-gray-500 truncate">{{ s.phys_name }}</p>
          </div>
        </template>
        <!-- Set items -->
        <template v-else>
          <div class="sticky top-0 bg-gray-900 px-3 py-2 border-b border-gray-800 flex items-center gap-2">
            <button @click="activeSet = null; activeSetItems = []"
              class="text-gray-500 hover:text-gray-200 text-sm">←</button>
            <span class="text-sm text-white font-medium flex-1 truncate">{{ activeSet.name }}</span>
            <button @click="copyAllCodes"
              class="text-xs px-2 py-0.5 rounded bg-blue-800/60 text-blue-300 hover:bg-blue-700/60 shrink-0">
              {{ copiedKey === 'all-codes' ? '✓ 已複製' : '全選複製' }}
            </button>
          </div>
          <div v-if="!activeSetItems.length" class="text-gray-600 text-xs text-center py-8">無品項</div>
          <div v-for="si in activeSetItems" :key="si.id"
            @click="copyText(si.hospital_code, `si-${si.id}`)"
            class="flex items-center gap-2 px-3 py-2 border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/40 transition-colors">
            <span class="font-mono text-xs shrink-0 px-1.5 py-0.5 rounded"
              :class="copiedKey === `si-${si.id}` ? 'bg-green-800 text-green-200' : 'bg-gray-800 text-blue-300'">
              {{ copiedKey === `si-${si.id}` ? '✓' : si.hospital_code }}
            </span>
            <div class="flex-1 min-w-0">
              <span class="text-sm text-gray-200 truncate">{{ si.name_zh || si.hospital_code }}</span>
              <span v-if="si.quantity > 1" class="ml-1.5 text-xs text-gray-500">×{{ si.quantity }}</span>
            </div>
          </div>
        </template>
      </template>

      <!-- 👤 Physicians -->
      <template v-else-if="activeTab === 'physicians'">
        <!-- Title filter tags -->
        <div v-if="physTitles.length" class="flex flex-wrap gap-1 px-2.5 py-1.5 border-b border-gray-800/60">
          <button
            @click="physTitleFilter = ''"
            class="px-2 py-0.5 rounded-full text-[10px] transition-colors"
            :class="physTitleFilter === '' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'">
            全部
          </button>
          <button
            v-for="t in physTitles" :key="t"
            @click="physTitleFilter = physTitleFilter === t ? '' : t"
            class="px-2 py-0.5 rounded-full text-[10px] transition-colors"
            :class="physTitleFilter === t ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'">
            {{ t }}
          </button>
        </div>
        <div v-if="!physList.length" class="text-gray-600 text-xs text-center py-8">
          {{ searchQ || physTitleFilter ? '無結果' : '輸入姓名或科別搜尋' }}
        </div>
        <div v-for="p in physList" :key="p.id"
          class="px-3 py-2 border-b border-gray-800/50">
          <p class="text-sm text-gray-200">{{ p.name }}
            <span class="text-xs text-gray-500 ml-1">{{ p.department }}</span>
          </p>
          <div class="flex gap-2 mt-1">
            <button v-if="p.ext" @click="copyText(p.ext, `ext-${p.id}`)"
              class="text-xs px-2 py-0.5 rounded transition-colors"
              :class="copiedKey === `ext-${p.id}` ? 'bg-green-800 text-green-200' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'">
              {{ copiedKey === `ext-${p.id}` ? '✓ 已複製' : `📞 ${p.ext}` }}
            </button>
            <button v-if="p.his_account" @click="copyText(p.his_account, `his-${p.id}`)"
              class="text-xs px-2 py-0.5 rounded transition-colors"
              :class="copiedKey === `his-${p.id}` ? 'bg-green-800 text-green-200' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'">
              {{ copiedKey === `his-${p.id}` ? '✓ 已複製' : `HIS: ${p.his_account}` }}
            </button>
          </div>
        </div>
      </template>

    </div>
    </div><!-- end 主內容 -->
  </div><!-- end 外層 flex -->
</template>
