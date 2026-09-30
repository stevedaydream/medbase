/**
 * 首批危急處置卡：依國際文獻整理的「文獻版」（ADR-017），尚未經院內審核。
 * 劑量照文獻原文，院內規範不同處（例如 sliding scale）待院內填入後改為院內審核版。
 */
import type { EmSpec, EmTier, EmMed } from "./types";

const T = (id: string, min: number | null, max: number | null, when: Record<string, boolean>, title: string,
  actions: string[], meds: EmMed[] = [], rechecks: EmTier["rechecks"] = [], notes = "", refs?: number[]): EmTier =>
  ({ id, min, max, when, title, actions, meds, rechecks, notes, ...(refs ? { refs } : {}) });

const LIT = "國際文獻整理（見參考文獻），尚未經院內審核";
const base = (x: Partial<EmSpec>): EmSpec => ({
  kind: "graded", category: "其他", keywords: [], measure: null, conditions: [], tiers: [],
  general: { actions: [], meds: [], rechecks: [] }, contacts: [], source: LIT, refs: [],
  reviewer: "", effective: "", status: "literature", notes: "", ...x,
});

const ADA_HOSP = { title: "ADA Standards of Care in Diabetes—2026, 16. Diabetes Care in the Hospital", url: "https://diabetesjournals.org/care/article/49/Supplement_1/S339/163925/16-Diabetes-Care-in-the-Hospital-Standards-of-Care" };
const ADA_HYPO = { title: "ADA Standards of Care in Diabetes—2026, 6. Glycemic Goals, Hypoglycemia, and Hyperglycemic Crises", url: "https://diabetesjournals.org/care/article/49/Supplement_1/S132/163927/6-Glycemic-Goals-Hypoglycemia-and-Hyperglycemic" };
const DKA_2024 = { title: "Hyperglycemic Crises in Adults With Diabetes: A Consensus Report (Diabetes Care 2024)", url: "https://diabetesjournals.org/care/article/47/8/1257/156808/Hyperglycemic-Crises-in-Adults-With-Diabetes-A" };
const UKKA = { title: "UK Kidney Association: Clinical Practice Guideline — Treatment of Acute Hyperkalaemia in Adults (2023)", url: "https://www.ukkidney.org/sites/default/files/FINAL%20VERSION%20-%20UKKA%20CLINICAL%20PRACTICE%20GUIDELINE%20-%20MANAGEMENT%20OF%20HYPERKALAEMIA%20IN%20ADULTS%20-%20191223_0.pdf" };
const IBCC_K = { title: "EMCrit IBCC: Hypokalemia", url: "https://emcrit.org/ibcc/hypokalemia/" };
const RCHT_K = { title: "Royal Cornwall Hospitals: Management of Hypokalaemia in Adults v4.0 (2025)", url: "https://doclibrary-rcht.cornwall.nhs.uk/DocumentsLibrary/RoyalCornwallHospitalsTrust/Clinical/Pharmacy/ManagementOfHypokalaemiaInAdultsClinicalGuideline.pdf" };
const SSC = { title: "Surviving Sepsis Campaign: International Guidelines for Management of Sepsis and Septic Shock 2026", url: "https://www.sccm.org/clinical-resources/guidelines/guidelines/surviving-sepsis-campaign-international-guidelines-for-management-of-sepsis-and-septic-shock-2026" };
const BTS = { title: "BTS Guideline for oxygen use in adults in healthcare and emergency settings (2017)", url: "https://www.brit-thoracic.org.uk/clinical-resources/guidelines/emergency-oxygen/" };

const INSULIN_SCALE: EmMed = { name: "短效胰島素（Actrapid／RI）", dose: "依院內 sliding scale（劑量待院內填入）", alert: true };

type Seed = { uid: string; name: string; spec: EmSpec };

