/**
 * 臨床工具公式，桌機 ToolsView 與手機共用（ADR-013）。
 * 只做計算，不含畫面；顏色以語意等級（Tone）回傳，由各端對應樣式。
 * 公式與閾值自桌機原實作逐字搬出，修改時兩端同時生效。
 */

export type Tone = "danger-strong" | "danger" | "warning" | "caution" | "accent-strong" | "accent" | "success" | "secondary" | "muted";
export interface Line { text: string; tone: Tone }

const num = (v: number | string | null | undefined) => Number(v) || 0;

// ── 校正鈣（Corrected Calcium for Albumin）────────────────────────
export function correctedCalcium(total: number | string, albumin: number | string): number | null {
  const ca = num(total), alb = num(albumin);
  if (!ca || !alb) return null;
  return ca + 0.8 * (4.0 - alb);
}

export function calciumStatus(v: number | null): { level: "low" | "high" | "normal"; label: string } | null {
  if (v === null) return null;
  if (v < 8.5)  return { level: "low",    label: "低血鈣 (Hypocalcemia)" };
  if (v > 10.5) return { level: "high",   label: "高血鈣 (Hypercalcemia)" };
  return          { level: "normal", label: "正常 (Normal)" };
}

// ── ABG 判讀 ─────────────────────────────────────────────────────
export interface AbgInput { ph: number | string; co2: number | string; hco3: number | string; pao2?: number | string; fio2?: number | string }

export function interpretAbg(input: AbgInput): Line[] | null {
  const pH = num(input.ph), co2 = num(input.co2), hco3 = num(input.hco3);
  if (!pH || !co2 || !hco3) return null;
  const lines: Line[] = [];

  // Step 1 — pH
  if (pH < 7.35)      lines.push({ text: `① pH ${pH} → 酸血症 (Acidosis)`,  tone: "danger-strong" });
  else if (pH > 7.45) lines.push({ text: `① pH ${pH} → 鹼血症 (Alkalosis)`, tone: "accent-strong" });
  else                lines.push({ text: `① pH ${pH} → 正常範圍`,            tone: "success" });

  // Step 2 — Primary disorder
  const co2Hi = co2 > 45, co2Lo = co2 < 35, hco3Hi = hco3 > 26, hco3Lo = hco3 < 22;
  if (pH < 7.35) {
    if (co2Hi && !hco3Lo)      lines.push({ text: `② PaCO₂ ${co2} mmHg ↑ → 呼吸性酸中毒`,    tone: "warning" });
    else if (hco3Lo && !co2Hi) lines.push({ text: `② HCO₃⁻ ${hco3} mEq/L ↓ → 代謝性酸中毒`, tone: "warning" });
    else if (co2Hi && hco3Lo)  lines.push({ text: `② CO₂↑ + HCO₃⁻↓ → 混合型酸中毒`,         tone: "danger-strong" });
    else                       lines.push({ text: `② 參數矛盾，請確認數值`,                   tone: "caution" });
  } else if (pH > 7.45) {
    if (co2Lo && !hco3Hi)      lines.push({ text: `② PaCO₂ ${co2} mmHg ↓ → 呼吸性鹼中毒`,    tone: "accent" });
    else if (hco3Hi && !co2Lo) lines.push({ text: `② HCO₃⁻ ${hco3} mEq/L ↑ → 代謝性鹼中毒`, tone: "accent" });
    else if (co2Lo && hco3Hi)  lines.push({ text: `② CO₂↓ + HCO₃⁻↑ → 混合型鹼中毒`,         tone: "accent" });
    else                       lines.push({ text: `② 參數矛盾，請確認數值`,                   tone: "caution" });
  }

  // Step 3 — Expected compensation
  if (pH < 7.35 && co2Hi) {
    const expAcute = (24 + (co2 - 40) * 0.1).toFixed(1);
    const expChronic = (24 + (co2 - 40) * 0.35).toFixed(1);
    lines.push({ text: `③ 預期 HCO₃⁻：${expAcute}（急性）~ ${expChronic}（慢性）`, tone: "secondary" });
    if      (hco3 > Number(expChronic) + 2) lines.push({ text: "   ↳ HCO₃⁻ 過高 → 合併代謝性鹼中毒", tone: "warning" });
    else if (hco3 < Number(expAcute) - 2)   lines.push({ text: "   ↳ HCO₃⁻ 過低 → 合併代謝性酸中毒", tone: "warning" });
    else                                     lines.push({ text: "   ↳ 代償在預期範圍內",               tone: "muted" });
  } else if (pH < 7.35 && hco3Lo) {
    const expCo2 = 1.5 * hco3 + 8;
    lines.push({ text: `③ Winter 公式：預期 PaCO₂ = ${(expCo2 - 2).toFixed(0)} ~ ${(expCo2 + 2).toFixed(0)} mmHg`, tone: "secondary" });
    if      (co2 > expCo2 + 2) lines.push({ text: "   ↳ CO₂ 過高 → 合併呼吸性酸中毒", tone: "warning" });
    else if (co2 < expCo2 - 2) lines.push({ text: "   ↳ CO₂ 過低 → 合併呼吸性鹼中毒", tone: "warning" });
    else                        lines.push({ text: "   ↳ 代償在預期範圍內",             tone: "muted" });
  } else if (pH > 7.45 && co2Lo) {
    const expA = (24 - (40 - co2) * 0.2).toFixed(1);
    const expC = (24 - (40 - co2) * 0.5).toFixed(1);
    lines.push({ text: `③ 預期 HCO₃⁻：${expC}（慢性）~ ${expA}（急性）`, tone: "secondary" });
    if      (hco3 < Number(expC) - 2) lines.push({ text: "   ↳ HCO₃⁻ 過低 → 合併代謝性酸中毒", tone: "warning" });
    else if (hco3 > Number(expA) + 2) lines.push({ text: "   ↳ HCO₃⁻ 過高 → 合併代謝性鹼中毒", tone: "warning" });
    else                               lines.push({ text: "   ↳ 代償在預期範圍內",               tone: "muted" });
  } else if (pH > 7.45 && hco3Hi) {
    const expCo2 = 0.7 * hco3 + 21;
    lines.push({ text: `③ 預期 PaCO₂：${(expCo2 - 2).toFixed(0)} ~ ${(expCo2 + 2).toFixed(0)} mmHg`, tone: "secondary" });
    if      (co2 < expCo2 - 2) lines.push({ text: "   ↳ CO₂ 過低 → 合併呼吸性鹼中毒", tone: "warning" });
    else if (co2 > expCo2 + 2) lines.push({ text: "   ↳ CO₂ 過高 → 合併呼吸性酸中毒", tone: "warning" });
    else                        lines.push({ text: "   ↳ 代償在預期範圍內",             tone: "muted" });
  }

  // Step 4 — Oxygenation (optional)
  const pao2 = num(input.pao2), fio2 = num(input.fio2);
  if (pao2 && fio2) {
    const pAlv = (fio2 / 100) * (760 - 47) - co2 / 0.8;
    const aa = pAlv - pao2;
    const pf = pao2 / (fio2 / 100);
    const aaOk = aa <= 20;
    lines.push({ text: `④ A-a 梯度：${aa.toFixed(0)} mmHg${aaOk ? "（正常）" : "（↑ 異常，考慮 V/Q mismatch 或分流）"}`, tone: aaOk ? "secondary" : "warning" });
    const pfTone: Tone = pf >= 300 ? "success" : pf >= 200 ? "warning" : "danger-strong";
    const pfLabel = pf >= 300 ? "" : pf >= 200 ? "（中度缺氧 ARDS 標準）" : "（重度缺氧 ARDS 標準）";
    lines.push({ text: `   P/F ratio：${pf.toFixed(0)}${pfLabel}`, tone: pfTone });
  }
  return lines;
}

