<script setup lang="ts">
import { ref, computed } from "vue";

type ToolId = "calcium" | "abg" | "glucose" | "nutrition" | "fio2";

const activeTool = ref<ToolId>("calcium");

const tools: { id: ToolId; icon: string; label: string; sub: string }[] = [
  { id: "calcium",   icon: "🧪", label: "校正鈣",    sub: "血清白蛋白校正" },
  { id: "abg",       icon: "🫁", label: "ABG 判讀",  sub: "pH 酸鹼分析" },
  { id: "glucose",   icon: "🩸", label: "血糖試算",  sub: "胰島素校正劑量" },
  { id: "nutrition", icon: "🥗", label: "每日營養",  sub: "熱量與蛋白質需求" },
  { id: "fio2",      icon: "💨", label: "FiO₂ 換算", sub: "氧氣裝置對照" },
];

// ─────────────────────────────────────────────────────────────────────────
// Tool 1 — 校正鈣（Corrected Calcium for Albumin）
// ─────────────────────────────────────────────────────────────────────────
const ca_total   = ref<number | "">("");
const ca_albumin = ref<number | "">("");

const correctedCa = computed(() => {
  const ca  = Number(ca_total.value);
  const alb = Number(ca_albumin.value);
  if (!ca || !alb) return null;
  return ca + 0.8 * (4.0 - alb);
});