/** 第 1 批 */
const SEED_V1: Seed[] = [
  {
    uid: "em-seed-glucose-high",
    name: "血糖高",
    spec: base({
      category: "血糖", keywords: ["高血糖", "hyperglycemia", "DKA", "HHS", "胰島素", "sugar"],
      measure: { label: "血糖", unit: "mg/dL", step: 1 },
      conditions: [{ id: "crisis", question: "有 DKA／HHS 表現？（酮體陽性、酸中毒、脫水、意識改變）" }],
      tiers: [
        T("h1", 181, 250, {}, "高血糖", [
          "通知醫師",
          "確認進食狀況與相關用藥（類固醇、TPN、管灌）",
          "依院內矯正胰島素方案給予",
          "依醫囑追蹤血糖",
        ], [INSULIN_SCALE], [], "住院病人一般目標 140–180 mg/dL；文獻不建議只靠 sliding scale 長期控制", [0]),
        T("h2", 251, 599, {}, "明顯高血糖", [
          "通知醫師",
          "檢查血酮或尿酮、電解質（K）、BUN／Cr",
          "評估 DKA／HHS 表現（若有，勾選上方是非題）",
          "依院內矯正胰島素方案給予",
        ], [INSULIN_SCALE], [], "", [0, 1]),
        T("h3", 600, null, {}, "血糖 ≥600：疑似 HHS", [
          "立即通知醫師",
          "檢查血漿滲透壓、電解質、BUN／Cr、血酮、血液氣體",
          "建立靜脈通路",
          "依下方 DKA／HHS 處置準備",
        ], [], [], "", [1]),
        T("c1", 250, null, { crisis: true }, "DKA／HHS 處置（2024 國際共識）", [
          "立即通知醫師，建立靜脈通路",
          "依醫囑快速補充等張晶體液",
          "開始胰島素前先測 K：K <3.5 先補 K、暫緩胰島素",
          "K 3.5–5.0：胰島素與補 K 同時進行；K >5.0：暫不補 K、密切追蹤",
          "血糖降到 <250 時加入含葡萄糖輸液，胰島素繼續",
        ], [
          { name: "Regular insulin IV 持續輸注", dose: "0.1 U/kg/h（K ≥3.5 才開始；依醫囑）", alert: true },
          { name: "KCl（加入輸液）", dose: "依 K 值與醫囑", alert: true },
        ], [{ label: "重測血糖", minutes: 60 }, { label: "重測 K／電解質", minutes: 120 }], "", [1]),
      ],
      refs: [ADA_HOSP, DKA_2024],
    }),
  },
  {
    uid: "em-seed-glucose-low",
    name: "血糖低",
    spec: base({
      category: "血糖", keywords: ["低血糖", "hypoglycemia", "D50", "glucagon", "sugar"],
      measure: { label: "血糖", unit: "mg/dL", step: 1 },
      conditions: [{ id: "oral", question: "意識清楚、可由口進食？" }],
      tiers: [
        T("o1", null, 69, { oral: true }, "可口服：給速效醣類", [
          "給 15–20 g 速效醣類（果汁、葡萄糖錠等）",
          "15 分鐘後重測；未達 100 mg/dL 重複處理",
          "回升後給含醣點心或正餐",
          "查原因（胰島素、降血糖藥、進食減少）並通知醫師",
        ], [], [{ label: "重測血糖", minutes: 15 }]),
        T("o2", null, 69, { oral: false }, "無法口服或意識改變", [
          "確認或建立靜脈通路",
          "側躺、保護呼吸道",
          "給 50% 葡萄糖 IV；沒有 IV 時給 glucagon",
          "15 分鐘後重測；未達 100 mg/dL 重複處理",
          "通知醫師",
        ], [
          { name: "50% Glucose", dose: "25–50 mL IV（12.5–25 g）", alert: false },
          { name: "Glucagon", dose: "1 mg IM／SC（無 IV 時）", alert: false },
        ], [{ label: "重測血糖", minutes: 15 }]),
        T("l2", null, 53, {}, "Level 2 低血糖（<54）", [
          "屬臨床顯著低血糖，通知醫師",
          "檢討胰島素與降血糖藥物劑量",
        ]),
      ],
      notes: "ADA：Level 1 <70 且 ≥54；Level 2 <54；Level 3 為需他人協助的嚴重事件",
      refs: [ADA_HYPO, ADA_HOSP],
    }),
  },
  {
    uid: "em-seed-k-high",
    name: "鉀離子高",
    spec: base({
      category: "電解質", keywords: ["高血鉀", "hyperkalemia", "K", "potassium", "calcium gluconate"],
      measure: { label: "K", unit: "mEq/L", step: 0.1 },
      conditions: [
        { id: "ecg", question: "ECG 有高血鉀變化？（T 波高尖、QRS 變寬、心律不整）" },
        { id: "lowbg", question: "治療前血糖 <126 mg/dL（7 mmol/L）？" },
      ],
      tiers: [
        T("k1", 5.5, 5.9, {}, "輕度（5.5–5.9）", [
          "重抽確認（排除溶血）",
          "停用含鉀輸液與升鉀藥物",
          "做 12 導程 ECG，通知醫師",
        ]),
        T("k2", 6.0, 6.4, {}, "中度（6.0–6.4）", [
          "12 導程 ECG、心電監測",
          "通知醫師；文獻建議可給 insulin-glucose",
          "停用含鉀輸液與升鉀藥物",
          "給藥後頻繁監測血糖",
        ], [
          { name: "Regular insulin + 50% glucose", dose: "RI 10 U + 50% glucose 50 mL（25 g）IV，15 分鐘內", alert: true },
        ], [{ label: "重測血糖", minutes: 15 }, { label: "重測 K", minutes: 60 }]),
        T("k3", 6.5, null, {}, "重度（≥6.5）", [
          "立即通知醫師，心電監測",
          "給 insulin-glucose（文獻建議）",
          "可合併 salbutamol 霧化",
          "評估透析需求、會診腎臟科",
          "給藥後頻繁監測血糖（至少 6 小時）",
        ], [
          { name: "Regular insulin + 50% glucose", dose: "RI 10 U + 50% glucose 50 mL（25 g）IV，15 分鐘內", alert: true },
          { name: "Salbutamol", dose: "10–20 mg 霧化（輔助）" },
        ], [{ label: "重測血糖", minutes: 15 }, { label: "重測 K", minutes: 60 }]),
        T("e1", 5.5, null, { ecg: true }, "ECG 變化：先穩定心肌", [
          "立即給鈣劑（不降 K，保護心肌）",
          "持續心電監測；5–10 分鐘後 ECG 未改善可依醫囑重複",
        ], [
          { name: "10% Calcium gluconate", dose: "30 mL IV，10 分鐘以上", alert: true },
        ]),
        T("g1", 6.0, null, { lowbg: true }, "治療前血糖偏低：預防低血糖", [
          "insulin-glucose 後接續葡萄糖輸注",
          "加強血糖監測",
        ], [
          { name: "10% Glucose", dose: "50 mL/h IV × 5 小時", alert: false },
        ]),
      ],
      refs: [UKKA],
    }),
  },
  {
    uid: "em-seed-k-low",
    name: "鉀離子低",
    spec: base({
      category: "電解質", keywords: ["低血鉀", "hypokalemia", "K", "potassium", "KCl"],
      measure: { label: "K", unit: "mEq/L", step: 0.1 },
      conditions: [{ id: "sym", question: "有心律不整、ECG 變化或肌無力等症狀？" }],
      tiers: [
        T("l1", 3.0, 3.4, {}, "輕度（3.0–3.4）", [
          "可口服者優先口服補充（依醫囑）",
          "查原因（利尿劑、嘔吐、腹瀉）",
          "檢查 Mg",
        ]),
        T("l2", 2.5, 2.9, {}, "中度（2.5–2.9）", [
          "通知醫師",
          "口服或 IV 補充（依醫囑）",
          "心電監測；檢查並補充 Mg",
        ], [
          { name: "KCl IV", dose: "周邊靜脈 ≤10 mEq/h；禁止 IV push", alert: true },
        ]),
        T("l3", null, 2.4, {}, "重度（<2.5）", [
          "立即通知醫師",
          "IV 補充，心電監測",
          "檢查並補充 Mg（低 Mg 時 K 不易補上來）",
        ], [
          { name: "KCl IV", dose: "周邊靜脈 ≤10 mEq/h；中心靜脈（心電監測下）≤20 mEq/h；禁止 IV push", alert: true },
        ]),
        T("s1", null, 3.4, { sym: true }, "有症狀或 ECG 變化", [
          "立即通知醫師",
          "心電監測，IV 補充",
        ]),
      ],
      notes: "補充後依醫囑時間重測 K",
      refs: [IBCC_K, RCHT_K],
    }),
  },
  {
    uid: "em-seed-hypotension",
    name: "血壓低",
    spec: base({
      category: "循環", keywords: ["低血壓", "hypotension", "休克", "shock", "敗血症", "sepsis", "MAP"],
      measure: { label: "平均動脈壓 MAP", unit: "mmHg", step: 1, formula: "map" },
      conditions: [{ id: "sepsis", question: "疑似感染或敗血症？" }],
      tiers: [
        T("p1", null, 64, {}, "低血壓（MAP <65）", [
          "通知醫師",
          "評估意識、尿量、末梢灌流、心律",
          "查原因：出血、心因性、過敏、藥物、敗血症",
          "建立靜脈通路，依醫囑輸液",
        ]),
        T("s1", null, 64, { sepsis: true }, "敗血症低灌流／休克（SSC 2026）", [
          "抽血液培養（不延誤抗生素）、測 lactate",
          "1 小時內給廣效抗生素",
          "3 小時內給等張晶體液至少 30 mL/kg，邊給邊再評估（肥胖用理想或校正體重）",
          "補液後 MAP 仍 <65：norepinephrine 為首選升壓劑",
          "MAP 目標 65 mmHg（≥65 歲可 60–65）",
        ], [
          { name: "等張晶體液", dose: "≥30 mL/kg IV（3 小時內，頻繁再評估）" },
          { name: "Norepinephrine", dose: "持續輸注，依醫囑調整至 MAP 目標", alert: true },
        ], [{ label: "再評估血壓與灌流", minutes: 15 }]),
      ],
      notes: "MAP ≈（收縮壓 + 2 × 舒張壓）÷ 3",
      refs: [SSC],
    }),
  },
  {
    uid: "em-seed-hypoxemia",
    name: "血氧低",
    spec: base({
      category: "呼吸", keywords: ["低血氧", "SpO2", "喘", "呼吸窘迫", "hypoxemia", "oxygen", "氧氣"],
      measure: { label: "SpO2", unit: "%", step: 1 },
      conditions: [{ id: "co2", question: "有高碳酸血症呼吸衰竭風險？（COPD、肥胖通氣不足、神經肌肉疾病等）" }],
      tiers: [
        T("a1", null, 84, { co2: false }, "嚴重低血氧（<85%）", [
          "Reservoir mask 15 L/min",
          "通知醫師，必要時啟動急救小組",
          "評估呼吸道與呼吸型態",
          "達目標 94–98% 後逐步調降",
        ], [], [{ label: "重新評估 SpO2", minutes: 5 }]),
        T("a2", 85, 93, { co2: false }, "低血氧（85–93%）", [
          "鼻導管 2–6 L/min 或簡易面罩 5–10 L/min",
          "目標 SpO2 94–98%",
          "通知醫師，找原因",
        ], [], [{ label: "重新評估 SpO2", minutes: 5 }]),
        T("b1", null, 87, { co2: true }, "高碳酸風險：低於目標（<88%）", [
          "24% Venturi 2–3 L/min 或 28% Venturi 4 L/min（或鼻導管 1–2 L/min）",
          "目標 SpO2 88–92%",
          "30–60 分鐘內抽動脈血液氣體",
          "通知醫師",
        ], [], [{ label: "抽 ABG", minutes: 60 }]),
        T("b3", 88, 92, { co2: true }, "高碳酸風險：在目標範圍（88–92%）", [
          "維持目前氧氣，持續監測",
          "依血液氣體結果調整",
        ]),
        T("b2", 93, 100, { co2: true }, "高碳酸風險：高於目標（>92%）", [
          "正在給氧者調降氧氣，避免 CO2 滯留",
          "目標 SpO2 88–92%",
        ]),
      ],
      notes: "危急狀態（休克、心跳停止、重大創傷）不論風險，一律先 reservoir mask 15 L/min",
      refs: [BTS],
    }),
  },
];

