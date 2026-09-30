/**
 * 常用公式（ADR-018）：只做公式計算，不換算藥物劑量。桌機與手機共用。
 */
export interface FormulaInput { key: string; label: string; unit: string; options?: { value: number; label: string }[] }

export interface Formula {
  id: string;
  name: string;
  inputs: FormulaInput[];
  formula: string;
  /** 缺值或不合理時回傳 null */
  compute: (v: Record<string, number>) => { value: number; unit: string; note?: string } | null;
  normal?: string;
  ref: { title: string; url: string };
}

const ok = (...xs: (number | undefined)[]) => xs.every(x => x !== undefined && Number.isFinite(x));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export const FORMULAS: Formula[] = [
  {
    id: "map", name: "平均動脈壓 MAP",
    inputs: [{ key: "sbp", label: "收縮壓", unit: "mmHg" }, { key: "dbp", label: "舒張壓", unit: "mmHg" }],
    formula: "(收縮壓 + 2 × 舒張壓) ÷ 3",
    compute: v => ok(v.sbp, v.dbp) && v.sbp >= v.dbp ? { value: round((v.sbp + 2 * v.dbp) / 3, 0), unit: "mmHg" } : null,
    normal: "一般目標 ≥ 65 mmHg",
    ref: { title: "MDCalc: Mean Arterial Pressure (MAP)", url: "https://www.mdcalc.com/calc/74/mean-arterial-pressure-map" },
  },
  {
    id: "ca", name: "校正鈣（低白蛋白）",
    inputs: [{ key: "ca", label: "血鈣", unit: "mg/dL" }, { key: "alb", label: "白蛋白", unit: "g/dL" }],
    formula: "血鈣 + 0.8 × (4 − 白蛋白)",
    compute: v => ok(v.ca, v.alb) && v.alb > 0 ? { value: round(v.ca + 0.8 * (4 - v.alb)), unit: "mg/dL" } : null,
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
