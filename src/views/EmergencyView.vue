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

function copy(text: string) { navigator.clipboard.writeText(text); }

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
  alert("已複製至剪貼簿");
}
</script>

<template>
  <div class="flex gap-4 h-full">
    <!-- Protocol list -->
    <div class="w-64 shrink-0 space-y-1.5">
      <p class="text-xs text-red-500 font-semibold uppercase tracking-wide mb-3">Emergency Protocols</p>
      <button
        v-for="p in protocols"
        :key="p.id"
        @click="selectProtocol(p)"
        class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors border"
        :class="selected?.id === p.id
          ? 'bg-red-700 border-red-600 text-white'
          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'"
      >
        <div class="font-semibold">{{ p.name }}</div>
        <div class="text-xs opacity-60 mt-0.5 truncate">{{ parseJson<string>(p.triggers).join(' · ') }}</div>
      </button>
      <div v-if="protocols.length === 0" class="text-zinc-600 text-sm text-center py-8">載入中…</div>
    </div>

    <!-- Protocol detail -->
    <div class="flex-1 overflow-y-auto space-y-4">
      <div v-if="!selected" class="flex items-center justify-center h-full text-zinc-600 text-sm">
        ← 選擇情境
      </div>

      <template v-else>
        <!-- Header -->
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-red-400">🚨 {{ selected.name }}</h2>
          <button
            @click="exportRecord()"
            class="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            📋 複製護理紀錄
          </button>
        </div>

        <!-- Triggers -->
        <div class="p-3 rounded-lg bg-amber-950/40 border border-amber-900/50">
          <p class="text-amber-400 text-xs font-semibold mb-2">啟動時機</p>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="t in parseJson<string>(selected.triggers)"
              :key="t"
              class="px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 text-xs"
            >{{ t }}</span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <!-- Immediate actions -->
          <div class="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
            <p class="text-white text-sm font-semibold mb-3">立即處置步驟</p>
            <div class="space-y-2">
              <label
                v-for="(action, idx) in parseJson<string>(selected.immediate_actions)"
                :key="idx"
                class="flex items-start gap-2.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  :checked="checkedActions.has(idx)"
                  @change="toggleAction(idx)"
                  class="mt-0.5 accent-red-500"
                />
                <span
                  class="text-sm transition-colors"
                  :class="checkedActions.has(idx) ? 'text-zinc-500 line-through' : 'text-zinc-200'"
                >{{ action }}</span>
              </label>
            </div>
          </div>

          <div class="space-y-4">
            <!-- Critical meds -->
            <div class="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
              <p class="text-white text-sm font-semibold mb-3">關鍵用藥</p>
              <div class="space-y-2">
                <div
                  v-for="med in parseMeds(selected.critical_meds)"
                  :key="med.name"
                  class="flex gap-2 p-2 rounded-lg text-sm"
                  :class="med.color === 'red' ? 'bg-red-950/60 border border-red-900/60' : med.color === 'yellow' ? 'bg-amber-950/60 border border-amber-900/60' : 'bg-blue-950/60 border border-blue-900/60'"
                >
                  <div>
                    <p
                      class="font-semibold"
                      :class="med.color === 'red' ? 'text-red-300' : med.color === 'yellow' ? 'text-amber-300' : 'text-blue-300'"
                    >{{ med.name }}</p>
                    <p class="text-xs text-zinc-400 mt-0.5">{{ med.dose }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Timers -->
            <div v-if="timerStates.length" class="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
              <p class="text-white text-sm font-semibold mb-3">倒數計時器</p>
              <div class="space-y-3">
                <div
                  v-for="t in timerStates"
                  :key="t.label"
                  class="flex items-center justify-between p-2 rounded-lg"
                  :class="t.expired ? 'bg-red-900/40 border border-red-700' : 'bg-zinc-800'"
                >
                  <div>
                    <p class="text-xs text-zinc-400">{{ t.label }}</p>
                    <p
                      class="text-2xl font-mono font-bold mt-0.5"
                      :class="t.expired ? 'text-red-400 animate-pulse' : t.remaining < 30 ? 'text-amber-400' : 'text-green-400'"
                    >{{ formatTime(t.remaining) }}</p>
                  </div>
                  <div class="flex gap-1.5">
                    <button
                      v-if="!t.running && !t.expired"
                      @click="startTimer(t)"
                      class="px-2 py-1 rounded bg-green-800 text-green-200 text-xs hover:bg-green-700 cursor-pointer"
                    >▶ 開始</button>
                    <button
                      @click="resetTimer(t)"
                      class="px-2 py-1 rounded bg-zinc-700 text-zinc-300 text-xs hover:bg-zinc-600 cursor-pointer"
                    >↺ 重置</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Contacts -->
            <div v-if="parseJson(selected.contacts).length" class="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
              <p class="text-white text-sm font-semibold mb-3">緊急聯絡分機</p>
              <div class="space-y-2">
                <div
                  v-for="c in parseContacts(selected.contacts)"
                  :key="c.ext"
                  class="flex items-center justify-between"
                >
                  <span class="text-zinc-400 text-sm">{{ c.label }}</span>
                  <button
                    @click="copy(c.ext)"
                    class="font-mono text-sm font-bold text-red-300 hover:text-red-200 cursor-pointer"
                  >📞 {{ c.ext }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