// ── 血糖胰島素校正試算 ───────────────────────────────────────────
/** ISF 的計算基準三選一 */
export type GluBasis = "tdd" | "weight" | "isf";

/** 體重估算 TDD：常用起始 0.3–0.5 U/kg/day */
export function estimateTdd(weight: number | string, ukg: number): number | null {
  const w = num(weight);
  if (!w) return null;
  return Math.round(w * ukg * 10) / 10;
}

export interface InsulinInput { bg: number | string; target: number | string; basis: GluBasis; tdd: number | string; weight: number | string; ukg: number; isf: number | string }

export function effectiveTdd(i: Pick<InsulinInput, "basis" | "tdd" | "weight" | "ukg">): number | null {
  if (i.basis === "tdd") return num(i.tdd) || null;
  if (i.basis === "weight") return estimateTdd(i.weight, i.ukg);
  return null;
}

export function insulinCorrection(i: InsulinInput) {
  const bg = num(i.bg), target = num(i.target);
  if (!bg || !target) return null;
  let isf = 0;
  let tddNote = "";
  if (i.basis === "isf") {
    isf = num(i.isf);
  } else {
    const tdd = effectiveTdd(i);
    if (tdd) {
      isf = 1700 / tdd;
      tddNote = i.basis === "weight" ? `${tdd} U（體重估算 ${i.ukg} U/kg）` : `${tdd} U`;
    }
  }
  if (!isf) return null;
  const rawDose = (bg - target) / isf;
  const dose = Math.max(0, Math.round(rawDose * 2) / 2); // round to 0.5U
  let status = "";
  if (bg < 70)       status = "低血糖！請立即處理";
  else if (bg < 140) status = "血糖達標，不需校正";
  else if (bg < 180) status = "輕度偏高";
  else if (bg < 250) status = "中度偏高";
  else               status = "嚴重偏高，注意 DKA/HHS";
  return { dose, isf: isf.toFixed(0), status, bg, needCorr: rawDose > 0, tddNote, estimated: i.basis === "weight" };
}

