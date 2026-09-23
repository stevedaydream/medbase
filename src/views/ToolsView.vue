<script setup lang="ts">
import { ref, computed } from "vue";
import {
  correctedCalcium, calciumStatus, interpretAbg, estimateTdd, insulinCorrection,
  nutrition, fio2Estimate, STRESS_OPTIONS, PROTEIN_OPTIONS, VENTURI_FLOW, VENTURI_OPTIONS, DEVICE_LABELS,
  type Tone, type GluBasis, type O2Device,
} from "@/shared/clinicalCalc";

// 公式見 shared/clinicalCalc（手機共用，ADR-013）；此處只保留輸入狀態與樣式對應

type ToolId = "calcium" | "abg" | "glucose" | "nutrition" | "fio2";

const activeTool = ref<ToolId>("calcium");

const tools: { id: ToolId; icon: string; label: string; sub: string }[] = [
  { id: "calcium",   icon: "🧪", label: "校正鈣",    sub: "血清白蛋白校正" },
  { id: "abg",       icon: "🫁", label: "ABG 判讀",  sub: "pH 酸鹼分析" },
  { id: "glucose",   icon: "🩸", label: "血糖試算",  sub: "胰島素校正劑量" },
  { id: "nutrition", icon: "🥗", label: "每日營養",  sub: "熱量與蛋白質需求" },
  { id: "fio2",      icon: "💨", label: "FiO₂ 換算", sub: "氧氣裝置對照" },
];

const TONE_CLASS: Record<Tone, string> = {
  "danger-strong": "text-danger font-semibold",
  "danger":        "text-danger",
  "warning":       "text-warning",
  "caution":       "text-yellow-400",
  "accent-strong": "text-accent font-semibold",
  "accent":        "text-accent",
  "success":       "text-success",
  "secondary":     "text-fg-secondary",
  "muted":         "text-muted",
};

// ── Tool 1 — 校正鈣 ────────────────────────────────────────────────
const ca_total   = ref<number | "">("");
const ca_albumin = ref<number | "">("");

const correctedCa = computed(() => correctedCalcium(ca_total.value, ca_albumin.value));

const CA_STYLE = {
  low:    { color: "text-accent",  bg: "bg-accent/10 border-accent/20" },
  high:   { color: "text-danger",  bg: "bg-danger/10 border-danger/20" },
  normal: { color: "text-success", bg: "bg-success/10 border-success/20" },
};
const caStatus = computed(() => {
  const st = calciumStatus(correctedCa.value);
  return st ? { label: st.label, ...CA_STYLE[st.level] } : null;
});

// ── Tool 2 — ABG 判讀 ──────────────────────────────────────────────
const abg_ph   = ref<number | "">("");
const abg_co2  = ref<number | "">("");
const abg_hco3 = ref<number | "">("");
const abg_pao2 = ref<number | "">("");
const abg_fio2 = ref<number | "">(21);

interface AbgLine { text: string; color: string }

const abgResult = computed((): AbgLine[] | null =>
  interpretAbg({ ph: abg_ph.value, co2: abg_co2.value, hco3: abg_hco3.value, pao2: abg_pao2.value, fio2: abg_fio2.value })
    ?.map(l => ({ text: l.text, color: TONE_CLASS[l.tone] })) ?? null);

// ── Tool 3 — 血糖胰島素校正試算 ────────────────────────────────────
const glu_bg     = ref<number | "">("");
const glu_target = ref<number | "">(140);
const glu_tdd    = ref<number | "">("");
const glu_isf    = ref<number | "">("");

/** ISF 的計算基準三選一，避免使用者不知道欄位是互斥的 */
const glu_basis  = ref<GluBasis>("tdd");
const glu_weight = ref<number | "">("");
const glu_ukg    = ref(0.5);

/** 體重估算 TDD：常用起始 0.3–0.5 U/kg/day */
const estimatedTdd = computed(() => estimateTdd(glu_weight.value, glu_ukg.value));

const insulinResult = computed(() => insulinCorrection({
  bg: glu_bg.value, target: glu_target.value, basis: glu_basis.value,
  tdd: glu_tdd.value, weight: glu_weight.value, ukg: glu_ukg.value, isf: glu_isf.value,
}));

// ── Tool 4 — 每日營養需求 ──────────────────────────────────────────
const nut_weight  = ref<number | "">("");
const nut_height  = ref<number | "">("");
const nut_age     = ref<number | "">("");
const nut_gender  = ref<"M" | "F">("M");
const nut_stress  = ref(1.2);
const nut_protein = ref(1.2);

const stressOptions = STRESS_OPTIONS;
const proteinOptions = PROTEIN_OPTIONS;

