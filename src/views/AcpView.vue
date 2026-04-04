<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getDb } from "@/db";

interface AcpSet { id: number; name: string; }
interface AcpItem { id: number; set_id: number; category_type: string; name: string; }

type Status = 'prescribed' | 'unprescribed' | 'na';
interface EvalState {
  status: Status;
  category: string;
}

const sets = ref<AcpSet[]>([]);
const allItems = ref<AcpItem[]>([]);
const selectedSetId = ref<number | null>(null);
const activeTab = ref<string>('general');
const toastMsg = ref("");
function showToast(msg: string) { toastMsg.value = msg; setTimeout(() => { toastMsg.value = ""; }, 2500); }

// 存儲所有項目的勾選狀態: { [itemId]: { status, category } }
const evalStates = ref<Record<number, EvalState>>({});

async function loadInitialData() {
  try {
    const db = await getDb();
    sets.value = await db.select<AcpSet[]>("SELECT * FROM acp_sets WHERE is_active = 1");
    if (sets.value.length > 0) selectSet(sets.value[0].id);
  } catch (e) { showToast(`載入失敗：${(e as Error).message}`); }
}

async function selectSet(id: number) {
  try {
    selectedSetId.value = id;
    const db = await getDb();
    allItems.value = await db.select<AcpItem[]>("SELECT * FROM acp_items WHERE set_id = ?", [id]);
    evalStates.value = {};
    allItems.value.forEach(item => {
      evalStates.value[item.id] = { status: 'unprescribed', category: item.category_type };
    });
  } catch (e) { showToast(`載入失敗：${(e as Error).message}`); }
}

onMounted(loadInitialData);

// ── 統計邏輯 ─────────────────────────────────────────────────────
function getStatsForCategory(category: string) {
  const items = allItems.value.filter(i => i.category_type === category);
  const states = items.map(i => evalStates.value[i.id]).filter(Boolean);
  
  const prescribed = states.filter(s => s.status === 'prescribed').length;
  const unprescribed = states.filter(s => s.status === 'unprescribed').length;
  const na = states.filter(s => s.status === 'na').length;
  const expected = items.length - na;
  const rate = expected > 0 ? (prescribed / expected) * 100 : 0;

  return { total: items.length, prescribed, unprescribed, na, expected, rate: rate.toFixed(1) };
}

const generalStats = computed(() => getStatsForCategory('general'));
const medicationStats = computed(() => getStatsForCategory('medication'));
const procedureStats = computed(() => getStatsForCategory('procedure'));

const totalStats = computed(() => {
  const states = Object.values(evalStates.value);
  const prescribed = states.filter(s => s.status === 'prescribed').length;
  const unprescribed = states.filter(s => s.status === 'unprescribed').length;
  const na = states.filter(s => s.status === 'na').length;
  const totalItems = allItems.value.length;
  const expected = totalItems - na;
  const rate = expected > 0 ? (prescribed / expected) * 100 : 0;

  return { total: totalItems, prescribed, unprescribed, na, expected, rate: rate.toFixed(1) };
});

const currentTabItems = computed(() => allItems.value.filter(i => i.category_type === activeTab.value));

