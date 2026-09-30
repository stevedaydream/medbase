/**
 * 值班狀況卡的「用藥建議」（依情境）：依國際指引整理的文獻版，劑量照指引常用範圍，實際依醫囑。
 * 抗生素為國際指引的常見經驗性選擇，需依院內抗藥性、腎功能與過敏史調整。
 */
import type { EmMed } from "../emergency/types";
import type { HbTherapy } from "./types";

type Ref = { title: string; url: string };
const M = (name: string, dose: string, alert = false): EmMed => ({ name, dose, alert });

export const TR = {
  pain2016: { title: "Chou R, et al. Management of Postoperative Pain (APS/ASRA/ASA, J Pain 2016)", url: "https://pubmed.ncbi.nlm.nih.gov/26827847/" },
  naloxone: { title: "BJA Education: Opioid-induced respiratory depression (2024)", url: "https://www.bjaed.org/article/S2058-5349(24)00002-7/fulltext" },
  naloxoneGgc: { title: "GGC Medicines: Reversal of opioid-induced respiratory depression", url: "https://handbook.ggcmedicines.org.uk/guidelines/drug-overdose-and-toxicity/reversal-of-opioid-induced-respiratory-depression/" },
  ponv: { title: "Gan TJ, et al. Fourth Consensus Guidelines for the Management of PONV (Anesth Analg 2020)", url: "https://pubmed.ncbi.nlm.nih.gov/32467512/" },
  delirium: { title: "NICE CG103: Delirium — prevention, diagnosis and management", url: "https://www.nice.org.uk/guidance/cg103" },
  asam: { title: "ASAM Clinical Practice Guideline on Alcohol Withdrawal Management (2020)", url: "https://journals.lww.com/journaladdictionmedicine/fulltext/2020/06001/the_asam_clinical_practice_guideline_on_alcohol.1.aspx" },
  acs2025: { title: "2025 ACC/AHA/ACEP/NAEMSP/SCAI Guideline for the Management of Acute Coronary Syndromes", url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001309" },
  anaphylaxis: { title: "Resuscitation Council UK: Emergency treatment of anaphylaxis (2021)", url: "https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis" },
  gold: { title: "GOLD COPD 2024 update — clinical highlights for the hospitalist", url: "https://shmpublications.onlinelibrary.wiley.com/doi/10.1002/jhm.13416" },
  gina: { title: "GINA Pocket Guide (2023)", url: "https://ginasthma.org/wp-content/uploads/2023/07/GINA-2023-Pocket-Guide-WMS.pdf" },
  hf2022: { title: "2022 AHA/ACC/HFSA Guideline for the Management of Heart Failure", url: "https://professional.heart.org/en/science-news/-/media/832EA0F4E73948848612F228F7FA2D35.ashx" },
  ssc: { title: "Surviving Sepsis Campaign Guidelines 2026", url: "https://www.sccm.org/clinical-resources/guidelines/guidelines/surviving-sepsis-campaign-international-guidelines-for-management-of-sepsis-and-septic-shock-2026" },
  hap: { title: "IDSA/ATS 2016 Guidelines: Hospital-acquired and Ventilator-associated Pneumonia", url: "https://academic.oup.com/cid/article/63/5/e61/2237650" },
  iai: { title: "IDSA 2024 Guideline Update: Complicated Intra-abdominal Infections", url: "https://www.idsociety.org/practice-guideline/intra-abdominal-infections/" },
  cuti: { title: "IDSA 2025 Guideline Update: Complicated Urinary Tract Infections", url: "https://www.idsociety.org/practice-guideline/complicated-urinary-tract-infections/" },
  cauti: { title: "IDSA: Catheter-Associated Urinary Tract Infection in Adults", url: "https://academic.oup.com/cid/article/50/5/625/324341" },
  vanco: { title: "2020 ASHP/IDSA/PIDS/SIDP Vancomycin consensus（AUC 導向給藥）", url: "https://sidp.org/Vancomycin-Guidelines-Press-Release" },
  ich2022: { title: "2022 AHA/ASA Guideline for Spontaneous Intracerebral Hemorrhage（抗凝血逆轉）", url: "https://www.ahajournals.org/doi/10.1161/STR.0000000000000407" },
  reverse: { title: "EMCrit IBCC: Anticoagulant reversal", url: "https://emcrit.org/ibcc/reverse/" },
  aki: { title: "KDIGO: Acute Kidney Injury guideline", url: "https://kdigo.org/guidelines/acute-kidney-injury/" },
  wound: { title: "StatPearls: Postoperative Wound Infections", url: "https://www.ncbi.nlm.nih.gov/books/NBK560533/" },
  hypoNa: { title: "ESE/ESICM/ERBP Clinical practice guideline on hyponatraemia (2014)", url: "https://pubmed.ncbi.nlm.nih.gov/24569125/" },
  acg: { title: "ACG Clinical Guideline: Upper Gastrointestinal and Ulcer Bleeding (2021)", url: "https://journals.lww.com/ajg/fulltext/2021/05000/acg_clinical_guideline__upper_gastrointestinal_and.14.aspx" },
  baveno: { title: "Baveno VII — Renewing consensus in portal hypertension (J Hepatol 2022)", url: "https://www.journal-of-hepatology.eu/article/S0168-8278(21)02299-6/fulltext" },
} satisfies Record<string, Ref>;

const APAP = M("Acetaminophen（Panadol®／Scanol®）", "500–1000 mg PO／IV q6h，每天最多 4 g（肝病、酗酒、<50 kg 者 ≤2–3 g）");
const RENAL = "抗生素劑量需依腎功能調整；先抽血液培養（不延誤抗生素）；48–72 小時依培養結果降階";

/** 依值班卡 uid：用藥建議（refs 為 TR 的 key） */
export const THERAPY: Record<string, { scenario: string; meds: EmMed[]; notes?: string; refs: (keyof typeof TR)[] }[]> = {
  "hb-seed-pain": [
    { scenario: "輕度疼痛：非鴉片類為基礎（多模式止痛）", meds: [
      APAP,
      M("Ibuprofen", "400–600 mg PO q6–8h（腎功能不佳、出血風險、消化性潰瘍避免）"),
      M("Ketorolac", "15–30 mg IV q6h，≥65 歲、<50 kg、腎功能不佳用 15 mg；最多 5 天"),
      M("Celecoxib（Celebrex®）", "200 mg PO QD–BID（出血風險較低，心血管風險注意）"),
    ], notes: "排程給藥比需要時給藥效果好；可合併區域麻醉、冰敷", refs: ["pain2016"] },
    { scenario: "中重度疼痛：加上鴉片類（從低劑量開始）", meds: [
      M("Tramadol（Tramal®）", "50–100 mg PO／IV q4–6h，每天最多 400 mg（>75 歲 300 mg）；癲癇、SSRI 併用注意"),
      M("Morphine", "未用過鴉片類者 1–4 mg IV 小劑量，依疼痛與鎮靜程度調整（依醫囑）", true),
      M("Oxycodone", "5–10 mg PO q4–6h（依醫囑）", true),
    ], notes: "監測鎮靜程度與呼吸（高危險：老年人、睡眠呼吸中止、心衰竭）；同時給預防便祕藥", refs: ["pain2016"] },
    { scenario: "鴉片類過量：嗜睡、呼吸變慢", meds: [
      M("Naloxone", "0.04–0.1 mg IV 每 2 分鐘，調整到呼吸恢復即可（不要完全逆轉）；呼吸停止或心跳停止時 0.4 mg 以上", true),
    ], notes: "Naloxone 作用比多數鴉片類短，可能需要重複或持續輸注；停用鴉片類與鎮靜藥、給氧、通知醫師", refs: ["naloxone", "naloxoneGgc"] },
  ],
  "hb-seed-agitation": [
    { scenario: "譫妄或躁動危及安全（非藥物方法無效）", meds: [
      M("Haloperidol（Haldol®）", "老年人 0.5–1 mg PO／IM／IV；年輕人 1–5 mg；最低有效劑量、短期使用（通常 ≤1 週）", true),
      M("Quetiapine（Seroquel®）", "12.5–25 mg PO（帕金森氏症、路易氏體失智者用此類，避免 haloperidol）"),
    ], notes: "用藥前檢查 QTc 與電解質；避免 benzodiazepine（酒精或藥物戒斷除外）；持續找原因", refs: ["delirium"] },
    { scenario: "酒精戒斷", meds: [
      M("Lorazepam（Ativan®）", "依 CIWA-Ar 症狀給藥，1–4 mg PO／IV（肝功能不佳、老年人優先）", true),
      M("Diazepam（Valium®）", "依 CIWA-Ar 症狀給藥，10–20 mg PO／IV；重度（CIWA-Ar ≥19）可前段負荷", true),
      M("Thiamine（維生素 B1）", "100–300 mg/day，先於含糖輸液給；疑 Wernicke 腦病變 200–500 mg IV 每天 2–3 次"),
    ], notes: "依 CIWA-Ar 評分決定給藥；監測呼吸與鎮靜程度", refs: ["asam"] },
  ],
  "hb-seed-confusion": [
    { scenario: "先處理可逆原因", meds: [
      M("50% Glucose", "低血糖時 25–50 mL IV（見數值判讀「血糖」）"),
      M("Thiamine（維生素 B1）", "酒精或營養不良者：給糖前先給 100 mg IV；疑 Wernicke 200–500 mg IV"),
      M("Naloxone", "疑鴉片類過量：0.04–0.1 mg IV 調整（見「疼痛」）", true),
    ], notes: "停用或減量造成譫妄的藥物（鎮靜安眠、抗膽鹼、鴉片類）", refs: ["delirium", "asam"] },
    { scenario: "躁動危及安全", meds: [
      M("Haloperidol（Haldol®）", "老年人 0.5–1 mg，最低有效劑量、短期使用（見「躁動」）", true),
    ], refs: ["delirium"] },
  ],
  "hb-seed-chest-pain": [
    { scenario: "疑急性冠心症（沒有禁忌時）", meds: [
      M("Aspirin", "162–325 mg 嚼服（非腸溶），儘早給"),
      M("Nitroglycerin 舌下", "0.4 mg SL，每 5 分鐘可重複，最多 3 次；SBP <90、比基準下降 >30、右心室梗塞、24–48 小時內用過 PDE5 抑制劑時不可用", true),
      M("氧氣", "SpO2 <90% 才給，不常規給氧"),
    ], notes: "抗血小板（P2Y12）、抗凝血、再灌流依心臟科決定；止痛避免 NSAID", refs: ["acs2025"] },
  ],
  "hb-seed-dyspnea": [
    { scenario: "氣喘或 COPD 急性發作", meds: [
      M("Salbutamol（Ventolin®）", "定量噴霧 4–10 噴，第一小時每 20 分鐘；或 2.5–5 mg 霧化"),
      M("Ipratropium（Atrovent®）", "0.5 mg 霧化（可與 salbutamol 合用）"),
      M("Prednisolone／Prednisone", "40–50 mg PO 每天一次，共 5 天（COPD：40 mg × 5 天）"),
    ], notes: "COPD 目標 SpO2 88–92%；重度氣喘加上全身性類固醇與密切監測", refs: ["gina", "gold"] },
    { scenario: "急性肺水腫（心衰竭）", meds: [
      M("Furosemide（Lasix®）", "未用過利尿劑 20–40 mg IV；已在吃者至少等於、通常為平常口服劑量的 2 倍 IV", true),
      M("Nitroglycerin", "收縮壓足夠時，起始 5–10 mcg/min 持續輸注（見藥物速查「靜脈降壓藥」）", true),
    ], notes: "坐起、給氧、考慮非侵襲性呼吸器；監測尿量、K、腎功能", refs: ["hf2022"] },
    { scenario: "過敏性休克（喘鳴、喉頭水腫、低血壓）", meds: [
      M("Epinephrine 1 mg/mL（Bosmin®）", "0.5 mg（0.5 mL）IM 大腿前外側，5 分鐘沒改善可重複", true),
    ], notes: "移除過敏原、平躺抬腳、給氧、輸液；抗組織胺與類固醇為輔助，不能取代 epinephrine", refs: ["anaphylaxis"] },
  ],
  "hb-seed-fever": [
    { scenario: "退燒與支持", meds: [APAP], notes: "退燒藥會遮蔽病情，先完成評估與培養", refs: ["pain2016"] },
    { scenario: "疑敗血症、來源不明（住院中）", meds: [
      M("Piperacillin-tazobactam（Tazocin®）", "4.5 g IV q6h（1 小時內給）"),
      M("或 Cefepime", "2 g IV q8h"),
      M("或 Meropenem（Mepem®）", "1 g IV q8h（ESBL 風險或近期廣效抗生素使用）"),
      M("＋ Vancomycin（MRSA 風險時）", "15–20 mg/kg IV q8–12h（重症可先負荷；依 AUC 監測）", true),
    ], notes: RENAL, refs: ["ssc", "vanco"] },
    { scenario: "院內感染肺炎", meds: [
      M("Piperacillin-tazobactam", "4.5 g IV q6h；或 cefepime 2 g IV q8h；或 meropenem 1 g IV q8h"),
      M("＋ Vancomycin（MRSA 風險時）", "15–20 mg/kg IV q8–12h", true),
    ], notes: "需涵蓋 S. aureus 與綠膿桿菌；抗藥性風險高者考慮雙重抗綠膿桿菌。" + RENAL, refs: ["hap", "vanco"] },
    { scenario: "術後腹內感染（滲漏、膿瘍）", meds: [
      M("Piperacillin-tazobactam", "4.5 g IV q6h"),
      M("或 Cefepime ＋ Metronidazole", "cefepime 2 g IV q8h ＋ metronidazole 500 mg IV q8h"),
      M("或 Meropenem", "1 g IV q8h（ESBL 風險）"),
    ], notes: "來源控制（引流、手術）最重要。" + RENAL, refs: ["iai"] },
    { scenario: "導尿管相關泌尿道感染", meds: [
      M("Ceftriaxone（Rocephin®）", "1–2 g IV q24h（抗藥性風險低）"),
      M("或 Piperacillin-tazobactam／Cefepime", "抗藥性風險高或重症時"),
    ], notes: "更換或移除尿管後再留尿液培養。" + RENAL, refs: ["cuti", "cauti"] },
    { scenario: "手術部位感染", meds: [
      M("Cefazolin", "2 g IV q8h（蜂窩性組織炎範圍大時）"),
      M("或 Vancomycin", "MRSA 風險時 15–20 mg/kg IV q8–12h", true),
    ], notes: "淺層感染以打開傷口引流為主，不一定需要抗生素", refs: ["wound", "vanco"] },
  ],
  "hb-seed-oliguria": [
    { scenario: "疑低血容（排除阻塞後）", meds: [
      M("等張晶體液", "250–500 mL IV bolus，給完再評估尿量與肺部（心衰竭者小量）"),
    ], notes: "不要用利尿劑「治療」尿少；停用腎毒性藥物（NSAID、顯影劑、aminoglycoside 等）", refs: ["aki"] },
    { scenario: "容量過多（水腫、肺水腫）", meds: [
      M("Furosemide（Lasix®）", "20–40 mg IV（已在吃者用平常口服劑量的 1–2 倍）", true),
    ], notes: "K 高見數值判讀「鉀離子」", refs: ["aki", "hf2022"] },
  ],
  "hb-seed-fall": [
    { scenario: "使用抗凝血藥且有顱內出血或嚴重出血", meds: [
      M("Warfarin → 4F-PCC ＋ Vitamin K", "4F-PCC 25–50 IU/kg（依 INR）＋ vitamin K 10 mg IV", true),
      M("Dabigatran → Idarucizumab（Praxbind®）", "5 g IV", true),
      M("Xa 抑制劑（rivaroxaban、apixaban、edoxaban）", "Andexanet alfa，或 4F-PCC 50 IU/kg（依院內可用藥品）", true),
    ], notes: "只在有顱內出血或危及生命出血時逆轉；立即通知醫師", refs: ["ich2022", "reverse"] },
    { scenario: "止痛", meds: [APAP], notes: "避免加重跌倒風險的鎮靜藥", refs: ["pain2016"] },
  ],
  "hb-seed-wound": [
    { scenario: "使用抗凝血藥且活動性出血", meds: [
      M("抗凝血藥逆轉", "見「跌倒」的抗凝血逆轉（依藥物種類）", true),
    ], notes: "局部加壓止血為先；依醫囑暫停抗凝血藥、備血", refs: ["reverse"] },
    { scenario: "傷口感染", meds: [
      M("Cefazolin", "2 g IV q8h（蜂窩性組織炎）；MRSA 風險改 vancomycin"),
    ], notes: "淺層感染以引流為主", refs: ["wound"] },
  ],
  "hb-seed-drain": [
    { scenario: "疑滲漏合併感染", meds: [
      M("Piperacillin-tazobactam", "4.5 g IV q6h（或 cefepime＋metronidazole、meropenem，見「發燒」）"),
    ], notes: "來源控制優先；" + RENAL, refs: ["iai"] },
  ],
  "hb-seed-ponv": [
    { scenario: "術後噁心嘔吐：救援用藥（選和預防用藥不同類的）", meds: [
      M("Ondansetron（Zofran®）", "4 mg IV"),
      M("Droperidol", "0.625–1.25 mg IV（QT 注意）"),
      M("Haloperidol", "0.5–1 mg IV／IM（QT 注意）"),
      M("Promethazine", "6.25 mg IV（嗜睡；避免外滲）"),
      M("Metoclopramide（Primperan®）", "10 mg IV（效果較弱；腸阻塞不可用）"),
    ], notes: "同一類藥 6 小時內重複效果差；dexamethasone 4–8 mg IV 用於預防（麻醉誘導時），非救援；排除腸阻塞、低血壓、疼痛、鴉片類等原因", refs: ["ponv"] },
  ],
  "hb-seed-hyponatremia": [
    { scenario: "有中度或嚴重症狀", meds: [
      M("3% NaCl", "150 mL IV 20 分鐘，20 分鐘後測 Na（見數值判讀「鈉離子」）", true),
    ], notes: "矯正上限：第一個 24 小時 ≤10，之後每 24 小時 ≤8", refs: ["hypoNa"] },
    { scenario: "依容量狀態（無嚴重症狀）", meds: [
      M("低血容：0.9% NaCl", "依醫囑補液，密切追蹤 Na（可能快速上升）"),
      M("SIADH（正常容量）：限水", "依醫囑限制水分（常見 <800–1000 mL/day）"),
      M("高血容（心衰竭、肝硬化）：限水＋利尿劑", "Furosemide 依醫囑"),
    ], notes: "停用低張輸液與造成低血鈉的藥物", refs: ["hypoNa"] },
  ],
  "hb-seed-gi-bleeding": [
    { scenario: "非靜脈瘤出血", meds: [
      M("Erythromycin", "250 mg IV，內視鏡前給予（幫助胃排空）"),
      M("PPI（Pantoprazole、Esomeprazole 等）", "內視鏡止血後高劑量連續 3 天：例如 80 mg IV bolus 後 8 mg/h（依醫囑）"),
    ], notes: "限制性輸血 Hb <7；抗凝血藥依醫囑暫停或逆轉（見「跌倒」）", refs: ["acg"] },
    { scenario: "疑靜脈瘤出血", meds: [
      M("Octreotide（Sandostatin®）", "50 mcg IV bolus，接著 50 mcg/h，持續 2–5 天"),
      M("Ceftriaxone（Rocephin®）", "1 g IV q24h，最多 7 天"),
    ], notes: "12 小時內內視鏡；Hb 目標 7–8，避免輸液過量", refs: ["baveno"] },
  ],
  "hb-seed-hypotension": [
    { scenario: "低灌流：先補液", meds: [
      M("等張晶體液", "500 mL IV bolus 後再評估（心衰竭者 250 mL）；敗血症 30 mL/kg 於 3 小時內"),
    ], notes: "補液後 MAP 仍 <65 見數值判讀「升壓藥調整」；出血時備血", refs: ["ssc"] },
    { scenario: "過敏性休克", meds: [
      M("Epinephrine 1 mg/mL（Bosmin®）", "0.5 mg IM 大腿前外側，5 分鐘沒改善可重複", true),
    ], refs: ["anaphylaxis"] },
  ],
  "hb-seed-hypertension": [
    { scenario: "無器官損傷", meds: [
      M("恢復平常口服降壓藥", "見藥物速查「口服降壓藥」；先處理疼痛、尿滯留"),
    ], notes: "避免靜脈降壓藥與舌下速效 nifedipine", refs: [] },
    { scenario: "有器官損傷（高血壓急症）", meds: [
      M("依情境選藥", "見數值判讀「降壓藥選擇」（點選情境）", true),
    ], refs: [] },
  ],
};

/** 手冊條目要附的參考文獻（去重後依序） */
export function therapyFor(uid: string, refs: Ref[]): { therapy: HbTherapy[]; refs: Ref[] } | null {
  const list = THERAPY[uid];
  if (!list) return null;
  const all = [...refs];
  const idx = (r: Ref) => { const i = all.findIndex(x => x.url === r.url); if (i >= 0) return i; all.push(r); return all.length - 1; };
  const therapy = list.map((t, i) => ({ id: `t${i + 1}`, scenario: t.scenario, meds: t.meds, notes: t.notes ?? "", refs: t.refs.map(k => idx(TR[k])) }));
  return { therapy, refs: all };
}