const nutResult = computed(() => nutrition({
  weight: nut_weight.value, height: nut_height.value, age: nut_age.value,
  gender: nut_gender.value, stress: nut_stress.value, proteinPerKg: nut_protein.value,
}));

// ── Tool 5 — FiO₂ 換算 ─────────────────────────────────────────────
const o2_device  = ref<O2Device>("nc");
const o2_flow    = ref<number | "">("");
const o2_venturi = ref(28);
const o2_pao2    = ref<number | "">("");
const o2_hfnc_fio2 = ref<number | "">(40);

const venturiMap = VENTURI_FLOW;
const venturiOptions = VENTURI_OPTIONS;
const deviceLabels = DEVICE_LABELS;

const fio2Result = computed(() => fio2Estimate({
  device: o2_device.value, flow: o2_flow.value, venturi: o2_venturi.value,
  hfncFio2: o2_hfnc_fio2.value, pao2: o2_pao2.value,
}));

</script>

<template>
  <div class="accent-cyan flex h-full bg-sunken rounded-2xl overflow-hidden border border-hairline shadow-2xl">

    <!-- ── Left: elegant tool list sidebar ──────────────────────────── -->
    <div class="w-60 shrink-0 border-r border-hairline flex flex-col bg-surface">
      <div class="px-6 py-5 border-b border-hairline flex items-center gap-2.5">
        <span class="text-xl">🎛️</span>
        <div>
          <p class="text-sm font-bold text-fg tracking-wider">臨床工具集</p>
          <p class="text-2xs text-muted font-mono tracking-tight">CLINICAL DASHBOARD v1.1</p>
        </div>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        <button
          v-for="t in tools" :key="t.id"
          @click="activeTool = t.id"
          class="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left transition-all duration-300 relative group overflow-hidden"
          :class="activeTool === t.id
            ? 'bg-gradient-to-r from-accent/10 to-accent/5 text-accent border border-accent/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]'
            : 'text-fg-secondary hover:text-fg hover:bg-overlay/5 border border-transparent'"
        >
          <!-- Active left indicator bar -->
          <div
            v-if="activeTool === t.id"
            class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-accent to-accent"
          />

          <span class="text-xl leading-none shrink-0 transition-transform duration-300 group-hover:scale-110">{{ t.icon }}</span>
          <div class="min-w-0">
            <div class="text-xs font-bold tracking-wide uppercase transition-colors" :class="activeTool === t.id ? 'text-accent' : 'text-fg-secondary'">{{ t.label }}</div>
            <div class="text-2xs text-muted leading-tight mt-0.5 font-sans truncate">{{ t.sub }}</div>
          </div>
        </button>
      </nav>
    </div>

    <!-- ── Right: glassmorphic active tool content ──────────────────── -->
    <div class="flex-1 overflow-y-auto bg-sunken p-8">

      <!-- ══ Tool 1: 校正鈣 ════════════════════════════════════════════ -->
      <template v-if="activeTool === 'calcium'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-hairline pb-4">
            <h2 class="text-lg font-bold text-fg flex items-center gap-2">
              <span class="text-accent">🧪</span> 校正鈣試算 (Corrected Calcium)
            </h2>
            <p class="text-xs text-muted mt-1 font-mono">Formula: Corrected Ca = Total Ca + 0.8 × (4.0 − Albumin)</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
            <!-- Inputs -->
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-fg-secondary mb-1.5">實測鈣 (mg/dL)</label>
                <div class="relative">
                  <input
                    v-model.number="ca_total"
                    type="number"
                    step="0.1"
                    placeholder="例：7.8"
                    class="w-full text-sm px-4 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-muted font-mono">mg/dL</span>
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold text-fg-secondary mb-1.5">血清白蛋白 (g/dL)</label>
                <div class="relative">
                  <input
                    v-model.number="ca_albumin"
                    type="number"
                    step="0.1"
                    placeholder="例：2.5"
                    class="w-full text-sm px-4 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-muted font-mono">g/dL</span>
                </div>
              </div>
            </div>

            <!-- Result panel -->
            <div class="flex flex-col justify-center">
              <div v-if="correctedCa !== null"
                class="rounded-2xl border p-6 bg-surface shadow-lg transition-all duration-500"
                :class="caStatus?.bg + ' ' + (correctedCa < 8.5 ? 'border-accent/30' : correctedCa > 10.5 ? 'border-danger/30' : 'border-success/30')"
              >
                <span class="text-xs font-bold text-muted">計算結果</span>
                <div class="flex items-baseline gap-2 mt-2">
                  <span class="text-5xl font-extrabold text-fg tracking-tight font-mono">{{ correctedCa.toFixed(2) }}</span>
                  <span class="text-xs text-fg-secondary font-mono">mg/dL</span>
                </div>
                <div class="mt-2 text-xs font-bold tracking-wide" :class="caStatus?.color">{{ caStatus?.label }}</div>

                <div class="mt-6 space-y-1.5 border-t border-hairline pt-4 text-[0.6875rem] text-muted font-sans leading-relaxed">
                  <div class="flex justify-between"><span>正常範圍：</span><span class="font-mono text-fg-secondary">8.5 – 10.5 mg/dL</span></div>
                  <div class="flex justify-between"><span>低血鈣風險 (&lt;7.0)：</span><span class="text-accent">有抽搐/痙攣風險</span></div>
                  <div class="flex justify-between"><span>高血鈣危機 (&gt;12.0)：</span><span class="text-danger">心律不整/意識模糊</span></div>
                </div>
              </div>

              <div v-else class="h-full min-h-[180px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline bg-surface text-muted text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">🧪</span>
                請在左側輸入實測總鈣及白蛋白數值以進行校正
              </div>
            </div>
          </div>

          <div class="max-w-2xl bg-overlay/[0.02] border border-hairline rounded-xl p-4 text-[0.6875rem] text-muted space-y-1.5">
            <p class="font-semibold text-fg-secondary mb-1">臨床備忘</p>
            <p>• 血中大約有 40-50% 的鈣離子是與白蛋白結合。當低白蛋白血症 (Albumin &lt; 4.0 g/dL) 發生時，測得的總鈣量會呈現偽性偏低，因此需要此公式校正。</p>
            <p>• 若臨床情況複雜（如酸鹼平衡失調、腎功能衰竭），強烈建議直接抽血量測 **游離鈣 (Ionized Calcium)** 最為精準。</p>
          </div>
        </div>
      </template>

      <!-- ══ Tool 2: ABG 判讀 ═══════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'abg'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-hairline pb-4">
            <h2 class="text-lg font-bold text-fg flex items-center gap-2">
              <span class="text-accent">🫁</span> 動脈血氣分析判讀 (ABG Interpretator)
            </h2>
            <p class="text-xs text-muted mt-1 font-mono">Evaluate acidosis, alkalosis, compensation and oxygenation index</p>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <!-- Inputs Column -->
            <div class="space-y-4">
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">pH 值</label>
                  <input
                    v-model.number="abg_ph"
                    type="number"
                    step="0.01"
                    placeholder="7.40"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5 uppercase tracking-wide">PaCO₂ (mmHg)</label>
                  <input
                    v-model.number="abg_co2"
                    type="number"
                    placeholder="40"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5 uppercase tracking-wide">HCO₃⁻ (mEq/L)</label>
                  <input
                    v-model.number="abg_hco3"
                    type="number"
                    placeholder="24"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">PaO₂ (mmHg) <span class="text-muted font-normal">選填</span></label>
                  <input
                    v-model.number="abg_pao2"
                    type="number"
                    placeholder="80"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">FiO₂ (%) <span class="text-muted font-normal">選填</span></label>
                  <input
                    v-model.number="abg_fio2"
                    type="number"
                    placeholder="21"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
              </div>

              <!-- Quick normal values -->
              <div class="bg-overlay/[0.01] border border-hairline rounded-2xl p-4 text-2xs text-muted grid grid-cols-2 gap-3 font-mono leading-relaxed">
                <div>
                  <p class="font-bold text-fg-secondary mb-1">生理正常值參考</p>
                  <div>pH: 7.35 – 7.45</div>
                  <div>PaCO₂: 35 – 45 mmHg</div>
                  <div>HCO₃⁻: 22 – 26 mEq/L</div>
                  <div>PaO₂: 80 – 100 mmHg</div>
                </div>
                <div>
                  <p class="font-bold text-fg-secondary mb-1">代償係數提示</p>
                  <div>代謝性酸 (Winter): 1.5×HCO₃+8±2</div>
                  <div>呼吸性酸 (急性): △HCO₃=△CO₂×0.1</div>
                  <div>呼吸性酸 (慢性): △HCO₃=△CO₂×0.35</div>
                </div>
              </div>
            </div>

            <!-- Result Column -->
            <div class="flex flex-col justify-start">
              <div v-if="abgResult" class="rounded-2xl border border-hairline bg-surface p-6 shadow-xl space-y-4">
                <span class="text-xs font-bold text-muted">判讀分析序列</span>
                <div class="space-y-3 font-mono text-sm leading-relaxed">
                  <div
                    v-for="(line, i) in abgResult"
                    :key="i"
                    class="flex items-start gap-2.5 p-2 rounded-lg bg-sunken border border-hairline"
                  >
                    <span class="mt-0.5 text-xs text-muted">•</span>
                    <span :class="line.color" class="whitespace-pre-wrap">{{ line.text }}</span>
                  </div>
                </div>
              </div>

              <div v-else class="h-full min-h-[220px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline bg-surface text-muted text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">🫁</span>
                請在左側輸入 pH, PaCO₂, HCO₃⁻ 以利執行酸鹼代償分析
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ══ Tool 3: 血糖試算 ══════════════════════════════════════════ -->
      <template v-if="activeTool === 'glucose'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-hairline pb-4">
            <h2 class="text-lg font-bold text-fg flex items-center gap-2">
              <span class="text-accent">🩸</span> 血糖胰島素校正試算 (Insulin Correction)
            </h2>
            <p class="text-xs text-muted mt-1 font-mono">Dose = (BG − Target) ÷ ISF | ISF ≈ 1700 ÷ TDD | TDD ≈ 體重 × 0.3–0.5 U/kg</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
            <!-- Inputs -->
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">目前血糖 (BG)</label>
                  <div class="relative">
                    <input
                      v-model.number="glu_bg"
                      type="number"
                      placeholder="例：250"
                      class="w-full text-sm px-4 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                    />
                    <span class="absolute right-4 top-3.5 text-2xs text-muted font-mono">mg/dL</span>
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">目標血糖</label>
                  <div class="relative">
                    <input
                      v-model.number="glu_target"
                      type="number"
                      placeholder="140"
                      class="w-full text-sm px-4 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                    />
                    <span class="absolute right-4 top-3.5 text-2xs text-muted font-mono">mg/dL</span>
                  </div>
                </div>
              </div>

              <div class="border-t border-hairline pt-4">
                <p class="text-xs font-semibold text-fg-secondary mb-1">胰島素敏感度 (ISF) 從哪裡來？</p>
                <p class="text-[0.6875rem] text-muted mb-2.5">三選一，選好只要填底下那一格</p>

                <!-- 三選一，避免看不出欄位互斥 -->
                <div class="grid grid-cols-3 gap-1.5 mb-3">
                  <button
                    v-for="b in [
                      { key: 'tdd',    label: '已知 TDD' },
                      { key: 'weight', label: '用體重估' },
                      { key: 'isf',    label: '直接填 ISF' },
                    ]"
                    :key="b.key"
                    @click="glu_basis = b.key as 'tdd' | 'weight' | 'isf'"
                    class="px-2 py-2 rounded-lg text-2xs font-bold border transition-all cursor-pointer"
                    :class="glu_basis === b.key
                      ? 'bg-accent/10 border-accent/30 text-accent'
                      : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'"
                  >{{ b.label }}</button>
                </div>

                <!-- ① 已知 TDD -->
                <div v-if="glu_basis === 'tdd'">
                  <label class="block text-[0.6875rem] text-muted mb-1 font-medium">每日胰島素總劑量 (TDD)</label>
                  <div class="relative">
                    <input
                      v-model.number="glu_tdd"
                      type="number"
                      placeholder="例：40"
                      class="w-full text-xs px-3.5 py-2.5 bg-surface border border-hairline rounded-lg text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                    />
                    <span class="absolute right-3 top-3 text-2xs text-muted font-mono">Units</span>
                  </div>
                  <p class="text-[0.6875rem] text-muted mt-1.5">病人一天打的胰島素總單位：基礎（如 Lantus）＋ 三餐餐前全部加總。</p>
                </div>

                <!-- ② 用體重估 TDD（沒有現成 TDD 時用）-->
                <div v-else-if="glu_basis === 'weight'">
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-[0.6875rem] text-muted mb-1 font-medium">體重</label>
                      <div class="relative">
                        <input
                          v-model.number="glu_weight"
                          type="number"
                          placeholder="例：70"
                          class="w-full text-xs px-3.5 py-2.5 bg-surface border border-hairline rounded-lg text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                        />
                        <span class="absolute right-3 top-3 text-2xs text-muted font-mono">kg</span>
                      </div>
                    </div>
                    <div>
                      <label class="block text-[0.6875rem] text-muted mb-1 font-medium">每公斤劑量</label>
                      <select
                        v-model.number="glu_ukg"
                        class="w-full text-xs px-3.5 py-2.5 bg-surface border border-hairline rounded-lg text-fg outline-none focus:border-accent/50 transition-all font-mono cursor-pointer"
                      >
                        <option :value="0.3">0.3 — 年長 / 消瘦 / 腎功能不佳</option>
                        <option :value="0.4">0.4 — 一般偏保守</option>
                        <option :value="0.5">0.5 — 一般起始</option>
                        <option :value="0.6">0.6 — 肥胖 / 類固醇 / 感染</option>
                      </select>
                    </div>
                  </div>
                  <p v-if="estimatedTdd" class="text-[0.6875rem] text-fg-secondary mt-1.5">
                    估算 TDD ≈ <span class="font-mono font-bold">{{ estimatedTdd }}</span> U/day
                    → ISF ≈ <span class="font-mono font-bold">{{ Math.round(1700 / estimatedTdd) }}</span> mg/dL/U
                  </p>
                  <p class="text-[0.6875rem] text-warning mt-1.5">
                    ⚠ 這是<span class="font-bold">起始估算值</span>，不等於病人實際的 TDD。已在打胰島素的病人請改用「已知 TDD」。
                  </p>
                </div>

                <!-- ③ 直接填 ISF -->
                <div v-else>
                  <label class="block text-[0.6875rem] text-muted mb-1 font-medium">直接指定 ISF 數值</label>
                  <div class="relative">
                    <input
                      v-model.number="glu_isf"
                      type="number"
                      placeholder="例：42"
                      class="w-full text-xs px-3.5 py-2.5 bg-surface border border-hairline rounded-lg text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                    />
                    <span class="absolute right-3 top-3 text-2xs text-muted font-mono">mg/dL/U</span>
                  </div>
                  <p class="text-[0.6875rem] text-muted mt-1.5">打 1 單位速效胰島素可降多少 mg/dL。不確定就改選前兩項。</p>
                </div>
              </div>
            </div>

            <!-- Result -->
            <div class="flex flex-col justify-center">
              <div v-if="insulinResult" class="rounded-2xl border border-hairline p-6 bg-surface shadow-xl transition-all">
                <span class="text-xs font-bold text-muted">建議校正劑量</span>
                
                <div v-if="Number(glu_bg) < 70" class="mt-4 p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger flex items-start gap-2.5">
                  <span class="text-lg">⚠️</span>
                  <div class="text-xs">
                    <p class="font-bold">嚴重低血糖危險！</p>
                    <p class="mt-0.5 opacity-80">血糖值低於 70 mg/dL，請遵循低血糖處置流程（服用/注射葡萄糖），此時**絕對禁止**追加速效胰島素。</p>
                  </div>
                </div>

                <template v-else>
                  <div v-if="insulinResult.needCorr" class="mt-3">
                    <div class="flex items-baseline gap-2">
                      <span class="text-5xl font-extrabold text-accent font-mono tracking-tight">{{ insulinResult.dose }}</span>
                      <span class="text-xs text-fg-secondary font-mono">Units</span>
                    </div>
                    <p class="text-xs font-semibold text-fg-secondary mt-1">速效胰島素 (Rapid-acting insulin)</p>
                  </div>
                  <div v-else class="mt-3 flex items-center gap-2 text-success font-semibold text-sm">
                    <span>✓</span> 血糖達標，不需追加速效胰島素。
                  </div>
                  
                  <div class="mt-6 pt-4 border-t border-hairline space-y-1 text-[0.6875rem] text-muted">
                    <div v-if="insulinResult.tddNote" class="flex justify-between gap-3">
                      <span class="shrink-0">採用 TDD：</span>
                      <span class="font-mono text-fg-secondary text-right">{{ insulinResult.tddNote }}</span>
                    </div>
                    <div class="flex justify-between"><span>估算敏感度 ISF：</span><span class="font-mono text-fg-secondary">{{ insulinResult.isf }} mg/dL / Unit</span></div>
                    <div class="flex justify-between"><span>當前血糖狀態：</span><span class="font-bold text-fg-secondary">{{ insulinResult.status }}</span></div>
                  </div>

                  <p v-if="insulinResult.estimated"
                    class="mt-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-warning text-[0.6875rem] leading-relaxed">
                    TDD 由體重估算而來，此劑量僅供起始參考，須依實際血糖反應調整。
                  </p>
                </template>
              </div>

              <div v-else class="h-full min-h-[180px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline bg-surface text-muted text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">🩸</span>
                請填寫血糖值、目標血糖，並在「ISF 從哪裡來？」三選一填入對應欄位
              </div>
            </div>
          </div>

          <div class="max-w-2xl bg-overlay/[0.02] border border-hairline rounded-xl p-4 text-[0.6875rem] text-muted space-y-1 border-t border-hairline mt-4">
            <p class="font-semibold text-fg-secondary mb-1">注意事項</p>
            <p>• 一般病房住院患者餐前血糖控制目標建議為 140–180 mg/dL，重症病房 (ICU) 同樣建議維持在 140–180 mg/dL。</p>
            <p>• 本試算之校正劑量已四捨五入至最接近的 0.5 單位 (Unit)，臨床醫囑開立仍需依患者個別胰島素抗性與臨床現狀進行細微調整。</p>
            <p>• 「用體重估」採 0.3–0.5 U/kg/day 的起始估算範圍：年長、消瘦、腎功能不佳取低值；肥胖、使用類固醇、感染或明顯胰島素抗性取高值。此為<span class="font-semibold">起始參考</span>，病人已有胰島素治療時請直接填實際 TDD。</p>
            <p>• 只有血糖值（一天 3–4 次）而沒有 TDD 時，數學上無法推得 ISF；請改用體重估算，或先確認病人目前的胰島素處方。</p>
          </div>
        </div>
      </template>

      <!-- ══ Tool 4: 每日營養 ══════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'nutrition'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-hairline pb-4">
            <h2 class="text-lg font-bold text-fg flex items-center gap-2">
              <span class="text-accent">🥗</span> 每日營養與熱量需求評估 (Nutrition Calculator)
            </h2>
            <p class="text-xs text-muted mt-1 font-mono">Harris-Benedict Equation & Activity/Stress Factors</p>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <!-- Inputs Column -->
            <div class="space-y-4">
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">體重 (kg)</label>
                  <input
                    v-model.number="nut_weight"
                    type="number"
                    step="0.5"
                    placeholder="70"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">身高 (cm)</label>
                  <input
                    v-model.number="nut_height"
                    type="number"
                    placeholder="170"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">年齡 (歲)</label>
                  <input
                    v-model.number="nut_age"
                    type="number"
                    placeholder="50"
                    class="w-full text-sm px-3.5 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 placeholder-muted transition-all font-mono"
                  />
                </div>
              </div>

              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">生理性別</label>
                  <div class="flex gap-1">
                    <button
                      @click="nut_gender = 'M'"
                      class="flex-1 text-xs py-3 rounded-xl border transition-all"
                      :class="nut_gender === 'M' ? 'bg-accent/10 border-accent/30 text-accent font-bold' : 'bg-surface border-hairline text-muted hover:text-fg-secondary'"
                    >男</button>
                    <button
                      @click="nut_gender = 'F'"
                      class="flex-1 text-xs py-3 rounded-xl border transition-all"
                      :class="nut_gender === 'F' ? 'bg-accent/10 border-accent/30 text-accent font-bold' : 'bg-surface border-hairline text-muted hover:text-fg-secondary'"
                    >女</button>
                  </div>
                </div>

                <div class="col-span-2">
                  <label class="block text-xs font-semibold text-fg-secondary mb-1.5">壓力係數 (Stress Factor)</label>
                  <select
                    v-model.number="nut_stress"
                    class="w-full text-xs px-3.5 py-3.5 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 transition-all"
                  >
                    <option v-for="o in stressOptions" :key="o.value" :value="o.value">{{ o.label }} (×{{ o.value }})</option>
                  </select>
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold text-fg-secondary mb-1.5">蛋白質給予基準</label>
                <select
                  v-model.number="nut_protein"
                  class="w-full text-xs px-3.5 py-3.5 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 transition-all"
                >
                  <option v-for="o in proteinOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
            </div>

            <!-- Results Column -->
            <div class="flex flex-col justify-start">
              <div v-if="nutResult" class="space-y-4">
                <!-- TDEE Card -->
                <div class="rounded-2xl border border-accent/10 bg-gradient-to-br from-accent/10 to-accent/5 p-6 shadow-xl relative overflow-hidden">
                  <span class="text-xs font-bold text-muted">每日總耗能 (TDEE)</span>
                  <div class="flex items-baseline gap-2 mt-2">
                    <span class="text-4xl font-extrabold text-fg tracking-tight font-mono">{{ nutResult.tdee }}</span>
                    <span class="text-xs text-fg-secondary">kcal / 每日</span>
                  </div>
                  <div class="text-2xs text-muted mt-1">基礎代謝率 (BMR): {{ nutResult.bmr }} kcal</div>
                </div>

                <!-- Detail Grid -->
                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-xl border border-hairline bg-surface p-4">
                    <p class="text-2xs font-bold text-muted">蛋白質目標</p>
                    <p class="text-2xl font-bold text-accent font-mono mt-1">{{ nutResult.protein }} <span class="text-xs font-normal text-muted">g</span></p>
                    <p class="text-2xs text-muted font-mono mt-1">{{ nut_protein }} g/kg × {{ nut_weight }} kg</p>
                  </div>

                  <div class="rounded-xl border border-hairline bg-surface p-4">
                    <p class="text-2xs font-bold text-muted">醣/脂分配估算</p>
                    <p class="text-base font-bold text-fg font-mono mt-1.5">{{ nutResult.carb }}g <span class="text-xs text-muted">/ {{ nutResult.fat }}g</span></p>
                    <p class="text-xs text-muted mt-1">碳水40% / 脂肪30%</p>
                  </div>

                  <div class="rounded-xl border border-hairline bg-surface p-4">
                    <p class="text-2xs font-bold text-muted">BMI / 標準體重 (IBW)</p>
                    <p class="text-xl font-bold font-mono mt-1" :class="Number(nutResult.bmi) < 18.5 ? 'text-accent' : Number(nutResult.bmi) > 24 ? 'text-danger' : 'text-success'">
                      {{ nutResult.bmi }}
                    </p>
                    <p class="text-xs text-muted mt-1">理想體重 ≈ {{ nutResult.ibw }} kg</p>
                  </div>

                  <div class="rounded-xl border border-hairline bg-surface p-4">
                    <p class="text-2xs font-bold text-muted">快速熱量區間</p>
                    <p class="text-sm font-bold text-fg-secondary font-mono mt-2">
                      {{ Math.round(Number(nut_weight) * 25) }} – {{ Math.round(Number(nut_weight) * 30) }} <span class="text-xs font-normal">kcal</span>
                    </p>
                    <p class="text-xs text-muted mt-1">依 25–30 kcal/kg/d 粗估</p>
                  </div>
                </div>
              </div>

              <div v-else class="h-full min-h-[200px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline bg-surface text-muted text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">🥗</span>
                請在左側輸入患者的身高、體重與年齡，以計算每日營養配比
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ══ Tool 5: FiO₂ 換算 ══════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'fio2'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-hairline pb-4">
            <h2 class="text-lg font-bold text-fg flex items-center gap-2">
              <span class="text-accent">💨</span> 氧氣裝置吸入氧濃度 (FiO₂) 換算與 P/F 比值
            </h2>
            <p class="text-xs text-muted mt-1 font-mono">Estimate fraction of inspired oxygen based on device and oxygen flow rate</p>
          </div>

          <!-- Modern Device Selector Cards -->
          <div>
            <label class="block text-xs font-bold text-fg-secondary mb-2">選擇氧氣給予裝置</label>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              <button
                v-for="(label, key) in deviceLabels"
                :key="key"
                @click="o2_device = key as O2Device; o2_flow = ''"
                class="px-3.5 py-3 rounded-xl border text-xs font-bold transition-all"
                :class="o2_device === key
                  ? 'bg-accent/10 border-accent/30 text-accent shadow-[0_0_10px_rgba(6,182,212,0.05)]'
                  : 'bg-surface border-hairline text-fg-secondary hover:text-fg hover:bg-surface/50'"
              >
                {{ label }}
              </button>
            </div>
          </div>

          <!-- Secondary inputs -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div class="space-y-4">
              <!-- Venturi specifics -->
              <div v-if="o2_device === 'venturi'" class="bg-overlay/[0.01] border border-hairline rounded-2xl p-4 space-y-3">
                <label class="block text-[0.6875rem] font-semibold text-fg-secondary">選擇文氏面罩 (Venturi) 設定點</label>
                <div class="grid grid-cols-6 gap-1">
                  <button
                    v-for="v in venturiOptions"
                    :key="v"
                    @click="o2_venturi = v"
                    class="py-2 text-xs font-mono font-bold rounded-lg border transition-all"
                    :class="o2_venturi === v
                      ? 'bg-accent/10 border-accent/30 text-accent'
                      : 'bg-surface border-hairline text-muted hover:text-fg-secondary'"
                  >
                    {{ v }}%
                  </button>
                </div>
                <p class="text-2xs text-muted font-sans mt-1">💡 文氏面罩在此設定下需配合同步給予流量：**≥ {{ venturiMap[o2_venturi] }} L/min**</p>
              </div>

              <!-- HFNC specifics -->
              <div v-if="o2_device === 'hfnc'">
                <label class="block text-xs font-semibold text-fg-secondary mb-1.5">高流量氧氣濃度 FiO₂ (%)</label>
                <div class="relative">
                  <input
                    v-model.number="o2_hfnc_fio2"
                    type="number"
                    min="21"
                    max="100"
                    placeholder="40"
                    class="w-full text-sm px-4 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 placeholder-muted transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-muted font-mono">%</span>
                </div>
              </div>

              <!-- General Flow -->
              <div v-if="o2_device !== 'venturi'">
                <label class="block text-xs font-semibold text-fg-secondary mb-1.5">
                  {{ o2_device === 'hfnc' ? '流量設定 (L/min) ' : '氧氣流量 (L/min)' }}
                  <span v-if="o2_device === 'hfnc'" class="text-muted font-normal">選填</span>
                </label>
                <div class="relative">
                  <input
                    v-model.number="o2_flow"
                    type="number"
                    step="1"
                    :placeholder="o2_device === 'nc' ? '建議 1–6' : o2_device === 'hfnc' ? '建議 20–60' : '建議 5–15'"
                    class="w-full text-sm px-4 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 placeholder-muted transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-muted font-mono">L/min</span>
                </div>
              </div>

              <!-- PaO2 input -->
              <div>
                <label class="block text-xs font-semibold text-fg-secondary mb-1.5">動脈氧分壓 PaO₂ (mmHg) <span class="text-muted font-normal">選填</span></label>
                <div class="relative">
                  <input
                    v-model.number="o2_pao2"
                    type="number"
                    placeholder="輸入後自動試算 P/F ratio"
                    class="w-full text-sm px-4 py-3 bg-surface border border-hairline rounded-xl text-fg outline-none focus:border-accent/50 placeholder-muted transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-muted font-mono">mmHg</span>
                </div>
              </div>
            </div>

            <!-- Result Box -->
            <div class="flex flex-col">
              <div v-if="fio2Result" class="rounded-2xl border border-hairline bg-surface p-6 shadow-xl space-y-4">
                <div>
                  <span class="text-xs font-bold text-muted">估算吸入氧濃度</span>
                  <div class="flex items-baseline gap-2 mt-1">
                    <span class="text-5xl font-extrabold text-fg tracking-tight font-mono">{{ fio2Result.fio2 }}</span>
                    <span class="text-lg text-fg-secondary font-mono">% FiO₂</span>
                  </div>
                  <p class="text-2xs text-muted font-sans mt-1.5 leading-relaxed">{{ fio2Result.note }}</p>
                </div>

                <div v-if="fio2Result.pf !== null" class="pt-4 border-t border-hairline space-y-1.5">
                  <span class="text-xs font-bold text-muted block">氧合指數 (P/F ratio)</span>
                  <div class="flex items-baseline gap-2">
                    <span
                      class="text-3xl font-extrabold font-mono tracking-tight"
                      :class="fio2Result.pf >= 300 ? 'text-success' : fio2Result.pf >= 200 ? 'text-warning' : 'text-danger'"
                    >
                      {{ fio2Result.pf }}
                    </span>
                    <span class="text-xs text-muted font-mono">mmHg</span>
                  </div>
                  <p
                    class="text-xs font-bold"
                    :class="fio2Result.pf >= 300 ? 'text-success' : fio2Result.pf >= 200 ? 'text-warning' : 'text-danger'"
                  >
                    {{ fio2Result.pfLabel }}
                  </p>
                </div>
              </div>

              <div v-else class="h-full min-h-[180px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline bg-surface text-muted text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">💨</span>
                請選擇適當的給氧裝置並輸入流量，以估計 FiO₂ 氧濃度
              </div>
            </div>
          </div>

          <!-- Quick table reference -->
          <div class="bg-overlay/[0.01] border border-hairline rounded-2xl p-5 space-y-3 max-w-xl">
            <p class="text-xs font-bold text-fg-secondary">氧氣裝置估算對照表 (Quick Reference)</p>
            <table class="w-full text-[0.6875rem] text-muted border-collapse">
              <thead>
                <tr class="text-fg-secondary border-b border-hairline text-left">
                  <th class="pb-2 font-semibold">給氧裝置</th>
                  <th class="pb-2 font-semibold">建議流量流速</th>
                  <th class="pb-2 font-semibold">估計 FiO₂ 範圍</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-hairline">
                <tr class="hover:bg-overlay/[0.01] transition-colors"><td class="py-2.5 font-medium text-fg-secondary">鼻導管 (Nasal Cannula)</td><td class="font-mono">1 – 6 L/min</td><td class="font-mono">24% – 44%</td></tr>
                <tr class="hover:bg-overlay/[0.01] transition-colors"><td class="py-2.5 font-medium text-fg-secondary">一般面罩 (Simple Face Mask)</td><td class="font-mono">5 – 10 L/min</td><td class="font-mono">40% – 60%</td></tr>
                <tr class="hover:bg-overlay/[0.01] transition-colors"><td class="py-2.5 font-medium text-fg-secondary">不重吸入面罩 (Non-rebreathing)</td><td class="font-mono">10 – 15 L/min</td><td class="font-mono">80% – 95%</td></tr>
                <tr class="hover:bg-overlay/[0.01] transition-colors"><td class="py-2.5 font-medium text-fg-secondary">文氏面罩 (Venturi Mask)</td><td class="">依設定 (可調)</td><td class="">24% – 60% (較為精準)</td></tr>
                <tr class="hover:bg-overlay/[0.01] transition-colors"><td class="py-2.5 font-medium text-fg-secondary">高流量鼻導管 (HFNC)</td><td class="font-mono">20 – 60 L/min</td><td class="">21% – 100% (直接設定)</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

    </div><!-- end right panel -->
  </div>
</template>

<style scoped>
/* Translucent styling overrides for standard form elements inside glass panels */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type=number] {
  -moz-appearance: textfield;
}
</style>
