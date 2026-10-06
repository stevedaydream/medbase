/**
 * 常用公式（ADR-018）：只做公式計算，不換算藥物劑量。桌機與手機共用。
 */
import { correctedCalcium, calciumStatus } from "../clinicalCalc";

export interface FormulaInput { key: string; label: string; unit: string; options?: { value: number; label: string }[] }

export interface Formula {
  id: string;
  name: string;
  inputs: FormulaInput[];
  formula: string;
  /** 缺值或不合理時回傳 null */
  compute: (v: Record<string, number>) => { value: number; unit: string; note?: string; extra?: Record<string, number>; breakdown?: { label: string; points: number }[] } | null;
  normal?: string;
  ref: { title: string; url: string };
  /** 只給數值判讀卡用，不列在計算工具 */
  hidden?: boolean;
  /** compute 的 extra 數值名稱與單位（數值判讀卡顯示級距範圍用） */
  extraLabels?: Record<string, { label: string; unit: string }>;
}

const ok = (...xs: (number | undefined)[]) => xs.every(x => x !== undefined && Number.isFinite(x));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ── 泵速換算 ───────────────────────────────────────────────────────
const UNIT_LABELS = ["mcg/kg/min", "mcg/min", "mg/h", "U/min"];
export const PUMP_UNIT_LABELS = UNIT_LABELS;
const PUMP_UNITS = UNIT_LABELS.map((label, value) => ({ value, label }));
const PUMP_NOTE = "請核對醫囑與院內泡法；高警訊藥物雙人核對。";
const PUMP_REF = { title: "藥師+：IV pump 泡法（常見泡法整理，非院內標準）", url: "https://pharmacistplus.com/to/850430" };
/** 1 劑量單位對應幾 mL/h；缺值或不合理回 null */
function pumpFactor(v: Record<string, number>): number | null {
  if (!ok(v.unit, v.amt, v.vol) || v.amt <= 0 || v.vol <= 0) return null;
  const perMl = v.amt / v.vol; // mg/mL 或 U/mL
  switch (v.unit) {
    case 0: return ok(v.wt) && v.wt > 0 ? (v.wt * 60) / (perMl * 1000) : null; // mcg/kg/min
    case 1: return 60 / (perMl * 1000);                                        // mcg/min
    case 2: return 1 / perMl;                                                  // mg/h
    case 3: return 60 / perMl;                                                 // U/min
    default: return null;
  }
}
function concText(v: Record<string, number>): string {
  const perMl = v.amt / v.vol;
  return v.unit === 3 ? `濃度 ${round(perMl, 3)} U/mL` : `濃度 ${round(perMl * 1000, 1)} mcg/mL`;
}