const caStatus = computed(() => {
  const v = correctedCa.value;
  if (v === null) return null;
  if (v < 8.5)  return { label: "低血鈣 (Hypocalcemia)",  color: "text-sky-400",  bg: "bg-sky-500/10 border-sky-500/20" };
  if (v > 10.5) return { label: "高血鈣 (Hypercalcemia)", color: "text-rose-400",   bg: "bg-rose-500/10 border-rose-500/20"  };
  return           { label: "正常 (Normal)",               color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" };
});

// ─────────────────────────────────────────────────────────────────────────
// Tool 2 — ABG 判讀
// ─────────────────────────────────────────────────────────────────────────
const abg_ph   = ref<number | "">("");
const abg_co2  = ref<number | "">("");
const abg_hco3 = ref<number | "">("");
const abg_pao2 = ref<number | "">("");
const abg_fio2 = ref<number | "">(21);

interface AbgLine { text: string; color: string }

const abgResult = computed((): AbgLine[] | null => {
  const pH   = Number(abg_ph.value);
  const co2  = Number(abg_co2.value);
  const hco3 = Number(abg_hco3.value);
  if (!pH || !co2 || !hco3) return null;

  const lines: AbgLine[] = [];

  // Step 1 — pH
  if (pH < 7.35)      lines.push({ text: `① pH ${pH} → 酸血症 (Acidosis)`,   color: "text-rose-400 font-semibold" });
  else if (pH > 7.45) lines.push({ text: `① pH ${pH} → 鹼血症 (Alkalosis)`,  color: "text-cyan-400 font-semibold" });
  else                lines.push({ text: `① pH ${pH} → 正常範圍`,             color: "text-emerald-400" });

  // Step 2 — Primary disorder
  const co2Hi  = co2  > 45;  const co2Lo  = co2  < 35;
  const hco3Hi = hco3 > 26;  const hco3Lo = hco3 < 22;

  if (pH < 7.35) {
    if (co2Hi && !hco3Lo)      lines.push({ text: `② PaCO₂ ${co2} mmHg ↑ → 呼吸性酸中毒`,      color: "text-amber-400" });
    else if (hco3Lo && !co2Hi) lines.push({ text: `② HCO₃⁻ ${hco3} mEq/L ↓ → 代謝性酸中毒`,   color: "text-amber-400" });
    else if (co2Hi && hco3Lo)  lines.push({ text: `② CO₂↑ + HCO₃⁻↓ → 混合型酸中毒`,           color: "text-rose-400 font-semibold" });
    else                       lines.push({ text: `② 參數矛盾，請確認數值`,                     color: "text-yellow-400" });
  } else if (pH > 7.45) {
    if (co2Lo && !hco3Hi)      lines.push({ text: `② PaCO₂ ${co2} mmHg ↓ → 呼吸性鹼中毒`,      color: "text-cyan-400" });
    else if (hco3Hi && !co2Lo) lines.push({ text: `② HCO₃⁻ ${hco3} mEq/L ↑ → 代謝性鹼中毒`,   color: "text-cyan-400" });
    else if (co2Lo && hco3Hi)  lines.push({ text: `② CO₂↓ + HCO₃⁻↑ → 混合型鹼中毒`,           color: "text-purple-400" });
    else                       lines.push({ text: `② 參數矛盾，請確認數值`,                     color: "text-yellow-400" });
  }

  // Step 3 — Expected compensation
  if (pH < 7.35 && co2Hi) {
    const expAcute   = (24 + (co2 - 40) * 0.1).toFixed(1);
    const expChronic = (24 + (co2 - 40) * 0.35).toFixed(1);
    lines.push({ text: `③ 預期 HCO₃⁻：${expAcute}（急性）~ ${expChronic}（慢性）`, color: "text-slate-400" });
    if      (hco3 > Number(expChronic) + 2) lines.push({ text: "   ↳ HCO₃⁻ 過高 → 合併代謝性鹼中毒",    color: "text-amber-300" });
    else if (hco3 < Number(expAcute) - 2)   lines.push({ text: "   ↳ HCO₃⁻ 過低 → 合併代謝性酸中毒",    color: "text-amber-300" });
    else                                     lines.push({ text: "   ↳ 代償在預期範圍內",                  color: "text-slate-500" });
  } else if (pH < 7.35 && hco3Lo) {
    const expCo2 = 1.5 * hco3 + 8;
    lines.push({ text: `③ Winter 公式：預期 PaCO₂ = ${(expCo2 - 2).toFixed(0)} ~ ${(expCo2 + 2).toFixed(0)} mmHg`, color: "text-slate-400" });
    if      (co2 > expCo2 + 2) lines.push({ text: "   ↳ CO₂ 過高 → 合併呼吸性酸中毒", color: "text-amber-300" });
    else if (co2 < expCo2 - 2) lines.push({ text: "   ↳ CO₂ 過低 → 合併呼吸性鹼中毒", color: "text-amber-300" });
    else                        lines.push({ text: "   ↳ 代償在預期範圍內",             color: "text-slate-500" });
  } else if (pH > 7.45 && co2Lo) {
    const expA = (24 - (40 - co2) * 0.2).toFixed(1);
    const expC = (24 - (40 - co2) * 0.5).toFixed(1);
    lines.push({ text: `③ 預期 HCO₃⁻：${expC}（慢性）~ ${expA}（急性）`, color: "text-slate-400" });
    if      (hco3 < Number(expC) - 2) lines.push({ text: "   ↳ HCO₃⁻ 過低 → 合併代謝性酸中毒", color: "text-amber-300" });
    else if (hco3 > Number(expA) + 2) lines.push({ text: "   ↳ HCO₃⁻ 過高 → 合併代謝性鹼中毒", color: "text-amber-300" });
    else                               lines.push({ text: "   ↳ 代償在預期範圍內",                color: "text-slate-500" });
  } else if (pH > 7.45 && hco3Hi) {
    const expCo2 = 0.7 * hco3 + 21;
    lines.push({ text: `③ 預期 PaCO₂：${(expCo2 - 2).toFixed(0)} ~ ${(expCo2 + 2).toFixed(0)} mmHg`, color: "text-slate-400" });
    if      (co2 < expCo2 - 2) lines.push({ text: "   ↳ CO₂ 過低 → 合併呼吸性鹼中毒", color: "text-amber-300" });
    else if (co2 > expCo2 + 2) lines.push({ text: "   ↳ CO₂ 過高 → 合併呼吸性酸中毒", color: "text-amber-300" });
    else                        lines.push({ text: "   ↳ 代償在預期範圍內",              color: "text-slate-500" });
  }

  // Step 4 — Oxygenation (optional)
  const pao2 = Number(abg_pao2.value);
  const fio2 = Number(abg_fio2.value);
  if (pao2 && fio2) {
    const pAlv = (fio2 / 100) * (760 - 47) - co2 / 0.8;
    const aa   = pAlv - pao2;
    const pf   = pao2 / (fio2 / 100);
    const aaOk = aa <= 20;
    lines.push({ text: `④ A-a 梯度：${aa.toFixed(0)} mmHg${aaOk ? "（正常）" : "（↑ 異常，考慮 V/Q mismatch 或分流）"}`, color: aaOk ? "text-slate-400" : "text-amber-400" });
    const pfColor = pf >= 300 ? "text-emerald-400" : pf >= 200 ? "text-amber-400" : "text-rose-400 font-semibold";
    const pfLabel = pf >= 300 ? "" : pf >= 200 ? "（中度缺氧 ARDS 標準）" : "（重度缺氧 ARDS 標準）";
    lines.push({ text: `   P/F ratio：${pf.toFixed(0)}${pfLabel}`, color: pfColor });
  }

  return lines;
});

// ─────────────────────────────────────────────────────────────────────────
// Tool 3 — 血糖胰島素校正試算
// ─────────────────────────────────────────────────────────────────────────
const glu_bg     = ref<number | "">("");
const glu_target = ref<number | "">(140);
const glu_tdd    = ref<number | "">("");
const glu_isf    = ref<number | "">("");

const insulinResult = computed(() => {
  const bg     = Number(glu_bg.value);
  const target = Number(glu_target.value);
  const tdd    = Number(glu_tdd.value);
  let isf      = Number(glu_isf.value);
  if (!bg || !target) return null;
  if (!isf && tdd) isf = 1700 / tdd;
  if (!isf) return null;
  const rawDose = (bg - target) / isf;
  const dose    = Math.max(0, Math.round(rawDose * 2) / 2); // round to 0.5U
  let status = "";
  if (bg < 70)        status = "低血糖！請立即處理";
  else if (bg < 140)  status = "血糖達標，不需校正";
  else if (bg < 180)  status = "輕度偏高";
  else if (bg < 250)  status = "中度偏高";
  else                status = "嚴重偏高，注意 DKA/HHS";
  return { dose, isf: isf.toFixed(0), status, bg, needCorr: rawDose > 0 };
});

// ─────────────────────────────────────────────────────────────────────────
// Tool 4 — 每日營養需求
// ─────────────────────────────────────────────────────────────────────────
const nut_weight  = ref<number | "">("");
const nut_height  = ref<number | "">("");
const nut_age     = ref<number | "">("");
const nut_gender  = ref<"M" | "F">("M");
const nut_stress  = ref(1.2);
const nut_protein = ref(1.2);

const stressOptions = [
  { label: "正常 / 術後恢復",     value: 1.0 },
  { label: "輕度感染 / 小手術",   value: 1.2 },
  { label: "中度感染 / 大手術",   value: 1.5 },
  { label: "重度感染 / 大面積燒傷", value: 2.0 },
];

const proteinOptions = [
  { label: "一般維持  0.8 g/kg", value: 0.8 },
  { label: "術後恢復  1.2 g/kg", value: 1.2 },
  { label: "重症患者  1.5 g/kg", value: 1.5 },
  { label: "燒傷 / 高分解  2.0 g/kg", value: 2.0 },
];

const nutResult = computed(() => {
  const w = Number(nut_weight.value);
  const h = Number(nut_height.value);
  const a = Number(nut_age.value);
  if (!w || !h || !a) return null;

  // Harris-Benedict
  const bmr = nut_gender.value === "M"
    ? 88.362  + 13.397 * w + 4.799 * h - 5.677 * a
    : 447.593 +  9.247 * w + 3.098 * h - 4.330 * a;

  const tdee    = bmr * nut_stress.value;
  const protein = w * nut_protein.value;
  const fat     = (tdee * 0.3) / 9;
  const carb    = (tdee - protein * 4 - fat * 9) / 4;
  const bmi     = w / (h / 100) ** 2;
  const ibw     = nut_gender.value === "M" ? 50 + 2.3 * ((h - 152.4) / 2.54) : 45.5 + 2.3 * ((h - 152.4) / 2.54);

  return {
    bmr:     Math.round(bmr),
    tdee:    Math.round(tdee),
    protein: Math.round(protein),
    fat:     Math.round(fat),
    carb:    Math.round(Math.max(0, carb)),
    bmi:     bmi.toFixed(1),
    ibw:     Math.round(ibw),
  };
});

// ─────────────────────────────────────────────────────────────────────────
// Tool 5 — FiO₂ 換算
// ─────────────────────────────────────────────────────────────────────────
type O2Device = "nc" | "sm" | "nrb" | "venturi" | "hfnc";
const o2_device  = ref<O2Device>("nc");
const o2_flow    = ref<number | "">("");
const o2_venturi = ref(28);
const o2_pao2    = ref<number | "">("");
const o2_hfnc_fio2 = ref<number | "">(40);

const venturiMap: Record<number, number> = {
  24: 2, 28: 4, 31: 6, 35: 8, 40: 10, 60: 15,
};
const venturiOptions = [24, 28, 31, 35, 40, 60];

const deviceLabels: Record<O2Device, string> = {
  nc:      "鼻導管 (NC)",
  sm:      "一般面罩 (SM)",
  nrb:     "不重吸入面罩 (NRB)",
  venturi: "文氏面罩 (Venturi)",
  hfnc:    "高流量鼻導管 (HFNC)",
};

const fio2Result = computed(() => {
  const flow = Number(o2_flow.value);
  let fio2   = 0;
  let note   = "";

  if (o2_device.value === "nc") {
    if (!flow) return null;
    fio2 = Math.min(21 + 4 * flow, 44);
    note = "每升流速大約增加 4% FiO₂（常規限制在 1–6 L/min）";
  } else if (o2_device.value === "sm") {
    if (!flow || flow < 5) return null;
    if (flow <= 6)      { fio2 = 40; note = "建議 5–6 L/min"; }
    else if (flow <= 7) { fio2 = 50; note = "建議 6–7 L/min"; }
    else                { fio2 = 60; note = "建議 7–10 L/min"; }
  } else if (o2_device.value === "nrb") {
    if (!flow) return null;
    if (flow <= 10)      { fio2 = 80;  note = "流量建議 ≤ 10 L/min"; }
    else if (flow <= 12) { fio2 = 90;  note = "流量建議 10–12 L/min"; }
    else                 { fio2 = 95;  note = "流量建議 > 12 L/min"; }
  } else if (o2_device.value === "venturi") {
    fio2 = o2_venturi.value;
    note = `建議流速 ≥ ${venturiMap[o2_venturi.value] ?? "—"} L/min`;
  } else if (o2_device.value === "hfnc") {
    fio2 = Number(o2_hfnc_fio2.value) || 0;
    if (!fio2) return null;
    note = `流速設定 ${flow || "—"} L/min`;
  }

  const pao2 = Number(o2_pao2.value);
  const pf   = pao2 ? Math.round(pao2 / (fio2 / 100)) : null;

  let pfLabel = "";
  if (pf !== null) {
    if (pf >= 400)      pfLabel = "正常 (Normal)";
    else if (pf >= 300) pfLabel = "輕度缺氧 (Mild Hypoxia)";
    else if (pf >= 200) pfLabel = "中度缺氧 (ARDS 輕度標準)";
    else if (pf >= 100) pfLabel = "重度缺氧 (ARDS 中/重度標準)";
    else                pfLabel = "極重度缺氧 (Severe Hypoxia)";
  }

  return { fio2, note, pf, pfLabel };
});

</script>

<template>
  <div class="flex h-full bg-slate-950/20 rounded-2xl overflow-hidden border border-white/5 shadow-2xl">

    <!-- ── Left: elegant tool list sidebar ──────────────────────────── -->
    <div class="w-60 shrink-0 border-r border-white/5 flex flex-col bg-slate-900/60 backdrop-blur-xl">
      <div class="px-6 py-5 border-b border-white/5 flex items-center gap-2.5">
        <span class="text-xl">🎛️</span>
        <div>
          <p class="text-sm font-bold text-slate-200 tracking-wider">臨床工具集</p>
          <p class="text-[10px] text-slate-500 font-mono tracking-tight">CLINICAL DASHBOARD v1.1</p>
        </div>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        <button
          v-for="t in tools" :key="t.id"
          @click="activeTool = t.id"
          class="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left transition-all duration-300 relative group overflow-hidden"
          :class="activeTool === t.id
            ? 'bg-gradient-to-r from-cyan-500/10 to-teal-500/5 text-cyan-200 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'"
        >
          <!-- Active left indicator bar -->
          <div
            v-if="activeTool === t.id"
            class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-cyan-400 to-teal-500"
          />

          <span class="text-xl leading-none shrink-0 transition-transform duration-300 group-hover:scale-110">{{ t.icon }}</span>
          <div class="min-w-0">
            <div class="text-xs font-bold tracking-wide uppercase transition-colors" :class="activeTool === t.id ? 'text-cyan-200' : 'text-slate-300'">{{ t.label }}</div>
            <div class="text-[10px] text-slate-500 leading-tight mt-0.5 font-sans truncate">{{ t.sub }}</div>
          </div>
        </button>
      </nav>
    </div>

    <!-- ── Right: glassmorphic active tool content ──────────────────── -->
    <div class="flex-1 overflow-y-auto bg-slate-950/40 backdrop-blur-md p-8">

      <!-- ══ Tool 1: 校正鈣 ════════════════════════════════════════════ -->
      <template v-if="activeTool === 'calcium'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-white/5 pb-4">
            <h2 class="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span class="text-cyan-400">🧪</span> 校正鈣試算 (Corrected Calcium)
            </h2>
            <p class="text-xs text-slate-500 mt-1 font-mono">Formula: Corrected Ca = Total Ca + 0.8 × (4.0 − Albumin)</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
            <!-- Inputs -->
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">實測鈣 (mg/dL)</label>
                <div class="relative">
                  <input
                    v-model.number="ca_total"
                    type="number"
                    step="0.1"
                    placeholder="例：7.8"
                    class="w-full text-sm px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-slate-500 font-mono">mg/dL</span>
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">血清白蛋白 (g/dL)</label>
                <div class="relative">
                  <input
                    v-model.number="ca_albumin"
                    type="number"
                    step="0.1"
                    placeholder="例：2.5"
                    class="w-full text-sm px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-slate-500 font-mono">g/dL</span>
                </div>
              </div>
            </div>

            <!-- Result panel -->
            <div class="flex flex-col justify-center">
              <div v-if="correctedCa !== null"
                class="rounded-2xl border p-6 bg-slate-900/40 backdrop-blur-md shadow-lg transition-all duration-500"
                :class="caStatus?.bg + ' ' + (correctedCa < 8.5 ? 'border-sky-500/30' : correctedCa > 10.5 ? 'border-rose-500/30' : 'border-emerald-500/30')"
              >
                <span class="text-xs uppercase font-bold tracking-widest text-slate-500">計算結果</span>
                <div class="flex items-baseline gap-2 mt-2">
                  <span class="text-5xl font-extrabold text-white tracking-tight font-mono">{{ correctedCa.toFixed(2) }}</span>
                  <span class="text-xs text-slate-400 font-mono">mg/dL</span>
                </div>
                <div class="mt-2 text-xs font-bold tracking-wide" :class="caStatus?.color">{{ caStatus?.label }}</div>

                <div class="mt-6 space-y-1.5 border-t border-white/5 pt-4 text-[11px] text-slate-500 font-sans leading-relaxed">
                  <div class="flex justify-between"><span>正常範圍：</span><span class="font-mono text-slate-300">8.5 – 10.5 mg/dL</span></div>
                  <div class="flex justify-between"><span>低血鈣風險 (&lt;7.0)：</span><span class="text-sky-300">有抽搐/痙攣風險</span></div>
                  <div class="flex justify-between"><span>高血鈣危機 (&gt;12.0)：</span><span class="text-rose-300">心律不整/意識模糊</span></div>
                </div>
              </div>

              <div v-else class="h-full min-h-[180px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-900/10 text-slate-600 text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">🧪</span>
                請在左側輸入實測總鈣及白蛋白數值以進行校正
              </div>
            </div>
          </div>

          <div class="max-w-2xl bg-white/[0.02] border border-white/5 rounded-xl p-4 text-[11px] text-slate-500 space-y-1.5">
            <p class="font-semibold text-slate-400 uppercase tracking-wider mb-1">臨床備忘</p>
            <p>• 血中大約有 40-50% 的鈣離子是與白蛋白結合。當低白蛋白血症 (Albumin &lt; 4.0 g/dL) 發生時，測得的總鈣量會呈現偽性偏低，因此需要此公式校正。</p>
            <p>• 若臨床情況複雜（如酸鹼平衡失調、腎功能衰竭），強烈建議直接抽血量測 **游離鈣 (Ionized Calcium)** 最為精準。</p>
          </div>
        </div>
      </template>

      <!-- ══ Tool 2: ABG 判讀 ═══════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'abg'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-white/5 pb-4">
            <h2 class="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span class="text-cyan-400">🫁</span> 動脈血氣分析判讀 (ABG Interpretator)
            </h2>
            <p class="text-xs text-slate-500 mt-1 font-mono">Evaluate acidosis, alkalosis, compensation and oxygenation index</p>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <!-- Inputs Column -->
            <div class="space-y-4">
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">pH 值</label>
                  <input
                    v-model.number="abg_ph"
                    type="number"
                    step="0.01"
                    placeholder="7.40"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">PaCO₂ (mmHg)</label>
                  <input
                    v-model.number="abg_co2"
                    type="number"
                    placeholder="40"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">HCO₃⁻ (mEq/L)</label>
                  <input
                    v-model.number="abg_hco3"
                    type="number"
                    placeholder="24"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 tracking-wide uppercase">PaO₂ (mmHg) <span class="text-slate-600 font-normal">選填</span></label>
                  <input
                    v-model.number="abg_pao2"
                    type="number"
                    placeholder="80"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 tracking-wide uppercase">FiO₂ (%) <span class="text-slate-600 font-normal">選填</span></label>
                  <input
                    v-model.number="abg_fio2"
                    type="number"
                    placeholder="21"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
              </div>

              <!-- Quick normal values -->
              <div class="bg-white/[0.01] border border-white/5 rounded-2xl p-4 text-[10px] text-slate-500 grid grid-cols-2 gap-3 font-mono leading-relaxed">
                <div>
                  <p class="font-bold text-slate-400 mb-1 tracking-wider uppercase">生理正常值參考</p>
                  <div>pH: 7.35 – 7.45</div>
                  <div>PaCO₂: 35 – 45 mmHg</div>
                  <div>HCO₃⁻: 22 – 26 mEq/L</div>
                  <div>PaO₂: 80 – 100 mmHg</div>
                </div>
                <div>
                  <p class="font-bold text-slate-400 mb-1 tracking-wider uppercase">代償係數提示</p>
                  <div>代謝性酸 (Winter): 1.5×HCO₃+8±2</div>
                  <div>呼吸性酸 (急性): △HCO₃=△CO₂×0.1</div>
                  <div>呼吸性酸 (慢性): △HCO₃=△CO₂×0.35</div>
                </div>
              </div>
            </div>

            <!-- Result Column -->
            <div class="flex flex-col justify-start">
              <div v-if="abgResult" class="rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-md p-6 shadow-xl space-y-4">
                <span class="text-xs uppercase font-bold tracking-widest text-slate-500">判讀分析序列</span>
                <div class="space-y-3 font-mono text-sm leading-relaxed">
                  <div
                    v-for="(line, i) in abgResult"
                    :key="i"
                    class="flex items-start gap-2.5 p-2 rounded-lg bg-slate-950/40 border border-white/[0.02]"
                  >
                    <span class="mt-0.5 text-xs text-slate-500">•</span>
                    <span :class="line.color" class="whitespace-pre-wrap">{{ line.text }}</span>
                  </div>
                </div>
              </div>

              <div v-else class="h-full min-h-[220px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-900/10 text-slate-600 text-xs text-center p-6">
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
          <div class="border-b border-white/5 pb-4">
            <h2 class="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span class="text-cyan-400">🩸</span> 血糖胰島素校正試算 (Insulin Correction)
            </h2>
            <p class="text-xs text-slate-500 mt-1 font-mono">Dose = (Current BG - Target BG) ÷ ISF | ISF ≈ 1700 ÷ TDD</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
            <!-- Inputs -->
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">目前血糖 (BG)</label>
                  <div class="relative">
                    <input
                      v-model.number="glu_bg"
                      type="number"
                      placeholder="例：250"
                      class="w-full text-sm px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                    />
                    <span class="absolute right-4 top-3.5 text-[10px] text-slate-600 font-mono">mg/dL</span>
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">目標血糖</label>
                  <div class="relative">
                    <input
                      v-model.number="glu_target"
                      type="number"
                      placeholder="140"
                      class="w-full text-sm px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                    />
                    <span class="absolute right-4 top-3.5 text-[10px] text-slate-600 font-mono">mg/dL</span>
                  </div>
                </div>
              </div>

              <div class="border-t border-white/5 pt-4">
                <p class="text-xs font-semibold text-slate-400 mb-3 tracking-wide uppercase">胰島素敏感度 (ISF) 計算基準 <span class="text-slate-600 font-normal">擇一</span></p>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-[11px] text-slate-500 mb-1 font-medium">每日胰島素總劑量 (TDD)</label>
                    <div class="relative">
                      <input
                        v-model.number="glu_tdd"
                        type="number"
                        placeholder="例：40"
                        class="w-full text-xs px-3.5 py-2.5 bg-slate-900/50 border border-white/10 rounded-lg text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                      />
                      <span class="absolute right-3 top-3 text-[9px] text-slate-600 font-mono">Units</span>
                    </div>
                  </div>
                  <div>
                    <label class="block text-[11px] text-slate-500 mb-1 font-medium">直接指定 ISF 數值</label>
                    <div class="relative">
                      <input
                        v-model.number="glu_isf"
                        type="number"
                        placeholder="例：42"
                        class="w-full text-xs px-3.5 py-2.5 bg-slate-900/50 border border-white/10 rounded-lg text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                      />
                      <span class="absolute right-3 top-3 text-[9px] text-slate-600 font-mono">mg/dL/U</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Result -->
            <div class="flex flex-col justify-center">
              <div v-if="insulinResult" class="rounded-2xl border border-white/10 p-6 bg-slate-900/40 backdrop-blur-md shadow-xl transition-all">
                <span class="text-xs uppercase font-bold tracking-widest text-slate-500">建議校正劑量</span>
                
                <div v-if="Number(glu_bg) < 70" class="mt-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-start gap-2.5">
                  <span class="text-lg">⚠️</span>
                  <div class="text-xs">
                    <p class="font-bold">嚴重低血糖危險！</p>
                    <p class="mt-0.5 opacity-80">血糖值低於 70 mg/dL，請遵循低血糖處置流程（服用/注射葡萄糖），此時**絕對禁止**追加速效胰島素。</p>
                  </div>
                </div>

                <template v-else>
                  <div v-if="insulinResult.needCorr" class="mt-3">
                    <div class="flex items-baseline gap-2">
                      <span class="text-5xl font-extrabold text-cyan-400 font-mono tracking-tight">{{ insulinResult.dose }}</span>
                      <span class="text-xs text-slate-400 font-mono">Units</span>
                    </div>
                    <p class="text-xs font-semibold text-slate-300 mt-1 font-mono">速效胰島素 (Rapid-acting insulin)</p>
                  </div>
                  <div v-else class="mt-3 flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                    <span>✓</span> 血糖達標，不需追加速效胰島素。
                  </div>
                  
                  <div class="mt-6 pt-4 border-t border-white/5 space-y-1 text-[11px] text-slate-500">
                    <div class="flex justify-between"><span>估算敏感度 ISF：</span><span class="font-mono text-slate-300">{{ insulinResult.isf }} mg/dL / Unit</span></div>
                    <div class="flex justify-between"><span>當前血糖狀態：</span><span class="font-bold text-slate-300">{{ insulinResult.status }}</span></div>
                  </div>
                </template>
              </div>

              <div v-else class="h-full min-h-[180px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-900/10 text-slate-600 text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">🩸</span>
                請填寫血糖值、目標血糖與敏感度計算基準 (TDD 或直接輸入 ISF)
              </div>
            </div>
          </div>

          <div class="max-w-2xl bg-white/[0.02] border border-white/5 rounded-xl p-4 text-[11px] text-slate-500 space-y-1 border-t border-white/5 mt-4">
            <p class="font-semibold text-slate-400 uppercase tracking-wider mb-1">注意事項</p>
            <p>• 一般病房住院患者餐前血糖控制目標建議為 140–180 mg/dL，重症病房 (ICU) 同樣建議維持在 140–180 mg/dL。</p>
            <p>• 本試算之校正劑量已四捨五入至最接近的 0.5 單位 (Unit)，臨床醫囑開立仍需依患者個別胰島素抗性與臨床現狀進行細微調整。</p>
          </div>
        </div>
      </template>

      <!-- ══ Tool 4: 每日營養 ══════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'nutrition'">
        <div class="max-w-3xl space-y-6">
          <div class="border-b border-white/5 pb-4">
            <h2 class="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span class="text-cyan-400">🥗</span> 每日營養與熱量需求評估 (Nutrition Calculator)
            </h2>
            <p class="text-xs text-slate-500 mt-1 font-mono">Harris-Benedict Equation & Activity/Stress Factors</p>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <!-- Inputs Column -->
            <div class="space-y-4">
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">體重 (kg)</label>
                  <input
                    v-model.number="nut_weight"
                    type="number"
                    step="0.5"
                    placeholder="70"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">身高 (cm)</label>
                  <input
                    v-model.number="nut_height"
                    type="number"
                    placeholder="170"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">年齡 (歲)</label>
                  <input
                    v-model.number="nut_age"
                    type="number"
                    placeholder="50"
                    class="w-full text-sm px-3.5 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 placeholder-slate-600 transition-all font-mono"
                  />
                </div>
              </div>

              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">生理性別</label>
                  <div class="flex gap-1">
                    <button
                      @click="nut_gender = 'M'"
                      class="flex-1 text-xs py-3 rounded-xl border transition-all"
                      :class="nut_gender === 'M' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 font-bold' : 'bg-slate-900/30 border-white/10 text-slate-500 hover:text-slate-300'"
                    >男</button>
                    <button
                      @click="nut_gender = 'F'"
                      class="flex-1 text-xs py-3 rounded-xl border transition-all"
                      :class="nut_gender === 'F' ? 'bg-pink-500/10 border-pink-500/30 text-pink-400 font-bold' : 'bg-slate-900/30 border-white/10 text-slate-500 hover:text-slate-300'"
                    >女</button>
                  </div>
                </div>

                <div class="col-span-2">
                  <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">壓力係數 (Stress Factor)</label>
                  <select
                    v-model.number="nut_stress"
                    class="w-full text-xs px-3.5 py-3.5 bg-slate-900/80 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 transition-all"
                  >
                    <option v-for="o in stressOptions" :key="o.value" :value="o.value">{{ o.label }} (×{{ o.value }})</option>
                  </select>
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">蛋白質給予基準</label>
                <select
                  v-model.number="nut_protein"
                  class="w-full text-xs px-3.5 py-3.5 bg-slate-900/80 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 transition-all"
                >
                  <option v-for="o in proteinOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </div>
            </div>

            <!-- Results Column -->
            <div class="flex flex-col justify-start">
              <div v-if="nutResult" class="space-y-4">
                <!-- TDEE Card -->
                <div class="rounded-2xl border border-cyan-500/10 bg-gradient-to-br from-cyan-500/10 to-teal-500/5 p-6 shadow-xl relative overflow-hidden">
                  <span class="text-xs uppercase font-bold tracking-widest text-slate-500">每日總耗能 (TDEE)</span>
                  <div class="flex items-baseline gap-2 mt-2">
                    <span class="text-4xl font-extrabold text-white tracking-tight font-mono">{{ nutResult.tdee }}</span>
                    <span class="text-xs text-slate-400 font-mono">kcal / 每日</span>
                  </div>
                  <div class="text-[10px] text-slate-500 mt-1 font-mono">基礎代謝率 (BMR): {{ nutResult.bmr }} kcal</div>
                </div>

                <!-- Detail Grid -->
                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-xl border border-white/5 bg-slate-900/30 p-4">
                    <p class="text-[10px] uppercase font-bold tracking-wider text-slate-500">蛋白質目標</p>
                    <p class="text-2xl font-bold text-cyan-300 font-mono mt-1">{{ nutResult.protein }} <span class="text-xs font-normal text-slate-500">g</span></p>
                    <p class="text-[9px] text-slate-600 font-mono mt-1">{{ nut_protein }} g/kg × {{ nut_weight }} kg</p>
                  </div>

                  <div class="rounded-xl border border-white/5 bg-slate-900/30 p-4">
                    <p class="text-[10px] uppercase font-bold tracking-wider text-slate-500">醣/脂分配估算</p>
                    <p class="text-base font-bold text-slate-200 font-mono mt-1.5">{{ nutResult.carb }}g <span class="text-xs text-slate-500">/ {{ nutResult.fat }}g</span></p>
                    <p class="text-[9px] text-slate-600 mt-1">碳水40% / 脂肪30%</p>
                  </div>

                  <div class="rounded-xl border border-white/5 bg-slate-900/30 p-4">
                    <p class="text-[10px] uppercase font-bold tracking-wider text-slate-500">BMI / 標準體重 (IBW)</p>
                    <p class="text-xl font-bold font-mono mt-1" :class="Number(nutResult.bmi) < 18.5 ? 'text-sky-400' : Number(nutResult.bmi) > 24 ? 'text-rose-400' : 'text-emerald-400'">
                      {{ nutResult.bmi }}
                    </p>
                    <p class="text-[9px] text-slate-600 font-mono mt-1">理想體重 ≈ {{ nutResult.ibw }} kg</p>
                  </div>

                  <div class="rounded-xl border border-white/5 bg-slate-900/30 p-4">
                    <p class="text-[10px] uppercase font-bold tracking-wider text-slate-500">快速熱量區間</p>
                    <p class="text-sm font-bold text-slate-300 font-mono mt-2">
                      {{ Math.round(Number(nut_weight) * 25) }} – {{ Math.round(Number(nut_weight) * 30) }} <span class="text-xs font-normal">kcal</span>
                    </p>
                    <p class="text-[9px] text-slate-600 mt-1">依 25–30 kcal/kg/d 粗估</p>
                  </div>
                </div>
              </div>

              <div v-else class="h-full min-h-[200px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-900/10 text-slate-600 text-xs text-center p-6">
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
          <div class="border-b border-white/5 pb-4">
            <h2 class="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span class="text-cyan-400">💨</span> 氧氣裝置吸入氧濃度 (FiO₂) 換算與 P/F 比值
            </h2>
            <p class="text-xs text-slate-500 mt-1 font-mono">Estimate fraction of inspired oxygen based on device and oxygen flow rate</p>
          </div>

          <!-- Modern Device Selector Cards -->
          <div>
            <label class="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">選擇氧氣給予裝置</label>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              <button
                v-for="(label, key) in deviceLabels"
                :key="key"
                @click="o2_device = key as O2Device; o2_flow = ''"
                class="px-3.5 py-3 rounded-xl border text-xs font-bold transition-all"
                :class="o2_device === key
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.05)]'
                  : 'bg-slate-900/30 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'"
              >
                {{ label }}
              </button>
            </div>
          </div>

          <!-- Secondary inputs -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div class="space-y-4">
              <!-- Venturi specifics -->
              <div v-if="o2_device === 'venturi'" class="bg-white/[0.01] border border-white/5 rounded-2xl p-4 space-y-3">
                <label class="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">選擇文氏面罩 (Venturi) 設定點</label>
                <div class="grid grid-cols-6 gap-1">
                  <button
                    v-for="v in venturiOptions"
                    :key="v"
                    @click="o2_venturi = v"
                    class="py-2 text-xs font-mono font-bold rounded-lg border transition-all"
                    :class="o2_venturi === v
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                      : 'bg-slate-900/50 border-white/5 text-slate-500 hover:text-slate-300'"
                  >
                    {{ v }}%
                  </button>
                </div>
                <p class="text-[10px] text-slate-500 font-sans mt-1">💡 文氏面罩在此設定下需配合同步給予流量：**≥ {{ venturiMap[o2_venturi] }} L/min**</p>
              </div>

              <!-- HFNC specifics -->
              <div v-if="o2_device === 'hfnc'">
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">高流量氧氣濃度 FiO₂ (%)</label>
                <div class="relative">
                  <input
                    v-model.number="o2_hfnc_fio2"
                    type="number"
                    min="21"
                    max="100"
                    placeholder="40"
                    class="w-full text-sm px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 placeholder-slate-600 transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-slate-500 font-mono">%</span>
                </div>
              </div>

              <!-- General Flow -->
              <div v-if="o2_device !== 'venturi'">
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                  {{ o2_device === 'hfnc' ? '流量設定 (L/min) ' : '氧氣流量 (L/min)' }}
                  <span v-if="o2_device === 'hfnc'" class="text-slate-600 font-normal">選填</span>
                </label>
                <div class="relative">
                  <input
                    v-model.number="o2_flow"
                    type="number"
                    step="1"
                    :placeholder="o2_device === 'nc' ? '建議 1–6' : o2_device === 'hfnc' ? '建議 20–60' : '建議 5–15'"
                    class="w-full text-sm px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 placeholder-slate-600 transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-slate-500 font-mono">L/min</span>
                </div>
              </div>

              <!-- PaO2 input -->
              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">動脈氧分壓 PaO₂ (mmHg) <span class="text-slate-600 font-normal">選填</span></label>
                <div class="relative">
                  <input
                    v-model.number="o2_pao2"
                    type="number"
                    placeholder="輸入後自動試算 P/F ratio"
                    class="w-full text-sm px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-slate-200 outline-none focus:border-cyan-500/50 placeholder-slate-600 transition-all font-mono"
                  />
                  <span class="absolute right-4 top-3.5 text-xs text-slate-500 font-mono">mmHg</span>
                </div>
              </div>
            </div>

            <!-- Result Box -->
            <div class="flex flex-col">
              <div v-if="fio2Result" class="rounded-2xl border border-white/10 bg-slate-900/40 p-6 shadow-xl space-y-4">
                <div>
                  <span class="text-xs uppercase font-bold tracking-widest text-slate-500">估算吸入氧濃度</span>
                  <div class="flex items-baseline gap-2 mt-1">
                    <span class="text-5xl font-extrabold text-white tracking-tight font-mono">{{ fio2Result.fio2 }}</span>
                    <span class="text-lg text-slate-400 font-mono">% FiO₂</span>
                  </div>
                  <p class="text-[10px] text-slate-500 font-sans mt-1.5 leading-relaxed">{{ fio2Result.note }}</p>
                </div>

                <div v-if="fio2Result.pf !== null" class="pt-4 border-t border-white/5 space-y-1.5">
                  <span class="text-xs uppercase font-bold tracking-widest text-slate-500 block">氧合指數 (P/F ratio)</span>
                  <div class="flex items-baseline gap-2">
                    <span
                      class="text-3xl font-extrabold font-mono tracking-tight"
                      :class="fio2Result.pf >= 300 ? 'text-emerald-400' : fio2Result.pf >= 200 ? 'text-amber-400' : 'text-rose-400'"
                    >
                      {{ fio2Result.pf }}
                    </span>
                    <span class="text-xs text-slate-500 font-mono">mmHg</span>
                  </div>
                  <p
                    class="text-xs font-bold"
                    :class="fio2Result.pf >= 300 ? 'text-emerald-400' : fio2Result.pf >= 200 ? 'text-amber-400' : 'text-rose-400'"
                  >
                    {{ fio2Result.pfLabel }}
                  </p>
                </div>
              </div>

              <div v-else class="h-full min-h-[180px] flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-900/10 text-slate-600 text-xs text-center p-6">
                <span class="text-3xl mb-3 opacity-30">💨</span>
                請選擇適當的給氧裝置並輸入流量，以估計 FiO₂ 氧濃度
              </div>
            </div>
          </div>

          <!-- Quick table reference -->
          <div class="bg-white/[0.01] border border-white/5 rounded-2xl p-5 space-y-3 max-w-xl">
            <p class="text-xs font-bold text-slate-300 uppercase tracking-wide">氧氣裝置估算對照表 (Quick Reference)</p>
            <table class="w-full text-[11px] text-slate-500 border-collapse">
              <thead>
                <tr class="text-slate-400 border-b border-white/5 text-left font-mono">
                  <th class="pb-2 font-semibold">給氧裝置</th>
                  <th class="pb-2 font-semibold">建議流量流速</th>
                  <th class="pb-2 font-semibold">估計 FiO₂ 範圍</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/[0.03]">
                <tr class="hover:bg-white/[0.01] transition-colors"><td class="py-2.5 font-medium text-slate-300">鼻導管 (Nasal Cannula)</td><td class="font-mono">1 – 6 L/min</td><td class="font-mono">24% – 44%</td></tr>
                <tr class="hover:bg-white/[0.01] transition-colors"><td class="py-2.5 font-medium text-slate-300">一般面罩 (Simple Face Mask)</td><td class="font-mono">5 – 10 L/min</td><td class="font-mono">40% – 60%</td></tr>
                <tr class="hover:bg-white/[0.01] transition-colors"><td class="py-2.5 font-medium text-slate-300">不重吸入面罩 (Non-rebreathing)</td><td class="font-mono">10 – 15 L/min</td><td class="font-mono">80% – 95%</td></tr>
                <tr class="hover:bg-white/[0.01] transition-colors"><td class="py-2.5 font-medium text-slate-300">文氏面罩 (Venturi Mask)</td><td class="font-mono">依設定 (可調)</td><td class="font-mono">24% – 60% (較為精準)</td></tr>
                <tr class="hover:bg-white/[0.01] transition-colors"><td class="py-2.5 font-medium text-slate-300">高流量鼻導管 (HFNC)</td><td class="font-mono">20 – 60 L/min</td><td class="font-mono">21% – 100% (直接設定)</td></tr>
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