// ── 每日營養需求 ─────────────────────────────────────────────────
export const STRESS_OPTIONS = [
  { label: "正常 / 術後恢復",       value: 1.0 },
  { label: "輕度感染 / 小手術",     value: 1.2 },
  { label: "中度感染 / 大手術",     value: 1.5 },
  { label: "重度感染 / 大面積燒傷", value: 2.0 },
];

export const PROTEIN_OPTIONS = [
  { label: "一般維持  0.8 g/kg",     value: 0.8 },
  { label: "術後恢復  1.2 g/kg",     value: 1.2 },
  { label: "重症患者  1.5 g/kg",     value: 1.5 },
  { label: "燒傷 / 高分解  2.0 g/kg", value: 2.0 },
];

export interface NutritionInput { weight: number | string; height: number | string; age: number | string; gender: "M" | "F"; stress: number; proteinPerKg: number }

export function nutrition(i: NutritionInput) {
  const w = num(i.weight), h = num(i.height), a = num(i.age);
  if (!w || !h || !a) return null;
  // Harris-Benedict
  const bmr = i.gender === "M"
    ? 88.362 + 13.397 * w + 4.799 * h - 5.677 * a
    : 447.593 + 9.247 * w + 3.098 * h - 4.330 * a;
  const tdee = bmr * i.stress;
  const protein = w * i.proteinPerKg;
  const fat = (tdee * 0.3) / 9;
  const carb = (tdee - protein * 4 - fat * 9) / 4;
  const bmi = w / (h / 100) ** 2;
  const ibw = i.gender === "M" ? 50 + 2.3 * ((h - 152.4) / 2.54) : 45.5 + 2.3 * ((h - 152.4) / 2.54);
  return {
    bmr: Math.round(bmr), tdee: Math.round(tdee), protein: Math.round(protein),
    fat: Math.round(fat), carb: Math.round(Math.max(0, carb)), bmi: bmi.toFixed(1), ibw: Math.round(ibw),
  };
}

// ── FiO₂ 換算 ───────────────────────────────────────────────────
export type O2Device = "nc" | "sm" | "nrb" | "venturi" | "hfnc";

export const VENTURI_FLOW: Record<number, number> = { 24: 2, 28: 4, 31: 6, 35: 8, 40: 10, 60: 15 };
export const VENTURI_OPTIONS = [24, 28, 31, 35, 40, 60];
export const DEVICE_LABELS: Record<O2Device, string> = {
  nc: "鼻導管 (NC)",
  sm: "一般面罩 (SM)",
  nrb: "不重吸入面罩 (NRB)",
  venturi: "文氏面罩 (Venturi)",
  hfnc: "高流量鼻導管 (HFNC)",
};

export interface Fio2Input { device: O2Device; flow: number | string; venturi: number; hfncFio2: number | string; pao2: number | string }

export function fio2Estimate(i: Fio2Input) {
  const flow = num(i.flow);
  let fio2 = 0;
  let note = "";
  if (i.device === "nc") {
    if (!flow) return null;
    fio2 = Math.min(21 + 4 * flow, 44);
    note = "每升流速大約增加 4% FiO₂（常規限制在 1–6 L/min）";
  } else if (i.device === "sm") {
    if (!flow || flow < 5) return null;
    if (flow <= 6)      { fio2 = 40; note = "建議 5–6 L/min"; }
    else if (flow <= 7) { fio2 = 50; note = "建議 6–7 L/min"; }
    else                { fio2 = 60; note = "建議 7–10 L/min"; }
  } else if (i.device === "nrb") {
    if (!flow) return null;
    if (flow <= 10)      { fio2 = 80; note = "流量建議 ≤ 10 L/min"; }
    else if (flow <= 12) { fio2 = 90; note = "流量建議 10–12 L/min"; }
    else                 { fio2 = 95; note = "流量建議 > 12 L/min"; }
  } else if (i.device === "venturi") {
    fio2 = i.venturi;
    note = `建議流速 ≥ ${VENTURI_FLOW[i.venturi] ?? "—"} L/min`;
  } else if (i.device === "hfnc") {
    fio2 = num(i.hfncFio2);
    if (!fio2) return null;
    note = `流速設定 ${flow || "—"} L/min`;
  }
  const pao2 = num(i.pao2);
  const pf = pao2 ? Math.round(pao2 / (fio2 / 100)) : null;
  let pfLabel = "";
  if (pf !== null) {
    if (pf >= 400)      pfLabel = "正常 (Normal)";
    else if (pf >= 300) pfLabel = "輕度缺氧 (Mild Hypoxia)";
    else if (pf >= 200) pfLabel = "中度缺氧 (ARDS 輕度標準)";
    else if (pf >= 100) pfLabel = "重度缺氧 (ARDS 中/重度標準)";
    else                pfLabel = "極重度缺氧 (Severe Hypoxia)";
  }
  return { fio2, note, pf, pfLabel };
}
