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
  <div class="flex h-full overflow-hidden bg-slate-950 text-slate-100 select-none">
    <!-- Left Sidebar: Sets -->
    <aside class="w-64 border-r border-white/5 bg-slate-900/40 backdrop-blur-md p-5 flex flex-col justify-between shrink-0">
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center gap-2 mb-6 border-b border-white/5 pb-4">
          <span class="text-lg">📋</span>
          <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest font-mono">ACP 臨床評估套組</h3>
        </div>
        
        <div class="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          <button v-for="s in sets" :key="s.id"
                  @click="selectSet(s.id)"
                  class="w-full text-left px-4 py-3 rounded-xl transition-all border font-bold text-xs relative group flex items-center justify-between cursor-pointer"
                  :class="selectedSetId === s.id 
                    ? 'bg-indigo-600/20 border-indigo-500/50 text-white shadow-[0_0_15px_rgba(99,102,241,0.1)]' 
                    : 'bg-slate-950/40 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200 hover:bg-slate-900/30'">
            <span class="truncate">{{ s.name }}</span>
            <span v-if="selectedSetId === s.id" class="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)] shrink-0"></span>
          </button>
        </div>
      </div>
      
      <div class="pt-4 border-t border-white/5 mt-4 shrink-0">
        <router-link to="/acp/settings" 
                     class="group flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-slate-950/40 hover:border-indigo-500/30 hover:bg-indigo-500/10 text-xs font-bold text-slate-400 hover:text-indigo-400 transition-all">
          <span class="flex items-center gap-2">
            <span class="group-hover:rotate-45 transition-transform duration-300">⚙️</span> 
            <span>管理評估模板</span>
          </span>
          <span class="text-2xs opacity-0 group-hover:opacity-100 transition-opacity">➔</span>
        </router-link>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden bg-slate-950/30">
      <!-- 1. Global Dashboard -->
      <header class="p-6 bg-slate-900/30 border-b border-white/5 shrink-0 backdrop-blur-sm">
        <div class="max-w-6xl mx-auto grid grid-cols-12 gap-4">
          <!-- Total Score Card -->
          <div class="col-span-4 bg-slate-900/60 border border-white/5 rounded-2xl p-5 flex flex-col justify-center items-center relative overflow-hidden group shadow-lg">
            <div class="absolute -right-8 -top-8 w-24 h-24 rounded-full bg-indigo-500/5 blur-2xl group-hover:scale-150 transition-all duration-700"></div>
            <p class="text-2xs font-black text-slate-500 uppercase tracking-widest font-mono mb-2">總完成率 (Overall Completion)</p>
            <p class="text-4xl font-black font-mono tracking-tight drop-shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-colors" 
               :class="Number(totalStats.rate) >= 80 ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.15)]' : 'text-amber-400'">
              {{ totalStats.rate }}<span class="text-lg font-bold ml-0.5">%</span>
            </p>
            <div class="mt-3 flex gap-3 text-[0.6875rem] font-mono text-slate-400 border-t border-white/5 pt-2 w-full justify-center">
              <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>已開:{{ totalStats.prescribed }}</span>
              <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>未開:{{ totalStats.unprescribed }}</span>
              <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>NA:{{ totalStats.na }}</span>
            </div>
          </div>

          <!-- Category Breakdown Cards -->
          <div class="col-span-8 grid grid-cols-3 gap-3">
            <div v-for="t in tabs" :key="t.key" 
                 @click="activeTab = t.key"
                 class="bg-slate-900/40 hover:bg-slate-900/60 border rounded-2xl p-4 flex flex-col justify-between cursor-pointer transition-all shadow-md group relative animate-fade-in"
                 :class="activeTab === t.key 
                   ? 'border-indigo-500/40 shadow-[0_0_20px_rgba(99,102,241,0.05)] bg-slate-900/70' 
                   : 'border-white/5 hover:border-white/10'">
              <div class="flex justify-between items-center mb-2">
                <span class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <span class="text-sm">{{ t.icon }}</span>
                  <span>{{ t.label }}</span>
                </span>
                <span class="text-xs font-black font-mono px-2 py-0.5 rounded-lg bg-slate-950 text-slate-400 group-hover:text-slate-200 transition-colors">
                  {{ t.key === 'general' ? generalStats.rate : t.key === 'medication' ? medicationStats.rate : procedureStats.rate }}%
                </span>
              </div>
              <div class="flex justify-between items-end mt-2">
                <div class="space-y-1">
                  <p class="text-3xs font-black text-slate-500 uppercase tracking-widest font-mono">已/未/NA</p>
                  <p class="text-xs font-mono font-bold text-slate-300">
                    {{ t.key === 'general' ? `${generalStats.prescribed} / ${generalStats.unprescribed} / ${generalStats.na}` : 
                       t.key === 'medication' ? `${medicationStats.prescribed} / ${medicationStats.unprescribed} / ${medicationStats.na}` : 
                       `${procedureStats.prescribed} / ${procedureStats.unprescribed} / ${procedureStats.na}` }}
                  </p>
                </div>
                <button @click.stop="saveRecord" v-if="t.key === 'procedure'" 
                        class="px-3 py-1.5 rounded-xl text-2xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 transition-all shadow-lg shadow-indigo-600/10 hover:shadow-indigo-500/20 active:scale-95 flex items-center gap-1 cursor-pointer">
                  <span>💾</span>
                  <span>儲存</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <!-- 2. Tabs Switcher -->
      <nav class="px-6 py-4 shrink-0">
        <div class="max-w-6xl mx-auto flex gap-1 p-1 bg-slate-900/60 backdrop-blur-md rounded-2xl border border-white/5 shadow-inner">
          <button v-for="tab in tabs" :key="tab.key"
                  @click="activeTab = tab.key"
                  class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black transition-all duration-200 cursor-pointer"
                  :class="activeTab === tab.key 
                    ? 'bg-slate-800 text-indigo-400 shadow-lg border border-white/[0.03]' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/30'">
            <span class="text-base">{{ tab.icon }}</span>
            <span class="tracking-wider">{{ tab.label }}</span>
          </button>
        </div>
      </nav>

      <!-- 3. Evaluation Items List -->
      <div class="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar">
        <div class="max-w-6xl mx-auto">
          <!-- Empty State -->
          <div v-if="currentTabItems.length === 0" class="flex flex-col items-center justify-center h-64 text-slate-500 bg-slate-900/20 border border-dashed border-white/5 rounded-3xl p-6 italic">
            <span class="text-3xl mb-3 opacity-50">📂</span>
            <p class="text-xs font-medium">此類別尚未設定醫囑項目</p>
          </div>
          
          <!-- Items List -->
          <div v-else class="space-y-2.5">
            <div v-for="item in currentTabItems" :key="item.id" 
                 class="bg-slate-900/40 border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-4 transition-all hover:bg-slate-900/60 hover:border-white/10 shadow-sm"
                 :class="{
                   'border-emerald-500/20 bg-emerald-500/[0.02] shadow-[inset_0_0_12px_rgba(16,185,129,0.01)]': evalStates[item.id]?.status === 'prescribed',
                   'border-amber-500/20 bg-amber-500/[0.02] shadow-[inset_0_0_12px_rgba(245,158,11,0.01)]': evalStates[item.id]?.status === 'na'
                 }">
              
              <div class="flex-1 min-w-0 flex items-center gap-3">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" 
                      :class="evalStates[item.id]?.status === 'prescribed' 
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse' 
                        : evalStates[item.id]?.status === 'na' 
                          ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]' 
                          : 'bg-slate-700'"></span>
                <h4 class="text-slate-200 font-bold text-xs leading-snug truncate">{{ item.name }}</h4>
              </div>

              <!-- Status Buttons -->
              <div class="flex bg-slate-950/80 p-1 rounded-xl border border-white/5 shrink-0 shadow-inner">
                <button @click="evalStates[item.id].status = 'prescribed'" 
                        class="px-4 py-1.5 rounded-lg text-2xs font-black uppercase tracking-wider transition-all cursor-pointer"
                        :class="evalStates[item.id]?.status === 'prescribed' 
                          ? 'bg-emerald-600 border border-emerald-500/20 text-white shadow-lg shadow-emerald-500/10' 
                          : 'text-slate-600 hover:text-slate-400'">
                  已開
                </button>
                <button @click="evalStates[item.id].status = 'unprescribed'" 
                        class="px-4 py-1.5 rounded-lg text-2xs font-black uppercase tracking-wider transition-all cursor-pointer"
                        :class="evalStates[item.id]?.status === 'unprescribed' 
                          ? 'bg-slate-800 border border-white/5 text-slate-300 shadow-inner' 
                          : 'text-slate-600 hover:text-slate-400'">
                  未開
                </button>
                <button @click="evalStates[item.id].status = 'na'" 
                        class="px-4 py-1.5 rounded-lg text-2xs font-black uppercase tracking-wider transition-all cursor-pointer"
                        :class="evalStates[item.id]?.status === 'na' 
                          ? 'bg-amber-600 border border-amber-500/20 text-white shadow-lg shadow-amber-500/10' 
                          : 'text-slate-600 hover:text-slate-400'">
                  N/A
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
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