const ESE_NA = { title: "ESE/ESICM/ERBP Clinical practice guideline on diagnosis and treatment of hyponatraemia (2014)", url: "https://pubmed.ncbi.nlm.nih.gov/24569125/" };
const UCSF_NA = { title: "UCSF Hospital Handbook: Hypernatremia", url: "https://hospitalhandbook.ucsf.edu/content/04-hypernatremia" };
const NA_RATE = { title: "Hypernatremia and Its Rate of Correction: The Evidence So Far (review)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10961935/" };
const SFE_HICA = { title: "Society for Endocrinology Emergency Guidance: acute hypercalcaemia in adults", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5314807/" };
const SFE_LOCA = { title: "Society for Endocrinology Emergency Guidance: acute hypocalcaemia in adults", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8117371/" };
const AHA_BP = { title: "AHA Scientific Statement: Management of Elevated Blood Pressure in the Acute Care Setting (2024)", url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000238" };
const ACC_AHA_2017 = { title: "2017 ACC/AHA Guideline for High Blood Pressure in Adults", url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000065" };

const CORR_CA = { label: "校正鈣", unit: "mg/dL", step: 0.1, formula: "ca" };

/** 第 2 批：鈉、鈣、血壓 */
const SEED_V2: Seed[] = [
  {
    uid: "em-seed-na-low", name: "鈉離子低",
    spec: base({
      category: "電解質", keywords: ["低血鈉", "hyponatremia", "Na", "sodium", "3% NaCl"],
      measure: { label: "Na", unit: "mEq/L", step: 1 },
      conditions: [
        { id: "severe", question: "有嚴重症狀？（嘔吐、抽搐、意識明顯改變、GCS ≤8、心肺抑制）" },
        { id: "moderate", question: "有中度症狀？（噁心、混亂、頭痛）" },
      ],
      tiers: [
        T("n1", 130, 134, {}, "輕度（130–134）", [
          "評估容量狀態（脫水、正常、水腫）",
          "查原因：藥物（利尿劑、SSRI 等）、低張輸液、SIADH、嘔吐",
          "停用低張輸液，依醫囑追蹤 Na",
        ]),
        T("n2", 125, 129, {}, "中度（125–129）", [
          "通知醫師",
          "送 serum osmolality、urine osmolality、urine Na",
          "評估容量狀態並找原因",
        ]),
        T("n3", null, 124, {}, "重度（<125）", [
          "立即通知醫師",
          "密切追蹤 Na 與神經學狀態",
          "矯正不可過快：第一個 24 小時上升 ≤10，之後每 24 小時 ≤8",
        ], [], [{ label: "重測 Na", minutes: 240 }]),
        T("s1", null, 134, { severe: true }, "嚴重症狀：高張食鹽水", [
          "立即通知醫師，監測生命徵象",
          "3% NaCl 150 mL IV 20 分鐘；20 分鐘後測 Na",
          "可重複，直到 Na 上升 5 或症狀改善",
          "達到後停止高張食鹽水、找原因；矯正上限同上",
        ], [
          { name: "3% NaCl", dose: "150 mL IV，20 分鐘（依醫囑）", alert: true },
        ], [{ label: "重測 Na", minutes: 20 }]),
        T("m1", null, 134, { severe: false, moderate: true }, "中度症狀", [
          "通知醫師",
          "可單次給 3% NaCl 150 mL IV 20 分鐘（依醫囑），目標 24 小時上升 5",
          "停用造成低血鈉的藥物與低張輸液",
        ], [
          { name: "3% NaCl", dose: "150 mL IV，20 分鐘，單次（依醫囑）", alert: true },
        ], [{ label: "重測 Na", minutes: 240 }]),
      ],
      notes: "矯正過快有滲透壓性脫髓鞘（ODS）風險，酒精、營養不良、低血鉀者更要小心",
      refs: [ESE_NA],
    }),
  },
  {
    uid: "em-seed-na-high", name: "鈉離子高",
    spec: base({
      category: "電解質", keywords: ["高血鈉", "hypernatremia", "Na", "sodium", "脫水", "自由水"],
      measure: { label: "Na", unit: "mEq/L", step: 1 },
      conditions: [{ id: "cns", question: "有意識改變、抽搐等神經學症狀？" }],
      tiers: [
        T("h1", 146, 149, {}, "輕度（146–149）", [
          "評估容量與攝水能力（口渴、進食、意識）",
          "查原因：不感性流失、腹瀉、利尿、尿崩、高張輸液",
          "可口服者鼓勵補水；依醫囑追蹤 Na",
        ]),
        T("h2", 150, 159, {}, "中度（150–159）", [
          "通知醫師",
          "計算自由水缺乏量（工作手冊公式），依醫囑給低張輸液或管灌水",
          "慢性（>48 小時）矯正速度每 24 小時 ≤10",
        ], [], [{ label: "重測 Na", minutes: 240 }]),
        T("h3", 160, null, {}, "重度（≥160）", [
          "立即通知醫師",
          "評估容量；休克者先處理低灌流",
          "依醫囑補充自由水，密切追蹤 Na",
        ], [], [{ label: "重測 Na", minutes: 120 }]),
        T("c1", 150, null, { cns: true }, "有神經學症狀", [
          "立即通知醫師，保護呼吸道",
          "急性（<48 小時）可較快矯正；依醫囑密切追蹤",
        ]),
      ],
      notes: "自由水缺乏量 ≈ 體液比例 × 體重 × (Na ÷ 140 − 1)",
      refs: [UCSF_NA, NA_RATE],
    }),
  },
  {
    uid: "em-seed-ca-high", name: "鈣離子高",
    spec: base({
      category: "電解質", keywords: ["高血鈣", "hypercalcemia", "Ca", "calcium"],
      measure: CORR_CA,
      conditions: [{ id: "sym", question: "有症狀或 ECG 變化？（意識改變、嘔吐、脫水、心律不整、QT 縮短）" }],
      tiers: [
        T("c1", 10.6, 11.9, {}, "輕度（<12）", [
          "查原因（副甲狀腺、惡性腫瘤、thiazide、鈣片、維生素 D）",
          "停用含鈣與升鈣藥物，鼓勵補水",
          "依醫囑追蹤",
        ]),
        T("c2", 12.0, 13.9, {}, "中度（12–13.9）", [
          "通知醫師",
          "評估脫水；依醫囑 0.9% NaCl 補液（注意心肺功能）",
          "檢查腎功能、PTH、Mg、P",
        ], [], [{ label: "重測 Ca", minutes: 360 }]),
        T("c3", 14.0, null, {}, "重度（≥14）", [
          "立即通知醫師，心電監測",
          "0.9% NaCl 積極補液（常見先 1–2 L，再依水分狀態與心肺功能調整）",
          "補足水分後依醫囑給 bisphosphonate；calcitonin 可短期併用",
          "腎衰竭或心衰竭無法補液者評估透析",
        ], [
          { name: "0.9% NaCl", dose: "依醫囑補液，監測尿量與心肺" },
          { name: "Zoledronic acid", dose: "4 mg IV ≥15 分鐘（依腎功能調整，依醫囑）", alert: true },
          { name: "Calcitonin", dose: "依醫囑；療效短，限 48–72 小時" },
        ], [{ label: "重測 Ca／腎功能", minutes: 360 }]),
        T("s1", 10.6, null, { sym: true }, "有症狀或 ECG 變化", [
          "立即通知醫師，心電監測",
          "依重度流程處理",
        ]),
      ],
      notes: "數值用校正鈣（依白蛋白）；有游離鈣時以游離鈣為準",
      refs: [SFE_HICA],
    }),
  },
  {
    uid: "em-seed-ca-low", name: "鈣離子低",
    spec: base({
      category: "電解質", keywords: ["低血鈣", "hypocalcemia", "Ca", "calcium", "tetany", "抽搐"],
      measure: CORR_CA,
      conditions: [{ id: "sym", question: "有症狀或 ECG 變化？（手腳麻、抽筋、tetany、喉痙攣、抽搐、QT 延長）" }],
      tiers: [
        T("l1", 7.6, 8.4, {}, "輕度（7.6–8.4）", [
          "確認白蛋白、Mg、P、腎功能、PTH、維生素 D",
          "可口服者依醫囑口服鈣片與維生素 D",
          "低 Mg 要一起補",
        ]),
        T("l2", null, 7.5, {}, "重度（<7.6）", [
          "立即通知醫師，心電監測",
          "依醫囑靜脈補鈣",
          "檢查並補充 Mg",
        ], [
          { name: "10% Calcium gluconate", dose: "10–20 mL 加入 50–100 mL D5W，IV 10 分鐘，心電監測下", alert: true },
          { name: "Calcium gluconate 持續輸注", dose: "10% 100 mL 稀釋於 1 L NS 或 D5W，50–100 mL/h（依醫囑調整）", alert: true },
        ], [{ label: "重測 Ca", minutes: 240 }]),
        T("s1", null, 8.4, { sym: true }, "有症狀或 ECG 變化：先靜脈補鈣", [
          "立即通知醫師，心電監測",
          "10% calcium gluconate IV 10 分鐘，症狀未緩解可重複",
          "接續持續輸注，檢查並補充 Mg",
        ], [
          { name: "10% Calcium gluconate", dose: "10–20 mL 加入 50–100 mL D5W，IV 10 分鐘", alert: true },
        ], [{ label: "重測 Ca", minutes: 240 }]),
      ],
      notes: "數值用校正鈣；甲狀腺或副甲狀腺術後要特別注意。Calcium chloride 刺激性強，只能走中心靜脈",
      refs: [SFE_LOCA],
    }),
  },
  {
    uid: "em-seed-bp-high", name: "血壓高",
    spec: base({
      category: "循環", keywords: ["高血壓", "hypertension", "血壓高", "SBP", "高血壓急症"],
      measure: { label: "收縮壓", unit: "mmHg", step: 1 },
      conditions: [{ id: "organ", question: "有急性器官損傷表現？（胸痛、喘、神經學症狀、視力改變、急性腎損傷、懷疑主動脈剝離）" }],
      tiers: [
        T("b1", 130, 179, {}, "血壓偏高", [
          "正確測量：合適袖帶、休息 5 分鐘後重測",
          "找可逆原因：疼痛、焦慮、尿滯留、缺氧、停用平常降壓藥、戒斷",
          "處理原因即可，不需緊急降壓",
        ]),
        T("b2", 180, null, { organ: false }, "明顯升高、無器官損傷（≥180/110）", [
          "重測並找可逆原因（同上）",
          "恢復或調整平常口服降壓藥（依醫囑）",
          "避免靜脈降壓藥與快速降壓",
          "通知醫師",
        ], [], [{ label: "重測血壓", minutes: 60 }]),
        T("e1", 180, null, { organ: true }, "高血壓急症", [
          "立即通知醫師，心電監測",
          "依受損器官（中風、急性冠心症、主動脈剝離、肺水腫、子癇前症）決定藥物與目標",
          "一般第一小時降低 ≤25%（主動脈剝離等例外，依醫囑）",
        ], [
          { name: "靜脈降壓藥", dose: "依醫囑選藥與速度", alert: true },
        ], [{ label: "重測血壓", minutes: 15 }]),
      ],
      notes: "舒張壓 ≥110 也屬明顯升高；AHA 2024 建議不再使用「高血壓緊急狀況（urgency）」一詞",
      refs: [AHA_BP, ACC_AHA_2017],
    }),
  },
];

/** uid 固定：多台電腦各自加入時，雲端同步以 uid 合併，不會重複；since＝第幾批加入 */
export const SEED_VERSION = 2;
export const SEED_CARDS: (Seed & { since: number })[] = [
  ...SEED_V1.map(c => ({ ...c, since: 1 })),
  ...SEED_V2.map(c => ({ ...c, since: 2 })),
];

/** 舊版示範卡（已移除，遷移時刪除） */
export const DEMO_NAMES = ["Anaphylaxis", "ACLS — VF / pVT"];
