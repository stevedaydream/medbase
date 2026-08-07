<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useIntervalFn } from "@vueuse/core";
import { getDb } from "@/db";

interface Protocol {
  id: number;
  name: string;
  triggers: string;
  immediate_actions: string;
  critical_meds: string;
  timers: string;
  contacts: string;
  notes: string;
}

interface TimerState {
  label: string;
  seconds: number;
  remaining: number;
  running: boolean;
  expired: boolean;
}

const protocols = ref<Protocol[]>([]);
const selected = ref<Protocol | null>(null);
const checkedActions = ref<Set<number>>(new Set());
const timerStates = ref<TimerState[]>([]);

onMounted(async () => {
  const db = await getDb();
  protocols.value = await db.select<Protocol[]>("SELECT * FROM emergency_protocols ORDER BY name");
  // Seed demo data if empty
  if (protocols.value.length === 0) {
    await seedDemo(db);
    protocols.value = await db.select<Protocol[]>("SELECT * FROM emergency_protocols ORDER BY name");
  }
});

async function seedDemo(db: any) {
  await db.execute(`INSERT INTO emergency_protocols (name, triggers, immediate_actions, critical_meds, timers, contacts) VALUES (?, ?, ?, ?, ?, ?)`, [
    "Anaphylaxis",
    JSON.stringify(["蕁麻疹 + 低血壓", "支氣管痙攣", "血管性水腫"]),
    JSON.stringify(["立即停止過敏原輸注", "平躺，腳抬高", "給予 Epinephrine", "建立靜脈通路 × 2", "給予氧氣 10L/min", "通知主治醫師"]),
    JSON.stringify([
      { name: "Epinephrine 1:1000", dose: "0.3–0.5 mg IM (大腿外側)", color: "red" },
      { name: "Diphenhydramine", dose: "25–50 mg IV", color: "yellow" },
      { name: "Methylprednisolone", dose: "125 mg IV", color: "yellow" },
      { name: "NS 500 mL", dose: "快速輸注", color: "blue" },
    ]),
    JSON.stringify([{ label: "Epi 下次給藥", seconds: 180 }]),
    JSON.stringify([{ label: "急救小組", ext: "7000" }, { label: "藥局", ext: "3456" }]),
  ]);
  await db.execute(`INSERT INTO emergency_protocols (name, triggers, immediate_actions, critical_meds, timers, contacts) VALUES (?, ?, ?, ?, ?, ?)`, [
    "ACLS — VF / pVT",
    JSON.stringify(["無脈搏室顫 (VF)", "無脈搏室速 (pVT)", "AED 建議電擊"]),
    JSON.stringify(["確認無反應、無呼吸", "啟動 Code Blue，記錄時間", "開始 CPR (30:2，100-120/min)", "接上 AED/去顫器，分析心律", "電擊 200J (雙向)，立即恢復 CPR", "建立靜脈通路", "2分鐘後再次心律分析"]),
    JSON.stringify([
      { name: "Epinephrine 1 mg IV", dose: "每 3–5 分鐘，VF/pVT 首選", color: "red" },
      { name: "Amiodarone 300 mg IV", dose: "首劑 (第 3 次電擊後)", color: "red" },
      { name: "Amiodarone 150 mg IV", dose: "第二劑 (15 min 後)", color: "yellow" },
    ]),
    JSON.stringify([
      { label: "CPR 輪換", seconds: 120 },
      { label: "Epi 再給藥", seconds: 300 },
    ]),
    JSON.stringify([{ label: "9595 專線", ext: "7000" }, { label: "SICU", ext: "2552" }]),
  ]);
}

function parseJson<T>(s: string | null): T[] {
  try { return JSON.parse(s ?? "[]") ?? []; } catch { return []; }
}

function selectProtocol(p: Protocol) {
  selected.value = p;
  checkedActions.value = new Set();
  const rawTimers = parseJson<{ label: string; seconds: number }>(p.timers);
  timerStates.value = rawTimers.map((t) => ({
    ...t,
    remaining: t.seconds,
    running: false,
    expired: false,
  }));
}

function toggleAction(idx: number) {
  if (checkedActions.value.has(idx)) checkedActions.value.delete(idx);
  else checkedActions.value.add(idx);
}

function startTimer(t: TimerState) {
  t.running = true;
  t.expired = false;
  const { pause } = useIntervalFn(() => {
    if (!t.running) { pause(); return; }
    t.remaining--;
    if (t.remaining <= 0) {
      t.remaining = 0;
      t.expired = true;
      t.running = false;
      pause();
    }
  }, 1000);
}

function resetTimer(t: TimerState) {
  t.running = false;
  t.expired = false;
  const src = parseJson<{ label: string; seconds: number }>(selected.value!.timers)
    .find((x) => x.label === t.label);
  if (src) t.remaining = src.seconds;
}

interface CriticalMed { name: string; dose: string; color: string; }
interface Contact { label: string; ext: string; }