export const FORMULAS: Formula[] = [
  {
    id: "map", name: "平均動脈壓 MAP",
    inputs: [{ key: "sbp", label: "收縮壓", unit: "mmHg" }, { key: "dbp", label: "舒張壓", unit: "mmHg" }],
    formula: "(收縮壓 + 2 × 舒張壓) ÷ 3",
    compute: v => {
      if (!ok(v.sbp, v.dbp) || v.sbp < v.dbp || v.sbp <= 0) return null;
      const pp = v.sbp - v.dbp;
      return {
        value: round((v.sbp + 2 * v.dbp) / 3, 0), unit: "mmHg",
        note: `脈壓 ${pp} mmHg（收縮壓的 ${round(pp / v.sbp * 100, 0)}%）`,
        extra: { sbp: v.sbp, dbp: v.dbp, pp, ppr: round(pp / v.sbp * 100, 1) },
      };
    },
    extraLabels: { pp: { label: "脈壓", unit: "mmHg" }, ppr: { label: "脈壓／收縮壓", unit: "%" } },
    normal: "一般約 70–100；≥65 代表灌流壓足夠。脈壓 <收縮壓的 25% 為脈壓過窄",
    ref: { title: "MDCalc: Mean Arterial Pressure (MAP)", url: "https://www.mdcalc.com/calc/74/mean-arterial-pressure-map" },
  },
  {
    id: "ca", name: "校正鈣（低白蛋白）",
    inputs: [{ key: "ca", label: "血鈣", unit: "mg/dL" }, { key: "alb", label: "白蛋白", unit: "g/dL" }],
    formula: "血鈣 + 0.8 × (4 − 白蛋白)",
    compute: v => {
      if (!ok(v.ca, v.alb) || v.alb <= 0) return null;
      const c = correctedCalcium(v.ca, v.alb)!;
      return { value: round(c), unit: "mg/dL", note: `${calciumStatus(c)!.label}；處置見數值判讀「鈣離子」` };
    },
    normal: "約 8.5–10.5 mg/dL（依院內檢驗參考值）",
    ref: { title: "MDCalc: Calcium Correction for Hypoalbuminemia", url: "https://www.mdcalc.com/calc/31/calcium-correction-hypoalbuminemia" },
  },
  {
    id: "ag", name: "陰離子間隙 Anion gap",
    inputs: [{ key: "na", label: "Na", unit: "mEq/L" }, { key: "cl", label: "Cl", unit: "mEq/L" }, { key: "hco3", label: "HCO3", unit: "mEq/L" }, { key: "alb", label: "白蛋白（選填，校正用）", unit: "g/dL" }],
    formula: "Na − (Cl + HCO3)；校正：＋ 2.5 × (4 − 白蛋白)",
    compute: v => {
      if (!ok(v.na, v.cl, v.hco3)) return null;
      const ag = v.na - (v.cl + v.hco3);
      return ok(v.alb) && v.alb > 0
        ? { value: round(ag + 2.5 * (4 - v.alb)), unit: "mEq/L", note: `未校正 ${round(ag)}` }
        : { value: round(ag), unit: "mEq/L" };
    },
    normal: "約 8–12 mEq/L（依院內檢驗方法）",
    ref: { title: "MDCalc: Anion Gap", url: "https://www.mdcalc.com/calc/1669/anion-gap" },
  },
  {
    id: "crcl", name: "肌酸酐清除率（Cockcroft-Gault）",
    inputs: [
      { key: "age", label: "年齡", unit: "歲" }, { key: "wt", label: "體重", unit: "kg" }, { key: "cr", label: "Creatinine", unit: "mg/dL" },
      { key: "female", label: "性別", unit: "", options: [{ value: 0, label: "男" }, { value: 1, label: "女" }] },
    ],
    formula: "(140 − 年齡) × 體重 ÷ (72 × Cr)；女性 × 0.85",
    compute: v => {
      if (!ok(v.age, v.wt, v.cr, v.female) || v.cr <= 0 || v.age >= 140) return null;
      const c = ((140 - v.age) * v.wt) / (72 * v.cr) * (v.female ? 0.85 : 1);
      return { value: round(c, 0), unit: "mL/min", note: "藥物劑量調整請依藥品仿單與藥師建議" };
    },
    ref: { title: "MDCalc: Creatinine Clearance (Cockcroft-Gault Equation)", url: "https://www.mdcalc.com/calc/43/creatinine-clearance-cockcroft-gault-equation" },
  },
  {
    id: "osm", name: "血漿滲透壓（計算值）",
    inputs: [{ key: "na", label: "Na", unit: "mEq/L" }, { key: "glu", label: "血糖", unit: "mg/dL" }, { key: "bun", label: "BUN", unit: "mg/dL" }],
    formula: "2 × Na + 血糖 ÷ 18 + BUN ÷ 2.8",
    compute: v => ok(v.na, v.glu, v.bun) ? { value: round(2 * v.na + v.glu / 18 + v.bun / 2.8, 0), unit: "mOsm/kg" } : null,
    normal: "約 275–295 mOsm/kg",
    ref: { title: "MDCalc: Serum Osmolality/Osmolarity", url: "https://www.mdcalc.com/calc/91/serum-osmolality-osmolarity" },
  },
  {
    id: "na-glu", name: "校正鈉（高血糖）",
    inputs: [{ key: "na", label: "Na", unit: "mEq/L" }, { key: "glu", label: "血糖", unit: "mg/dL" }],
    formula: "Na + 1.6 × (血糖 − 100) ÷ 100（Katz）；Hillier 用 2.4",
    compute: v => ok(v.na, v.glu) ? { value: round(v.na + 1.6 * (v.glu - 100) / 100), unit: "mEq/L", note: `Hillier：${round(v.na + 2.4 * (v.glu - 100) / 100)}` } : null,
    ref: { title: "MDCalc: Sodium Correction for Hyperglycemia", url: "https://www.mdcalc.com/calc/50/sodium-correction-hyperglycemia" },
  },
  {
    id: "fwd", name: "自由水缺乏量（高血鈉）",
    inputs: [
      { key: "na", label: "Na", unit: "mEq/L" }, { key: "wt", label: "體重", unit: "kg" },
      { key: "female", label: "性別", unit: "", options: [{ value: 0, label: "男" }, { value: 1, label: "女" }] },
    ],
    formula: "體液比例 × 體重 × (Na ÷ 140 − 1)；體液比例 男 0.6、女 0.5（老年人各減 0.1）",
    compute: v => {
      if (!ok(v.na, v.wt, v.female) || v.na <= 140) return null;
      return { value: round((v.female ? 0.5 : 0.6) * v.wt * (v.na / 140 - 1)), unit: "L", note: "估計值；矯正速度與輸液選擇依醫囑" };
    },
    ref: { title: "MDCalc: Free Water Deficit in Hypernatremia", url: "https://www.mdcalc.com/calc/113/free-water-deficit-hypernatremia" },
  },
  {
    id: "gbs", name: "Glasgow-Blatchford 評分（上消化道出血）",
    inputs: [
      { key: "bun", label: "BUN", unit: "mg/dL" }, { key: "hb", label: "Hb", unit: "g/dL" },
      { key: "sbp", label: "收縮壓", unit: "mmHg" }, { key: "hr", label: "心跳", unit: "/min" },
      { key: "female", label: "性別", unit: "", options: [{ value: 0, label: "男" }, { value: 1, label: "女" }] },
      { key: "melena", label: "黑便", unit: "", options: [{ value: 0, label: "無" }, { value: 1, label: "有" }] },
      { key: "syncope", label: "暈厥", unit: "", options: [{ value: 0, label: "無" }, { value: 1, label: "有" }] },
      { key: "liver", label: "肝病史", unit: "", options: [{ value: 0, label: "無" }, { value: 1, label: "有" }] },
      { key: "hf", label: "心衰竭", unit: "", options: [{ value: 0, label: "無" }, { value: 1, label: "有" }] },
    ],
    formula: "BUN、Hb（依性別）、收縮壓、心跳 ≥100、黑便、暈厥、肝病、心衰竭各項加總（0–23）",
    compute: v => {
      if (!ok(v.bun, v.hb, v.sbp, v.hr, v.female, v.melena, v.syncope, v.liver, v.hf)) return null;
      let s = 0;
      s += v.bun >= 70 ? 6 : v.bun >= 28 ? 4 : v.bun >= 22.4 ? 3 : v.bun >= 18.2 ? 2 : 0;
      s += v.female
        ? (v.hb < 10 ? 6 : v.hb < 12 ? 1 : 0)
        : (v.hb < 10 ? 6 : v.hb < 12 ? 3 : v.hb < 13 ? 1 : 0);
      s += v.sbp < 90 ? 3 : v.sbp < 100 ? 2 : v.sbp < 110 ? 1 : 0;
      s += v.hr >= 100 ? 1 : 0;
      s += v.melena ? 1 : 0;
      s += v.syncope ? 2 : 0;
      s += v.liver ? 2 : 0;
      s += v.hf ? 2 : 0;
      return { value: s, unit: "分", note: s <= 1 ? "0–1 分為極低風險（指引：急診可考慮門診追蹤）" : "≥2 分需住院評估與處置" };
    },
    ref: { title: "MDCalc: Glasgow-Blatchford Bleeding Score (GBS)", url: "https://www.mdcalc.com/calc/518/glasgow-blatchford-bleeding-score-gbs" },
  },
  {
    id: "child-pugh", name: "Child–Pugh 肝功能分級",
    inputs: [
      { key: "bili", label: "總膽紅素", unit: "mg/dL" },
      { key: "alb", label: "白蛋白", unit: "g/dL" },
      { key: "inr", label: "INR", unit: "" },
      { key: "ascites", label: "腹水", unit: "", options: [
        { value: 1, label: "無" }, { value: 2, label: "輕度／利尿劑可控制" }, { value: 3, label: "利尿劑治療後仍中重度" },
      ] },
      { key: "encephalopathy", label: "肝性腦病變", unit: "", options: [
        { value: 1, label: "無" }, { value: 2, label: "第 I–II 級" }, { value: 3, label: "第 III–IV 級" },
      ] },
    ],
    formula: "總膽紅素、白蛋白、INR、腹水、肝性腦病變各 1–3 分，加總 5–15 分",
    compute: v => {
      if (!ok(v.bili, v.alb, v.inr, v.ascites, v.encephalopathy)
        || v.bili < 0 || v.alb <= 0 || v.inr <= 0
        || ![1, 2, 3].includes(v.ascites) || ![1, 2, 3].includes(v.encephalopathy)) return null;
      const breakdown = [
        { label: "總膽紅素", points: v.bili < 2 ? 1 : v.bili <= 3 ? 2 : 3 },
        { label: "白蛋白", points: v.alb > 3.5 ? 1 : v.alb >= 2.8 ? 2 : 3 },
        { label: "INR", points: v.inr < 1.7 ? 1 : v.inr <= 2.3 ? 2 : 3 },
        { label: "腹水", points: v.ascites },
        { label: "肝性腦病變", points: v.encephalopathy },
      ];
      const total = breakdown.reduce((sum, item) => sum + item.points, 0);
      const grade = total <= 6 ? "A" : total <= 9 ? "B" : "C";
      return { value: total, unit: "分", note: `Child–Pugh ${grade} 級`, breakdown };
    },
    normal: "A 級 5–6 分；B 級 7–9 分；C 級 10–15 分。各項 1／2／3 分門檻：總膽紅素 <2／2–3／>3 mg/dL；白蛋白 >3.5／2.8–3.5／<2.8 g/dL；INR <1.7／1.7–2.3／>2.3。適用肝硬化的一般計分；膽汁鬱積性疾病可能採不同膽紅素門檻，抗凝血治療可能影響 INR，須由臨床判斷。",
    ref: { title: "Merck Manual：Child–Turcotte–Pugh 計分", url: "https://www.merckmanuals.com/professional/multimedia/table/child-turcotte-pugh-scoring-system" },
  },
  {
    id: "pump", name: "泵速換算：劑量 → mL/h",
    inputs: [
      { key: "unit", label: "劑量單位", unit: "", options: PUMP_UNITS },
      { key: "dose", label: "醫囑劑量", unit: "" }, { key: "wt", label: "體重（mcg/kg/min 才需要）", unit: "kg" },
      { key: "amt", label: "藥物總量", unit: "mg（vasopressin 用 U）" }, { key: "vol", label: "總體積", unit: "mL" },
    ],
    formula: "泵速 = 劑量 ÷ 濃度（濃度＝藥物總量 ÷ 總體積，依劑量單位換算）",
    compute: v => {
      const k = pumpFactor(v);
      return k && ok(v.dose) ? { value: round(v.dose * k, 1), unit: "mL/h", note: PUMP_NOTE + concText(v) } : null;
    },
    ref: PUMP_REF,
  },
  {
    id: "pump-rev", name: "泵速換算：mL/h → 劑量",
    inputs: [
      { key: "unit", label: "劑量單位", unit: "", options: PUMP_UNITS },
      { key: "rate", label: "目前泵速", unit: "mL/h" }, { key: "wt", label: "體重（mcg/kg/min 才需要）", unit: "kg" },
      { key: "amt", label: "藥物總量", unit: "mg（vasopressin 用 U）" }, { key: "vol", label: "總體積", unit: "mL" },
    ],
    formula: "劑量 = 泵速 × 濃度（依劑量單位換算）",
    compute: v => {
      const k = pumpFactor(v);
      if (!k || !ok(v.rate)) return null;
      const d = v.rate / k;
      return { value: round(d, v.unit === 0 ? 3 : 2), unit: UNIT_LABELS[v.unit], note: PUMP_NOTE + concText(v) };
    },
    ref: PUMP_REF,
  },
  {
    id: "bp-scen", name: "血壓＋情境（降壓藥選擇用）", hidden: true,
    inputs: [
      { key: "sbp", label: "收縮壓", unit: "mmHg" }, { key: "dbp", label: "舒張壓", unit: "mmHg" },
      { key: "scen", label: "情境", unit: "", options: [
        { value: 0, label: "其他器官損傷" }, { value: 1, label: "主動脈剝離" }, { value: 2, label: "腦出血" },
        { value: 3, label: "缺血性中風（要做再灌流）" }, { value: 4, label: "缺血性中風（不做再灌流）" },
        { value: 5, label: "急性冠心症／肺水腫" }, { value: 6, label: "子癇前症／產後" },
      ] },
    ],
    formula: "依情境比對收縮壓",
    compute: v => ok(v.sbp, v.dbp, v.scen) ? { value: v.sbp, unit: "mmHg", extra: { dbp: v.dbp, scen: v.scen } } : null,
    ref: { title: "2017 ACC/AHA High Blood Pressure Guideline", url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000065" },
  },
  {
    id: "bmi", name: "BMI／理想體重",
    inputs: [
      { key: "ht", label: "身高", unit: "cm" }, { key: "wt", label: "體重", unit: "kg" },
      { key: "female", label: "性別", unit: "", options: [{ value: 0, label: "男" }, { value: 1, label: "女" }] },
    ],
    formula: "BMI = 體重 ÷ 身高(m)²；理想體重（Devine）= 50（女 45.5）+ 2.3 × (身高 inch − 60)",
    compute: v => {
      if (!ok(v.ht, v.wt) || v.ht <= 0) return null;
      const bmi = v.wt / (v.ht / 100) ** 2;
      const ibw = ok(v.female) ? (v.female ? 45.5 : 50) + 2.3 * (v.ht / 2.54 - 60) : NaN;
      return { value: round(bmi), unit: "kg/m²", note: Number.isFinite(ibw) ? `理想體重約 ${round(ibw)} kg` : undefined };
    },
    ref: { title: "MDCalc: Ideal Body Weight and Adjusted Body Weight", url: "https://www.mdcalc.com/calc/68/ideal-body-weight-adjusted-body-weight" },
  },
];