async function saveRecord() {
  try {
    const db = await getDb();
    const setName = sets.value.find(s => s.id === selectedSetId.value)?.name || "Unknown";
    await db.execute(
      `INSERT INTO acp_records (set_name, total_expected, total_prescribed, total_na, completion_rate, details_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        setName,
        totalStats.value.expected,
        totalStats.value.prescribed,
        totalStats.value.na,
        totalStats.value.rate,
        JSON.stringify({
          stats: { general: generalStats.value, medication: medicationStats.value, procedure: procedureStats.value, total: totalStats.value },
          items: allItems.value.map(i => ({ ...i, status: evalStates.value[i.id].status }))
        })
      ]
    );
    showToast("評估紀錄已儲存");
  } catch (e) { showToast(`儲存失敗：${(e as Error).message}`); }
}

const tabs = [
  { key: 'general',    label: '一般囑言', icon: '📝' },
  { key: 'medication', label: '藥囑',     icon: '💊' },
  { key: 'procedure',  label: '處置',     icon: '🏥' },
];
</script>

<template>
  <div class="flex h-full overflow-hidden bg-zinc-950">
    <!-- Left Sidebar: Sets -->
    <div class="w-64 border-r border-zinc-800 bg-zinc-900/50 p-4 flex flex-col">
      <h3 class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">評估套組</h3>
      <div class="flex-1 overflow-y-auto space-y-2">
        <button v-for="s in sets" :key="s.id"
                @click="selectSet(s.id)"
                class="w-full text-left px-4 py-3 rounded-xl transition-all border font-bold text-sm"
                :class="selectedSetId === s.id 
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg' 
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'">
          {{ s.name }}
        </button>
      </div>
      <div class="pt-4 border-t border-zinc-800">
        <router-link to="/acp/settings" class="text-xs text-zinc-500 hover:text-blue-400 flex items-center gap-2 px-2">
          ⚙️ 模板設定
        </router-link>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- 1. Global Dashboard -->
      <div class="p-6 bg-zinc-900/30 border-b border-zinc-800 shrink-0">
        <div class="grid grid-cols-12 gap-4">
          <!-- Total Score -->
          <div class="col-span-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-center items-center">
            <p class="text-[10px] text-zinc-500 font-bold uppercase mb-1">總完成率</p>
            <p class="text-4xl font-black" :class="Number(totalStats.rate) >= 80 ? 'text-green-400' : 'text-amber-400'">{{ totalStats.rate }}%</p>
            <div class="mt-2 flex gap-3 text-[10px] font-mono text-zinc-400">
              <span>已開:{{ totalStats.prescribed }}</span>
              <span>未開:{{ totalStats.unprescribed }}</span>
              <span>NA:{{ totalStats.na }}</span>
            </div>
          </div>

          <!-- Category Breakdown -->
          <div class="col-span-9 grid grid-cols-3 gap-3">
            <div v-for="t in tabs" :key="t.key" 
                 class="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 flex flex-col justify-between"
                 :class="activeTab === t.key ? 'border-blue-500/50 ring-1 ring-blue-500/20' : ''">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-bold text-zinc-300">{{ t.label }}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{{ 
                  t.key === 'general' ? generalStats.rate : t.key === 'medication' ? medicationStats.rate : procedureStats.rate 
                }}%</span>
              </div>
              <div class="flex justify-between items-end">
                <div class="space-y-0.5">
                  <p class="text-[10px] text-zinc-500">已/未/NA</p>
                  <p class="text-sm font-mono font-bold text-zinc-200">
                    {{ t.key === 'general' ? `${generalStats.prescribed}/${generalStats.unprescribed}/${generalStats.na}` : 
                       t.key === 'medication' ? `${medicationStats.prescribed}/${medicationStats.unprescribed}/${medicationStats.na}` : 
                       `${procedureStats.prescribed}/${procedureStats.unprescribed}/${procedureStats.na}` }}
                  </p>
                </div>
                <button @click="saveRecord" v-if="t.key === 'procedure'" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-900/20">
                  💾 儲存
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Tabs Switcher -->
      <div class="px-6 py-4 bg-zinc-950 shrink-0">
        <div class="flex gap-1 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
          <button v-for="tab in tabs" :key="tab.key"
                  @click="activeTab = tab.key"
                  class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-black transition-all"
                  :class="activeTab === tab.key ? 'bg-zinc-800 text-blue-400 shadow-inner' : 'text-zinc-500 hover:text-zinc-300'">
            <span class="text-lg">{{ tab.icon }}</span>
            <span>{{ tab.label }}</span>
          </button>
        </div>
      </div>

      <!-- 3. Evaluation Items List -->
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <div v-if="currentTabItems.length === 0" class="flex flex-col items-center justify-center h-64 text-zinc-700 italic">
          <p>此類別尚未設定醫囑項目</p>
        </div>
        <div class="space-y-3 max-w-4xl mx-auto">
          <div v-for="item in currentTabItems" :key="item.id" 
               class="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-4 transition-all shadow-sm"
               :class="{
                 'border-green-900/30 bg-green-950/5': evalStates[item.id]?.status === 'prescribed',
                 'border-amber-900/30 bg-amber-950/5': evalStates[item.id]?.status === 'na'
               }">
            
            <div class="flex-1 min-w-0">
              <h4 class="text-zinc-200 font-bold text-sm leading-snug">{{ item.name }}</h4>
            </div>

            <!-- Status Buttons -->
            <div class="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 shrink-0">
              <button @click="evalStates[item.id].status = 'prescribed'" 
                      class="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all"
                      :class="evalStates[item.id]?.status === 'prescribed' ? 'bg-green-600 text-white shadow-lg shadow-green-900/20' : 'text-zinc-600 hover:text-zinc-400'">
                已開
              </button>
              <button @click="evalStates[item.id].status = 'unprescribed'" 
                      class="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all"
                      :class="evalStates[item.id]?.status === 'unprescribed' ? 'bg-zinc-700 text-white shadow-inner' : 'text-zinc-600 hover:text-zinc-400'">
                未開
              </button>
              <button @click="evalStates[item.id].status = 'na'" 
                      class="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all"
                      :class="evalStates[item.id]?.status === 'na' ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/20' : 'text-zinc-600 hover:text-zinc-400'">
                N/A
              </button>
            </div>
          </div>
        </div>
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
