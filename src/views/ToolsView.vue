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
  if (v < 8.5)  return { label: "低血鈣 (Hypocalcemia)",  color: "text-blue-400",  bg: "bg-blue-900/20" };
  if (v > 10.5) return { label: "高血鈣 (Hypercalcemia)", color: "text-red-400",   bg: "bg-red-900/20"  };
  return           { label: "正常 (Normal)",               color: "text-green-400", bg: "bg-green-900/20" };
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
  if (pH < 7.35)      lines.push({ text: `① pH ${pH} → 酸血症 (Acidosis)`,   color: "text-red-400" });
  else if (pH > 7.45) lines.push({ text: `① pH ${pH} → 鹼血症 (Alkalosis)`,  color: "text-sky-400" });
  else                lines.push({ text: `① pH ${pH} → 正常範圍`,             color: "text-green-400" });

  // Step 2 — Primary disorder
  const co2Hi  = co2  > 45;  const co2Lo  = co2  < 35;
  const hco3Hi = hco3 > 26;  const hco3Lo = hco3 < 22;

  if (pH < 7.35) {
    if (co2Hi && !hco3Lo)      lines.push({ text: `② PaCO₂ ${co2} mmHg ↑ → 呼吸性酸中毒`,      color: "text-orange-300" });
    else if (hco3Lo && !co2Hi) lines.push({ text: `② HCO₃⁻ ${hco3} mEq/L ↓ → 代謝性酸中毒`,   color: "text-orange-300" });
    else if (co2Hi && hco3Lo)  lines.push({ text: `② CO₂↑ + HCO₃⁻↓ → 混合型酸中毒`,           color: "text-red-300" });
    else                       lines.push({ text: `② 參數矛盾，請確認數值`,                     color: "text-yellow-400" });
  } else if (pH > 7.45) {
    if (co2Lo && !hco3Hi)      lines.push({ text: `② PaCO₂ ${co2} mmHg ↓ → 呼吸性鹼中毒`,      color: "text-sky-300" });
    else if (hco3Hi && !co2Lo) lines.push({ text: `② HCO₃⁻ ${hco3} mEq/L ↑ → 代謝性鹼中毒`,   color: "text-sky-300" });
    else if (co2Lo && hco3Hi)  lines.push({ text: `② CO₂↓ + HCO₃⁻↑ → 混合型鹼中毒`,           color: "text-blue-300" });
    else                       lines.push({ text: `② 參數矛盾，請確認數值`,                     color: "text-yellow-400" });
  }

  // Step 3 — Expected compensation
  if (pH < 7.35 && co2Hi) {
    const expAcute   = (24 + (co2 - 40) * 0.1).toFixed(1);
    const expChronic = (24 + (co2 - 40) * 0.35).toFixed(1);
    lines.push({ text: `③ 預期 HCO₃⁻：${expAcute}（急性）~ ${expChronic}（慢性）`, color: "text-gray-400" });
    if      (hco3 > Number(expChronic) + 2) lines.push({ text: "   ↳ HCO₃⁻ 過高 → 合併代謝性鹼中毒",    color: "text-yellow-400" });
    else if (hco3 < Number(expAcute) - 2)   lines.push({ text: "   ↳ HCO₃⁻ 過低 → 合併代謝性酸中毒",    color: "text-yellow-400" });
    else                                     lines.push({ text: "   ↳ 代償在預期範圍內",                  color: "text-gray-500" });
  } else if (pH < 7.35 && hco3Lo) {
    const expCo2 = 1.5 * hco3 + 8;
    lines.push({ text: `③ Winter 公式：預期 PaCO₂ = ${(expCo2 - 2).toFixed(0)} ~ ${(expCo2 + 2).toFixed(0)} mmHg`, color: "text-gray-400" });
    if      (co2 > expCo2 + 2) lines.push({ text: "   ↳ CO₂ 過高 → 合併呼吸性酸中毒", color: "text-yellow-400" });
    else if (co2 < expCo2 - 2) lines.push({ text: "   ↳ CO₂ 過低 → 合併呼吸性鹼中毒", color: "text-yellow-400" });
    else                        lines.push({ text: "   ↳ 代償在預期範圍內",             color: "text-gray-500" });
  } else if (pH > 7.45 && co2Lo) {
    const expA = (24 - (40 - co2) * 0.2).toFixed(1);
    const expC = (24 - (40 - co2) * 0.5).toFixed(1);
    lines.push({ text: `③ 預期 HCO₃⁻：${expC}（慢性）~ ${expA}（急性）`, color: "text-gray-400" });
    if      (hco3 < Number(expC) - 2) lines.push({ text: "   ↳ HCO₃⁻ 過低 → 合併代謝性酸中毒", color: "text-yellow-400" });
    else if (hco3 > Number(expA) + 2) lines.push({ text: "   ↳ HCO₃⁻ 過高 → 合併代謝性鹼中毒", color: "text-yellow-400" });
    else                               lines.push({ text: "   ↳ 代償在預期範圍內",                color: "text-gray-500" });
  } else if (pH > 7.45 && hco3Hi) {
    const expCo2 = 0.7 * hco3 + 21;
    lines.push({ text: `③ 預期 PaCO₂：${(expCo2 - 2).toFixed(0)} ~ ${(expCo2 + 2).toFixed(0)} mmHg`, color: "text-gray-400" });
    if      (co2 < expCo2 - 2) lines.push({ text: "   ↳ CO₂ 過低 → 合併呼吸性鹼中毒", color: "text-yellow-400" });
    else if (co2 > expCo2 + 2) lines.push({ text: "   ↳ CO₂ 過高 → 合併呼吸性酸中毒", color: "text-yellow-400" });
    else                        lines.push({ text: "   ↳ 代償在預期範圍內",              color: "text-gray-500" });
  }

  // Step 4 — Oxygenation (optional)
  const pao2 = Number(abg_pao2.value);
  const fio2 = Number(abg_fio2.value);
  if (pao2 && fio2) {
    const pAlv = (fio2 / 100) * (760 - 47) - co2 / 0.8;
    const aa   = pAlv - pao2;
    const pf   = pao2 / (fio2 / 100);
    const aaOk = aa <= 20;
    lines.push({ text: `④ A-a 梯度：${aa.toFixed(0)} mmHg${aaOk ? "（正常）" : "（↑ 異常，考慮 V/Q mismatch 或分流）"}`, color: aaOk ? "text-gray-400" : "text-orange-300" });
    const pfColor = pf >= 300 ? "text-green-400" : pf >= 200 ? "text-yellow-400" : "text-red-400";
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
  nc:      "鼻導管 (Nasal Cannula)",
  sm:      "一般面罩 (Simple Mask)",
  nrb:     "不重吸入面罩 (NRB Mask)",
  venturi: "文氏面罩 (Venturi Mask)",
  hfnc:    "高流量鼻導管 (HFNC)",
};