function parseMeds(s: string | null): CriticalMed[] { return parseJson<CriticalMed>(s); }
function parseContacts(s: string | null): Contact[] { return parseJson<Contact>(s); }

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const copySuccess = ref(false);
function copy(text: string) {
  navigator.clipboard.writeText(text);
  copySuccess.value = true;
  setTimeout(() => { copySuccess.value = false; }, 1500);
}

function exportRecord() {
  if (!selected.value) return;
  const actions = parseJson<string>(selected.value.immediate_actions);
  const lines = [
    `【急救紀錄】${selected.value.name}`,
    `時間：${new Date().toLocaleString("zh-TW")}`,
    "",
    "已完成步驟：",
    ...actions.map((a, i) => `${checkedActions.value.has(i) ? "✓" : "○"} ${a}`),
  ];
  navigator.clipboard.writeText(lines.join("\n"));
  alert("急救處置紀錄已複製至剪貼簿");
}
</script>

<template>
  <div class="flex gap-6 h-full bg-slate-950/20 rounded-2xl border border-white/5 shadow-2xl p-1 overflow-hidden">
    
    <!-- Left: Protocol list -->
    <div class="w-72 shrink-0 flex flex-col bg-slate-900/60 backdrop-blur-xl border-r border-white/5 p-4 space-y-4">
      <div class="border-b border-white/5 pb-4 flex items-center gap-2">
        <span class="text-rose-500 animate-pulse text-lg">🚨</span>
        <div>
          <p class="text-xs font-bold text-rose-500 uppercase tracking-widest">Emergency Protocols</p>
          <p class="text-3xs text-slate-500 font-mono tracking-tight">CRITICAL PATHWAY MONITOR</p>
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto space-y-2 pr-1">
        <button
          v-for="p in protocols"
          :key="p.id"
          @click="selectProtocol(p)"
          class="w-full text-left px-4 py-3.5 rounded-xl transition-all duration-300 border relative group overflow-hidden"
          :class="selected?.id === p.id
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200 shadow-[0_0_15px_rgba(239,68,68,0.05)]'
            : 'bg-slate-950/40 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'"
        >
          <div v-if="selected?.id === p.id" class="absolute left-0 top-0 bottom-0 w-1 bg-rose-500" />
          <div class="font-bold text-xs uppercase tracking-wide transition-colors" :class="selected?.id === p.id ? 'text-rose-300' : 'text-slate-300'">{{ p.name }}</div>
          <div class="text-2xs text-slate-500 mt-1 truncate font-mono">{{ parseJson<string>(p.triggers).join(' · ') }}</div>
        </button>
        <div v-if="protocols.length === 0" class="text-slate-600 text-xs text-center py-12 font-mono">LOADING PROTOCOLS...</div>
      </div>
    </div>

    <!-- Right: Protocol detail -->
    <div class="flex-1 overflow-y-auto p-4 space-y-6">
      <div v-if="!selected" class="flex flex-col items-center justify-center h-full text-slate-600 text-center space-y-3">
        <span class="text-4xl opacity-20">🚨</span>
        <p class="text-xs uppercase tracking-widest font-mono">Please select an emergency protocol from the left</p>
      </div>

      <template v-else>
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-white/5 pb-4">
          <div>
            <h2 class="text-xl font-black text-rose-400 tracking-wide uppercase flex items-center gap-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              {{ selected.name }}
            </h2>
            <p class="text-2xs text-slate-500 mt-1 font-mono uppercase tracking-wide">Emergency Action Plan</p>
          </div>
          <button
            @click="exportRecord()"
            class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 text-slate-300 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-lg"
          >
            <span>📋</span> 複製急救護理紀錄
          </button>
        </div>

        <!-- Triggers / Hazards Display -->
        <div class="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 relative overflow-hidden shadow-inner">
          <!-- Subtle warning pattern backdrop -->
          <div class="absolute inset-0 opacity-[0.02] pointer-events-none bg-[linear-gradient(45deg,#f59e0b_25%,transparent_25%,transparent_50%,#f59e0b_50%,#f59e0b_75%,transparent_75%,transparent)] bg-[length:24px_24px]" />
          <p class="text-amber-400 text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <span>⚠️</span> 啟動時機 / 臨床指徵 (Triggers)
          </p>
          <div class="flex flex-wrap gap-2.5 relative z-10">
            <span
              v-for="t in parseJson<string>(selected.triggers)"
              :key="t"
              class="px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold font-mono"
            >{{ t }}</span>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <!-- Immediate actions Checklist -->
          <div class="rounded-2xl bg-slate-900/40 border border-white/5 p-5 space-y-4">
            <div class="border-b border-white/5 pb-2.5 flex justify-between items-center">
              <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">立即處置步驟 (Checklist)</span>
              <span class="text-2xs text-slate-500 font-mono">
                {{ checkedActions.size }} / {{ parseJson(selected.immediate_actions).length }} 已處理
              </span>
            </div>
            
            <div class="space-y-3">
              <label
                v-for="(action, idx) in parseJson<string>(selected.immediate_actions)"
                :key="idx"
                class="flex items-start gap-3.5 p-3 rounded-xl border border-white/[0.02] bg-slate-950/20 cursor-pointer select-none transition-all duration-300 hover:bg-white/[0.02]"
                :class="checkedActions.has(idx) ? 'opacity-40 border-transparent bg-transparent' : 'border-white/5'"
              >
                <div class="relative flex items-center mt-0.5">
                  <input
                    type="checkbox"
                    :checked="checkedActions.has(idx)"
                    @change="toggleAction(idx)"
                    class="sr-only peer"
                  />
                  <div class="w-5 h-5 rounded-lg border-2 transition-all duration-300 peer-checked:bg-rose-500 peer-checked:border-rose-500 border-white/20 flex items-center justify-center">
                    <span class="text-white text-xs scale-0 peer-checked:scale-100 transition-transform font-bold">✓</span>
                  </div>
                </div>
                <span
                  class="text-xs transition-all duration-300 leading-normal"
                  :class="checkedActions.has(idx) ? 'text-slate-500 line-through' : 'text-slate-200 font-semibold'"
                >{{ action }}</span>
              </label>
            </div>
          </div>

          <!-- Meds / Timers / Contacts Panel -->
          <div class="space-y-6">
            <!-- Critical meds -->
            <div class="rounded-2xl bg-slate-900/40 border border-white/5 p-5 space-y-4">
              <div class="border-b border-white/5 pb-2.5">
                <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">關鍵急救用藥 (Critical Meds)</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  v-for="med in parseMeds(selected.critical_meds)"
                  :key="med.name"
                  class="p-3 rounded-xl border transition-all duration-300 flex flex-col justify-between"
                  :class="med.color === 'red'
                    ? 'bg-rose-500/5 border-rose-500/20 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.03)]'
                    : med.color === 'yellow'
                      ? 'bg-amber-500/5 border-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.03)]'
                      : 'bg-sky-500/5 border-sky-500/20 text-sky-300'"
                >
                  <p
                    class="font-bold text-xs uppercase tracking-wide"
                    :class="med.color === 'red' ? 'text-rose-300' : med.color === 'yellow' ? 'text-amber-300' : 'text-sky-300'"
                  >{{ med.name }}</p>
                  <p class="text-2xs text-slate-400 mt-1 font-mono leading-snug">{{ med.dose }}</p>
                </div>
              </div>
            </div>

            <!-- Timers Widget -->
            <div v-if="timerStates.length" class="rounded-2xl bg-slate-900/40 border border-white/5 p-5 space-y-4">
              <div class="border-b border-white/5 pb-2.5">
                <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">程序監控計時器 (Timers)</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div
                  v-for="t in timerStates"
                  :key="t.label"
                  class="flex items-center justify-between p-4 rounded-xl border transition-all duration-300"
                  :class="t.expired
                    ? 'bg-rose-500/10 border-rose-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                    : 'bg-slate-950/40 border-white/5'"
                >
                  <div class="min-w-0">
                    <p class="text-2xs text-slate-500 uppercase font-bold tracking-wider">{{ t.label }}</p>
                    <p
                      class="text-3xl font-mono font-black tracking-wider mt-1 transition-all"
                      :class="t.expired
                        ? 'text-rose-500 animate-pulse'
                        : t.remaining < 30
                          ? 'text-amber-400 animate-pulse'
                          : t.running
                            ? 'text-emerald-400'
                            : 'text-slate-400'"
                    >{{ formatTime(t.remaining) }}</p>
                  </div>
                  <div class="flex flex-col gap-1.5 ml-3 shrink-0">
                    <button
                      v-if="!t.running && !t.expired"
                      @click="startTimer(t)"
                      class="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-2xs font-bold hover:bg-emerald-500/20 transition-all cursor-pointer"
                    >▶ 開始</button>
                    <button
                      @click="resetTimer(t)"
                      class="px-3 py-1.5 rounded-lg bg-slate-800 border border-white/5 text-slate-400 text-2xs font-bold hover:bg-slate-700 hover:text-slate-200 transition-all cursor-pointer"
                    >↺ 重置</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Contacts -->
            <div v-if="parseJson(selected.contacts).length" class="rounded-2xl bg-slate-900/40 border border-white/5 p-5 space-y-4">
              <div class="border-b border-white/5 pb-2.5">
                <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">緊急通報聯絡 (Hotlines)</span>
              </div>
              <div class="space-y-2">
                <div
                  v-for="c in parseContacts(selected.contacts)"
                  :key="c.ext"
                  class="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-white/5 hover:border-rose-500/20 transition-all"
                >
                  <span class="text-slate-400 text-xs font-semibold">{{ c.label }}</span>
                  <button
                    @click="copy(c.ext)"
                    class="font-mono text-xs font-bold text-rose-400 hover:text-rose-300 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>📞</span> {{ c.ext }}
                  </button>
                </div>
              </div>
              <!-- Mini Toast for clipboard -->
              <p v-if="copySuccess" class="text-2xs text-emerald-400 text-center animate-pulse">分機已成功複製至剪貼簿</p>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Standard checkbox override style */
.peer:checked ~ div {
  box-shadow: 0 0 10px rgba(244,63,94,0.3);
}
</style>
