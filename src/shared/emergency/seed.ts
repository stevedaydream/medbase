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

/** uid 固定：多台電腦各自遷移時，雲端同步以 uid 合併，不會重複 */
export const SEED_CARDS: { uid: string; name: string; spec: EmSpec }[] = [
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
      measure: { label: "平均動脈壓 MAP", unit: "mmHg", step: 1 },
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

/** 舊版示範卡（已移除，遷移時刪除） */
export const DEMO_NAMES = ["Anaphylaxis", "ACLS — VF / pVT"];