const fio2Result = computed(() => {
  const flow = Number(o2_flow.value);
  let fio2   = 0;
  let note   = "";

  if (o2_device.value === "nc") {
    if (!flow) return null;
    fio2 = Math.min(21 + 4 * flow, 44);
    note = "每升 ≈ +4% FiO₂（1–6 L/min）";
  } else if (o2_device.value === "sm") {
    if (!flow || flow < 5) return null;
    if (flow <= 6)      { fio2 = 40; note = "5–6 L/min"; }
    else if (flow <= 7) { fio2 = 50; note = "6–7 L/min"; }
    else                { fio2 = 60; note = "7–10 L/min"; }
  } else if (o2_device.value === "nrb") {
    if (!flow) return null;
    if (flow <= 10)      { fio2 = 80;  note = "≤10 L/min"; }
    else if (flow <= 12) { fio2 = 90;  note = "10–12 L/min"; }
    else                 { fio2 = 95;  note = ">12 L/min"; }
  } else if (o2_device.value === "venturi") {
    fio2 = o2_venturi.value;
    note = `建議流速 ≥ ${venturiMap[o2_venturi.value] ?? "—"} L/min`;
  } else if (o2_device.value === "hfnc") {
    fio2 = Number(o2_hfnc_fio2.value) || 0;
    if (!fio2) return null;
    note = `流速 ${flow || "—"} L/min`;
  }

  const pao2 = Number(o2_pao2.value);
  const pf   = pao2 ? Math.round(pao2 / (fio2 / 100)) : null;

  let pfLabel = "";
  if (pf !== null) {
    if (pf >= 400)      pfLabel = "正常";
    else if (pf >= 300) pfLabel = "輕度缺氧";
    else if (pf >= 200) pfLabel = "中度缺氧（ARDS 輕度）";
    else if (pf >= 100) pfLabel = "重度缺氧（ARDS 中/重度）";
    else                pfLabel = "極重度缺氧";
  }

  return { fio2, note, pf, pfLabel };
});

</script>

<template>
  <div class="flex h-full bg-gray-900 overflow-hidden">

    <!-- ── Left: tool list ──────────────────────────────────────────── -->
    <div class="w-52 shrink-0 border-r border-gray-800 flex flex-col bg-gray-950 overflow-y-auto">
      <div class="px-4 py-4 border-b border-gray-800">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">臨床工具集</p>
      </div>
      <nav class="flex-1 px-2 py-3 space-y-1">
        <button
          v-for="t in tools" :key="t.id"
          @click="activeTool = t.id"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
          :class="activeTool === t.id
            ? 'bg-blue-800/50 border border-blue-700/50 text-white'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'"
        >
          <span class="text-lg leading-none shrink-0">{{ t.icon }}</span>
          <div class="min-w-0">
            <div class="text-sm font-medium leading-tight">{{ t.label }}</div>
            <div class="text-xs text-gray-600 leading-tight mt-0.5">{{ t.sub }}</div>
          </div>
        </button>
      </nav>
    </div>

    <!-- ── Right: active tool ───────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto p-6">

      <!-- ══ 校正鈣 ══════════════════════════════════════════════════ -->
      <template v-if="activeTool === 'calcium'">
        <h2 class="text-base font-semibold text-white mb-1">🧪 校正鈣（Corrected Calcium）</h2>
        <p class="text-xs text-gray-500 mb-5">公式：校正鈣 = 實測鈣 + 0.8 × (4.0 − 白蛋白)</p>

        <div class="grid grid-cols-2 gap-4 max-w-sm mb-6">
          <div>
            <label class="block text-xs text-gray-500 mb-1">實測鈣 (mg/dL)</label>
            <input v-model.number="ca_total" type="number" step="0.1" placeholder="例：7.8"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">血清白蛋白 (g/dL)</label>
            <input v-model.number="ca_albumin" type="number" step="0.1" placeholder="例：2.5"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
        </div>

        <div v-if="correctedCa !== null"
          class="max-w-sm rounded-xl border p-4"
          :class="caStatus?.bg + ' border-gray-700'"
        >
          <div class="flex items-baseline gap-3">
            <span class="text-3xl font-bold text-white">{{ correctedCa.toFixed(2) }}</span>
            <span class="text-sm text-gray-400">mg/dL</span>
          </div>
          <div class="mt-1 text-sm font-semibold" :class="caStatus?.color">{{ caStatus?.label }}</div>
          <div class="mt-3 text-xs text-gray-600 space-y-0.5">
            <div>正常範圍：8.5 – 10.5 mg/dL</div>
            <div>&lt; 7.0 → 有症狀低血鈣風險（痙攣、Trousseau、Chvostek）</div>
            <div>&gt; 12.0 → 高血鈣危象風險（心律不整、意識改變）</div>
          </div>
        </div>

        <div v-else class="max-w-sm rounded-xl border border-dashed border-gray-700 p-6 text-center text-gray-700 text-sm">
          請輸入實測鈣與白蛋白
        </div>

        <div class="mt-6 max-w-sm text-xs text-gray-700 space-y-1 border-t border-gray-800 pt-4">
          <p class="text-gray-500 font-medium mb-2">參考</p>
          <p>• 白蛋白正常值：3.5–5.0 g/dL</p>
          <p>• 低白蛋白血症（&lt; 3.5 g/dL）會低估實測鈣，需做校正</p>
          <p>• 若需精確，建議測離子鈣（ionized calcium）</p>
        </div>
      </template>

      <!-- ══ ABG 判讀 ═════════════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'abg'">
        <h2 class="text-base font-semibold text-white mb-1">🫁 ABG 判讀</h2>
        <p class="text-xs text-gray-500 mb-5">輸入動脈血氣數據，自動分析酸鹼狀態與代償</p>

        <div class="grid grid-cols-3 gap-3 max-w-lg mb-3">
          <div>
            <label class="block text-xs text-gray-500 mb-1">pH</label>
            <input v-model.number="abg_ph" type="number" step="0.01" placeholder="7.40"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">PaCO₂ (mmHg)</label>
            <input v-model.number="abg_co2" type="number" placeholder="40"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">HCO₃⁻ (mEq/L)</label>
            <input v-model.number="abg_hco3" type="number" placeholder="24"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3 max-w-lg mb-5">
          <div>
            <label class="block text-xs text-gray-500 mb-1">PaO₂ (mmHg)　<span class="text-gray-700">選填</span></label>
            <input v-model.number="abg_pao2" type="number" placeholder="80"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">FiO₂ (%)　<span class="text-gray-700">選填</span></label>
            <input v-model.number="abg_fio2" type="number" placeholder="21"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
        </div>

        <div v-if="abgResult" class="max-w-lg rounded-xl border border-gray-700 bg-gray-800/40 p-4 space-y-2">
          <p v-for="(line, i) in abgResult" :key="i"
            class="text-sm font-mono leading-relaxed whitespace-pre-wrap"
            :class="line.color">{{ line.text }}</p>
        </div>
        <div v-else class="max-w-lg rounded-xl border border-dashed border-gray-700 p-6 text-center text-gray-700 text-sm">
          請輸入 pH、PaCO₂、HCO₃⁻
        </div>

        <div class="mt-6 max-w-lg text-xs text-gray-700 grid grid-cols-3 gap-2 border-t border-gray-800 pt-4">
          <div class="bg-gray-800/30 rounded p-2">
            <p class="text-gray-500 font-medium mb-1">正常值</p>
            <p>pH：7.35–7.45</p>
            <p>PaCO₂：35–45 mmHg</p>
            <p>HCO₃⁻：22–26 mEq/L</p>
            <p>PaO₂：80–100 mmHg</p>
          </div>
          <div class="bg-gray-800/30 rounded p-2">
            <p class="text-gray-500 font-medium mb-1">代謝性酸 代償</p>
            <p>Winter 公式：</p>
            <p>期望 PCO₂ =</p>
            <p>1.5 × HCO₃⁻ + 8 ± 2</p>
          </div>
          <div class="bg-gray-800/30 rounded p-2">
            <p class="text-gray-500 font-medium mb-1">呼吸性酸 代償</p>
            <p>急性：△HCO₃ = △CO₂ × 0.1</p>
            <p>慢性：△HCO₃ = △CO₂ × 0.35</p>
          </div>
        </div>
      </template>

      <!-- ══ 血糖試算 ══════════════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'glucose'">
        <h2 class="text-base font-semibold text-white mb-1">🩸 血糖胰島素校正試算</h2>
        <p class="text-xs text-gray-500 mb-5">公式：校正劑量 = (血糖 − 目標血糖) ÷ ISF　｜　ISF ≈ 1700 ÷ 每日總劑量 (TDD)</p>

        <div class="grid grid-cols-2 gap-4 max-w-sm mb-4">
          <div>
            <label class="block text-xs text-gray-500 mb-1">目前血糖 (mg/dL)</label>
            <input v-model.number="glu_bg" type="number" placeholder="例：250"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">目標血糖 (mg/dL)</label>
            <input v-model.number="glu_target" type="number" placeholder="140"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">每日總胰島素劑量 TDD (U)　<span class="text-gray-700">擇一</span></label>
            <input v-model.number="glu_tdd" type="number" placeholder="例：40"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">或直接輸入 ISF (mg/dL per U)</label>
            <input v-model.number="glu_isf" type="number" placeholder="例：42"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
        </div>

        <div v-if="insulinResult" class="max-w-sm rounded-xl border border-gray-700 bg-gray-800/40 p-4">
          <div v-if="Number(glu_bg) < 70" class="flex items-center gap-2 text-red-400 font-semibold text-sm mb-3">
            ⚠️ 低血糖！請立即處理，勿給予胰島素
          </div>
          <template v-else>
            <div v-if="insulinResult.needCorr" class="flex items-baseline gap-3 mb-1">
              <span class="text-3xl font-bold text-white">{{ insulinResult.dose }}</span>
              <span class="text-sm text-gray-400">Units 速效胰島素</span>
            </div>
            <div v-else class="text-green-400 font-semibold text-sm mb-1">✓ 血糖達標，不需校正劑量</div>
            <div class="text-xs text-gray-500 mt-1">ISF = {{ insulinResult.isf }} mg/dL/U</div>
          </template>
          <div class="mt-3 pt-3 border-t border-gray-700 text-xs space-y-1">
            <div :class="Number(glu_bg) < 70 ? 'text-red-400' : Number(glu_bg) < 140 ? 'text-green-400' : Number(glu_bg) < 250 ? 'text-yellow-400' : 'text-red-400'">
              血糖 {{ glu_bg }} mg/dL → {{ insulinResult.status }}
            </div>
          </div>
        </div>
        <div v-else class="max-w-sm rounded-xl border border-dashed border-gray-700 p-6 text-center text-gray-700 text-sm">
          請輸入血糖、目標血糖，以及 TDD 或 ISF
        </div>

        <div class="mt-6 max-w-sm text-xs text-gray-700 space-y-1 border-t border-gray-800 pt-4">
          <p class="text-gray-500 font-medium mb-2">參考</p>
          <p>• ISF（速效）= 1700 ÷ TDD</p>
          <p>• 住院目標血糖：一般病房 140–180；ICU 140–180 mg/dL</p>
          <p>• 劑量已四捨五入至 0.5 U，實際給藥仍需臨床判斷</p>
          <p>• 勿在血糖 &lt; 70 mg/dL 時給予胰島素</p>
        </div>
      </template>

      <!-- ══ 每日營養 ══════════════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'nutrition'">
        <h2 class="text-base font-semibold text-white mb-1">🥗 每日營養需求試算</h2>
        <p class="text-xs text-gray-500 mb-5">Harris-Benedict 公式 × 壓力係數</p>

        <div class="grid grid-cols-3 gap-3 max-w-lg mb-4">
          <div>
            <label class="block text-xs text-gray-500 mb-1">體重 (kg)</label>
            <input v-model.number="nut_weight" type="number" step="0.5" placeholder="70"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">身高 (cm)</label>
            <input v-model.number="nut_height" type="number" placeholder="170"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">年齡</label>
            <input v-model.number="nut_age" type="number" placeholder="50"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">性別</label>
            <div class="flex gap-2">
              <button @click="nut_gender = 'M'"
                class="flex-1 text-sm py-2 rounded-lg border transition-colors"
                :class="nut_gender === 'M' ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'">男</button>
              <button @click="nut_gender = 'F'"
                class="flex-1 text-sm py-2 rounded-lg border transition-colors"
                :class="nut_gender === 'F' ? 'bg-pink-700 border-pink-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'">女</button>
            </div>
          </div>
          <div class="col-span-2">
            <label class="block text-xs text-gray-500 mb-1">臨床狀態（壓力係數）</label>
            <select v-model.number="nut_stress"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500">
              <option v-for="o in stressOptions" :key="o.value" :value="o.value">{{ o.label }}（×{{ o.value }}）</option>
            </select>
          </div>
          <div class="col-span-3">
            <label class="block text-xs text-gray-500 mb-1">蛋白質需求</label>
            <select v-model.number="nut_protein"
              class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500">
              <option v-for="o in proteinOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>

        <div v-if="nutResult" class="max-w-lg grid grid-cols-2 gap-3">
          <div class="rounded-xl border border-gray-700 bg-gray-800/40 p-4 col-span-2">
            <div class="flex items-baseline gap-3">
              <span class="text-3xl font-bold text-white">{{ nutResult.tdee }}</span>
              <span class="text-sm text-gray-400">kcal/day（含壓力係數）</span>
            </div>
            <div class="text-xs text-gray-600 mt-0.5">基礎代謝 BMR：{{ nutResult.bmr }} kcal/day</div>
          </div>
          <div class="rounded-xl border border-gray-700 bg-gray-800/40 p-3">
            <p class="text-xs text-gray-500 mb-1">蛋白質</p>
            <p class="text-xl font-bold text-amber-300">{{ nutResult.protein }} g</p>
            <p class="text-xs text-gray-600">{{ nut_protein }} g/kg × {{ nut_weight }} kg</p>
          </div>
          <div class="rounded-xl border border-gray-700 bg-gray-800/40 p-3">
            <p class="text-xs text-gray-500 mb-1">醣類 / 脂肪</p>
            <p class="text-xl font-bold text-blue-300">{{ nutResult.carb }} g <span class="text-sm text-gray-500">/ {{ nutResult.fat }} g</span></p>
            <p class="text-xs text-gray-600">醣 ÷ 脂（40% ÷ 30%）</p>
          </div>
          <div class="rounded-xl border border-gray-700 bg-gray-800/30 p-3">
            <p class="text-xs text-gray-500 mb-1">BMI</p>
            <p class="text-xl font-bold" :class="Number(nutResult.bmi) < 18.5 ? 'text-blue-400' : Number(nutResult.bmi) > 27.5 ? 'text-red-400' : 'text-green-400'">
              {{ nutResult.bmi }}
            </p>
            <p class="text-xs text-gray-600">IBW ≈ {{ nutResult.ibw }} kg</p>
          </div>
          <div class="rounded-xl border border-gray-700 bg-gray-800/30 p-3">
            <p class="text-xs text-gray-500 mb-1">簡易熱量目標</p>
            <p class="text-sm text-gray-300">{{ Math.round(Number(nut_weight) * 25) }}–{{ Math.round(Number(nut_weight) * 30) }} kcal</p>
            <p class="text-xs text-gray-600">25–30 kcal/kg/day 估算</p>
          </div>
        </div>
        <div v-else class="max-w-lg rounded-xl border border-dashed border-gray-700 p-6 text-center text-gray-700 text-sm">
          請輸入體重、身高、年齡
        </div>
      </template>

      <!-- ══ FiO₂ 換算 ════════════════════════════════════════════════ -->
      <template v-else-if="activeTool === 'fio2'">
        <h2 class="text-base font-semibold text-white mb-1">💨 FiO₂ 換算</h2>
        <p class="text-xs text-gray-500 mb-5">根據氧氣給藥裝置與流速估算吸入氧濃度</p>

        <!-- Device selector -->
        <div class="flex flex-wrap gap-2 mb-5">
          <button v-for="(label, key) in deviceLabels" :key="key"
            @click="o2_device = key as O2Device; o2_flow = ''"
            class="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            :class="o2_device === key
              ? 'bg-blue-700 border-blue-600 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'">
            {{ label }}
          </button>
        </div>

        <div class="flex flex-wrap gap-4 mb-5 max-w-md">
          <!-- Venturi FiO2 selector -->
          <div v-if="o2_device === 'venturi'" class="w-full">
            <label class="block text-xs text-gray-500 mb-1">選擇 FiO₂ 設定</label>
            <div class="flex gap-2">
              <button v-for="v in venturiOptions" :key="v"
                @click="o2_venturi = v"
                class="flex-1 py-1.5 text-sm rounded-lg border transition-colors"
                :class="o2_venturi === v
                  ? 'bg-blue-700 border-blue-600 text-white font-semibold'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'">
                {{ v }}%
              </button>
            </div>
            <p class="text-xs text-gray-600 mt-1">建議流速 ≥ {{ venturiMap[o2_venturi] }} L/min</p>
          </div>

          <!-- HFNC FiO2 input -->
          <div v-if="o2_device === 'hfnc'">
            <label class="block text-xs text-gray-500 mb-1">設定 FiO₂ (%)</label>
            <input v-model.number="o2_hfnc_fio2" type="number" min="21" max="100" placeholder="40"
              class="w-32 text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>

          <!-- Flow rate (not for venturi) -->
          <div v-if="o2_device !== 'venturi'">
            <label class="block text-xs text-gray-500 mb-1">
              {{ o2_device === 'hfnc' ? '流速 (L/min)　選填' : '流速 (L/min)' }}
            </label>
            <input v-model.number="o2_flow" type="number" step="1"
              :placeholder="o2_device === 'nc' ? '1–6' : o2_device === 'hfnc' ? '20–60' : '5–15'"
              class="w-32 text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>

          <div>
            <label class="block text-xs text-gray-500 mb-1">PaO₂ (mmHg)　選填</label>
            <input v-model.number="o2_pao2" type="number" placeholder="計算 P/F"
              class="w-32 text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500" />
          </div>
        </div>

        <div v-if="fio2Result" class="max-w-sm rounded-xl border border-gray-700 bg-gray-800/40 p-4">
          <div class="flex items-baseline gap-3">
            <span class="text-4xl font-bold text-white">{{ fio2Result.fio2 }}</span>
            <span class="text-lg text-gray-400">% FiO₂</span>
          </div>
          <p class="text-xs text-gray-600 mt-0.5">{{ fio2Result.note }}</p>
          <div v-if="fio2Result.pf !== null" class="mt-3 pt-3 border-t border-gray-700">
            <div class="flex items-baseline gap-2">
              <span class="text-xl font-bold"
                :class="fio2Result.pf >= 300 ? 'text-green-400' : fio2Result.pf >= 200 ? 'text-yellow-400' : 'text-red-400'">
                {{ fio2Result.pf }}
              </span>
              <span class="text-sm text-gray-400">P/F ratio</span>
            </div>
            <p class="text-xs mt-0.5"
              :class="fio2Result.pf >= 300 ? 'text-gray-600' : fio2Result.pf >= 200 ? 'text-yellow-500' : 'text-red-400'">
              {{ fio2Result.pfLabel }}
            </p>
          </div>
        </div>
        <div v-else class="max-w-sm rounded-xl border border-dashed border-gray-700 p-6 text-center text-gray-700 text-sm">
          請選擇裝置並輸入流速
        </div>

        <!-- Quick reference table -->
        <div class="mt-6 max-w-lg border-t border-gray-800 pt-4">
          <p class="text-xs text-gray-500 font-medium mb-2">快速對照</p>
          <table class="w-full text-xs text-gray-600">
            <thead>
              <tr class="text-gray-500 border-b border-gray-800">
                <th class="text-left pb-1">裝置</th>
                <th class="text-left pb-1">流速</th>
                <th class="text-left pb-1">估計 FiO₂</th>
              </tr>
            </thead>
            <tbody class="space-y-1">
              <tr><td class="py-0.5">鼻導管</td><td>1–6 L/min</td><td>25–44%</td></tr>
              <tr><td class="py-0.5">一般面罩</td><td>5–10 L/min</td><td>40–60%</td></tr>
              <tr><td class="py-0.5">NRB 面罩</td><td>10–15 L/min</td><td>80–95%</td></tr>
              <tr><td class="py-0.5">Venturi 面罩</td><td>依色碼</td><td>24–60%（精確）</td></tr>
              <tr><td class="py-0.5">HFNC</td><td>20–60 L/min</td><td>21–100%（可設定）</td></tr>
            </tbody>
          </table>
          <div class="mt-3 text-xs text-gray-700 space-y-0.5">
            <p>P/F ≥ 400：正常　｜　≥ 300：輕度　｜　≥ 200：中度 ARDS　｜　&lt; 200：重度 ARDS</p>
          </div>
        </div>
      </template>

    </div><!-- end right panel -->
  </div>
</template>
