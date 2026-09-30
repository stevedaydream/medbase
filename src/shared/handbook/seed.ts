/**
 * 隨身工作手冊首批內容（ADR-018）：依國際指引與教科書整理的「文獻版」，尚未經院內審核。
 * 不照抄任何醫院的手冊；院內規定（行政流程）只建架子待填。uid 固定，多台電腦遷移時以 uid 合併。
 */
import type { HbSpec, HbBlock } from "./types";

type Ref = { title: string; url: string };
const R = {
  geeky: { title: "Geeky Medics: The Medical On-Call Shift", url: "https://geekymedics.com/the-medical-on-call-shift/" },
  postopFever: { title: "StatPearls: Postoperative Fever", url: "https://www.ncbi.nlm.nih.gov/books/NBK482299/" },
  sepsisNice: { title: "NICE NG51: Suspected sepsis — recognition, diagnosis and early management", url: "https://www.nice.org.uk/guidance/ng51" },
  ssc: { title: "Surviving Sepsis Campaign Guidelines 2026", url: "https://www.sccm.org/clinical-resources/guidelines/guidelines/surviving-sepsis-campaign-international-guidelines-for-management-of-sepsis-and-septic-shock-2026" },
  chest: { title: "2021 AHA/ACC Guideline for the Evaluation and Diagnosis of Chest Pain", url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001029" },
  bts: { title: "BTS Guideline for oxygen use in adults in healthcare and emergency settings", url: "https://www.brit-thoracic.org.uk/clinical-resources/guidelines/emergency-oxygen/" },
  delirium: { title: "NICE CG103: Delirium — prevention, diagnosis and management", url: "https://www.nice.org.uk/guidance/cg103" },
  deliriumSp: { title: "StatPearls: Delirium", url: "https://www.ncbi.nlm.nih.gov/books/NBK470399/" },
  falls: { title: "NICE NG249: Falls — assessment and prevention (2025)", url: "https://www.nice.org.uk/guidance/ng249" },
  head: { title: "NICE NG232: Head injury — assessment and early management", url: "https://www.nice.org.uk/guidance/ng232" },
  pain: { title: "Chou R, et al. Management of Postoperative Pain (J Pain 2016; APS/ASRA/ASA)", url: "https://pubmed.ncbi.nlm.nih.gov/26827847/" },
  aki: { title: "KDIGO: Acute Kidney Injury guideline", url: "https://kdigo.org/guidelines/acute-kidney-injury/" },
  oliguria: { title: "StatPearls: Oliguria", url: "https://www.ncbi.nlm.nih.gov/books/NBK560738/" },
  retention: { title: "StatPearls: Postoperative Urinary Retention", url: "https://www.ncbi.nlm.nih.gov/books/NBK549844/" },
  wound: { title: "StatPearls: Postoperative Wound Infections", url: "https://www.ncbi.nlm.nih.gov/books/NBK560533/" },
  drains: { title: "StatPearls: Suction Drains", url: "https://www.ncbi.nlm.nih.gov/books/NBK557687/" },
  whoSsi: { title: "WHO: Global guidelines for the prevention of surgical site infection", url: "https://www.who.int/publications/i/item/9789241550475" },
  cdcSsi: { title: "CDC Guideline for the Prevention of Surgical Site Infection, 2017 (JAMA Surg)", url: "https://jamanetwork.com/journals/jamasurgery/fullarticle/2623725" },
  eras: { title: "ERAS Society Guidelines", url: "https://erassociety.org/guidelines/" },
  aggression: { title: "NICE NG10: Violence and aggression — short-term management", url: "https://www.nice.org.uk/guidance/ng10" },
} satisfies Record<string, Ref>;

const LIT = "國際指引與教科書整理（見參考文獻），尚未經院內審核";
const oncall = (category: string, keywords: string[], b: string[][], refs: Ref[], emergency: string[] = [], notes = ""): HbSpec => ({
  section: "oncall", category, keywords,
  blocks: ["電話中先問", "到床邊看", "不能漏掉的危險原因", "初步檢查", "初步處置", "何時通知上級"].map((title, i) => ({ title, items: b[i] ?? [] })),
  emergency, refs: [R.geeky, ...refs], source: LIT, reviewer: "", effective: "", status: "literature", notes,
});
const topic = (section: HbSpec["section"], category: string, keywords: string[], blocks: HbBlock[], refs: Ref[], status: HbSpec["status"] = "literature"): HbSpec => ({
  section, category, keywords, blocks, emergency: [], refs, source: status === "literature" ? LIT : "", reviewer: "", effective: "", status, notes: "",
});

const ASK_VITALS = "生命徵象（BT、HR、BP、RR、SpO2）與意識，和平常比較";
const ASK_CONTEXT = "診斷、術式與術後第幾天、DNR 狀態";

type Seed = { uid: string; name: string; spec: HbSpec };

/** 第 1 批 */
const SEED_V1: Seed[] = [
  // ── 值班常見狀況 ─────────────────────────────────────────────
  {
    uid: "hb-seed-fever", name: "發燒",
    spec: oncall("感染", ["發燒", "fever", "體溫", "sepsis", "敗血症"], [
      [ASK_VITALS, ASK_CONTEXT, "發燒多久、有無寒顫", "目前抗生素與管路（CVC、尿管、引流管）"],
      ["整體外觀、意識、末梢灌流", "傷口、引流液性狀、管路入口", "肺部聽診、腹部、小腿（DVT）"],
      ["敗血症／敗血性休克（低血壓、意識改變、呼吸快、乳酸高）", "吻合處滲漏、腹內膿瘍", "管路感染、肺炎、泌尿道感染", "深部靜脈栓塞／肺栓塞、藥物熱"],
      ["CBC／DC、CRP", "血液培養 ×2（抗生素前）", "依懷疑來源：尿液、痰液、傷口或引流液培養、胸部 X 光", "疑敗血症：lactate"],
      ["術後 48–72 小時內的發燒多為發炎反應，生命徵象穩定者先觀察與找來源", "72–96 小時後的發燒多為感染，需完整評估", "疑敗血症：依院內敗血症流程，儘早給抗生素與輸液", "退燒藥依醫囑，注意是否遮蔽病情"],
      ["生命徵象不穩或疑敗血症：立即", "懷疑吻合處滲漏、膿瘍需處理：立即", "其他：依院內規定回報"],
    ], [R.postopFever, R.sepsisNice, R.ssc], ["em-v4-bp"],
    "術後發燒常用「5W」記憶：Wind（肺）、Water（泌尿道）、Wound（傷口）、Walking（DVT）、Wonder drugs（藥物）"),
  },
  {
    uid: "hb-seed-chest-pain", name: "胸痛",
    spec: oncall("循環", ["胸痛", "chest pain", "心肌梗塞", "ACS", "肺栓塞"], [
      [ASK_VITALS, "疼痛位置、性質、放射、何時開始、持續多久", "心血管病史、目前抗凝血藥", ASK_CONTEXT],
      ["整體外觀、冒冷汗、呼吸型態", "兩側血壓、心音、呼吸音", "小腿腫脹壓痛（DVT）"],
      ["急性冠心症", "主動脈剝離", "肺栓塞", "張力性氣胸", "食道破裂"],
      ["12 導程 ECG（10 分鐘內）並與舊的比較", "Troponin（依院內流程重複追蹤）", "胸部 X 光", "依懷疑：D-dimer 或 CT"],
      ["心電監測、給氧維持目標 SpO2", "建立靜脈通路", "依 ECG 與臨床判斷啟動院內胸痛／STEMI 流程"],
      ["ECG 有 ST 上升或新變化：立即", "生命徵象不穩：立即", "懷疑主動脈剝離、肺栓塞、氣胸：立即"],
    ], [R.chest], ["em-seed-hypoxemia", "em-v4-bp"]),
  },
  {
    uid: "hb-seed-hypotension", name: "低血壓",
    spec: oncall("循環", ["低血壓", "hypotension", "休克", "shock", "MAP"], [
      [ASK_VITALS, "血壓多少、平常多少、何時開始", "尿量、出血、引流量變化", "最近用藥（降壓藥、止痛、鎮靜）", ASK_CONTEXT],
      ["意識、末梢溫度、微血管回填", "傷口與引流是否出血", "頸靜脈、心肺音、腹部"],
      ["出血（術後出血最常見）", "敗血性休克", "心因性（心肌梗塞、心律不整、心包填塞）", "過敏性休克、肺栓塞、張力性氣胸"],
      ["重測血壓（確認袖帶大小與位置）", "CBC、血型與交叉試驗、生化、lactate", "ECG", "依懷疑：血液培養、心臟超音波"],
      ["平躺，確認兩條可用的靜脈通路", "依醫囑輸液，邊給邊評估", "停用或暫緩降壓藥", "依原因處理：出血準備輸血、敗血症依院內流程"],
      ["MAP <65 或意識改變：立即", "懷疑出血：立即通知主刀或值班外科醫師"],
    ], [R.ssc], ["em-v4-bp"]),
  },
  {
    uid: "hb-seed-dyspnea", name: "喘／血氧低",
    spec: oncall("呼吸", ["喘", "呼吸困難", "dyspnea", "SpO2", "血氧", "hypoxemia"], [
      [ASK_VITALS, "SpO2 多少、目前給氧方式與流量", "何時開始、突然或漸進", "有無胸痛、咳嗽、痰", "COPD 或 CO2 滯留病史"],
      ["呼吸型態、使用呼吸輔助肌、能否說完整句子", "兩側呼吸音、是否對稱", "輸液平衡、下肢水腫、小腿"],
      ["肺栓塞", "張力性氣胸", "肺水腫（輸液過多、心衰竭）", "吸入性肺炎", "過敏反應、支氣管痙攣", "術後肺擴張不全"],
      ["血液氣體分析", "胸部 X 光", "ECG", "依懷疑：CBC、BNP、D-dimer、CT"],
      ["依目標給氧（一般 94–98%，CO2 滯留風險 88–92%）", "坐起、深呼吸咳嗽", "依原因：利尿、支氣管擴張劑等依醫囑"],
      ["SpO2 持續低於目標、呼吸費力或意識改變：立即", "懷疑肺栓塞、氣胸：立即"],
    ], [R.bts], ["em-seed-hypoxemia"]),
  },
  {
    uid: "hb-seed-confusion", name: "意識改變",
    spec: oncall("神經", ["意識改變", "混亂", "譫妄", "delirium", "嗜睡", "叫不醒"], [
      [ASK_VITALS, "何時開始、突然或波動", "平常的認知狀態", "最近用藥（鴉片類、鎮靜安眠藥、抗膽鹼藥）", "血糖"],
      ["GCS、瞳孔、肢體無力、說話", "注意力測試", "脫水、尿滯留、便祕、疼痛", "感染徵象"],
      ["低血糖", "缺氧、CO2 滯留", "中風、顱內出血", "敗血症", "電解質異常（Na、Ca）", "藥物過量或戒斷"],
      ["床邊血糖", "SpO2、必要時血液氣體", "CBC、電解質（Na、Ca）、腎肝功能", "依懷疑：腦部 CT、感染檢查"],
      ["先處理可逆原因：低血糖、缺氧", "檢視並減少可能造成譫妄的藥物", "非藥物照護：定向感、家屬陪伴、日夜作息、眼鏡助聽器", "避免約束，必要時依院內規範"],
      ["GCS 下降、新的局部神經學症狀：立即（啟動院內中風流程）", "低血糖處理後仍未恢復：立即"],
    ], [R.delirium, R.deliriumSp], ["em-v4-glucose", "em-seed-hypoxemia"]),
  },
  {
    uid: "hb-seed-agitation", name: "躁動",
    spec: oncall("神經", ["躁動", "agitation", "不配合", "拔管", "暴力"], [
      [ASK_VITALS, "有無危及自己或他人、拔除管路", "何時開始、平常狀態", "最近用藥與酒精、藥物使用史"],
      ["確保現場安全，保持距離與出口", "評估是否為譫妄（注意力、意識波動）", "疼痛、尿滯留、缺氧、低血糖"],
      ["缺氧、低血糖", "譫妄（感染、藥物、電解質）", "酒精或藥物戒斷", "顱內病變"],
      ["床邊血糖、SpO2", "依懷疑：電解質、感染檢查、血液氣體"],
      ["先用言語安撫與降低刺激", "處理可逆原因（疼痛、尿滯留、缺氧）", "必要時依醫囑給藥；約束需依院內規範與醫囑、定時評估"],
      ["危及安全、需要藥物或約束：立即", "疑戒斷或顱內病變：立即"],
    ], [R.aggression, R.delirium]),
  },
  {
    uid: "hb-seed-fall", name: "跌倒",
    spec: oncall("安全", ["跌倒", "fall", "頭部外傷", "head injury"], [
      [ASK_VITALS, "跌倒經過、有無撞到頭、有無意識喪失", "是否使用抗凝血或抗血小板藥", "目前有無疼痛、能否移動"],
      ["未評估前不要急著扶起；先檢查頸椎與骨折", "GCS、瞳孔、頭部傷口", "四肢疼痛、變形、髖部（下肢短縮外旋）", "傷口、管路是否脫落"],
      ["顱內出血（尤其使用抗凝血藥者）", "髖部或其他骨折", "跌倒的原因：暈厥、心律不整、低血糖、低血壓"],
      ["床邊血糖", "依懷疑：ECG、姿勢性血壓", "頭部外傷且有危險因子（含抗凝血藥）：依指引考慮腦部 CT", "疑骨折：X 光"],
      ["處理傷口、固定疑似骨折處", "神經學評估並依規定追蹤", "找出並處理跌倒原因", "依院內規定通報與告知家屬"],
      ["GCS 下降、嘔吐、抽搐、使用抗凝血藥且撞到頭：立即", "疑骨折或無法承重：立即"],
    ], [R.falls, R.head]),
  },
  {
    uid: "hb-seed-pain", name: "疼痛",
    spec: oncall("症狀", ["疼痛", "pain", "止痛", "PCA", "術後疼痛"], [
      [ASK_VITALS, "疼痛位置、分數、性質，和先前比較", "目前止痛藥、上次給藥時間、PCA 使用情形"],
      ["疼痛部位與傷口", "腹部：腹膜刺激徵象、腹脹", "肢體：腫脹、冰冷、蒼白（缺血、腔室症候群）", "鎮靜程度與呼吸（鴉片類）"],
      ["術後併發症：出血、滲漏、腸阻塞、缺血", "腔室症候群", "非手術部位：心肌梗塞、尿滯留"],
      ["依部位與懷疑的原因決定，例如 CBC、ECG、影像"],
      ["多模式止痛（依醫囑）", "鴉片類：監測鎮靜與呼吸", "非藥物：姿勢、冰敷熱敷"],
      ["疼痛型態突然改變或與預期不符：立即", "懷疑缺血或腔室症候群：立即"],
    ], [R.pain]),
  },
  {
    uid: "hb-seed-oliguria", name: "尿少",
    spec: oncall("腎臟", ["尿少", "oliguria", "無尿", "AKI", "尿滯留"], [
      [ASK_VITALS, "過去幾小時尿量（mL/kg/h）", "有無尿管、尿管是否通暢", "輸液與引流量、口服量", "腎毒性藥物"],
      ["膀胱是否脹（膀胱超音波）", "脫水或水腫、肺部囉音", "尿管是否扭折或阻塞"],
      ["尿管阻塞、尿滯留", "低血容、出血", "敗血症", "腹腔高壓（腹部手術後）"],
      ["膀胱超音波（有尿管時先沖洗或更換）", "Creatinine、BUN、電解質（K）", "依懷疑：尿液檢查"],
      ["先排除阻塞", "評估容量後依醫囑輸液", "調整腎毒性藥物", "記錄每小時尿量"],
      ["尿量 <0.5 mL/kg/h 持續數小時、K 高、呼吸喘：立即"],
    ], [R.oliguria, R.aki, R.retention], ["em-v4-k"],
    "KDIGO：尿量 <0.5 mL/kg/h 持續 6 小時以上屬 AKI 分期標準之一"),
  },
  {
    uid: "hb-seed-wound", name: "術後出血／傷口異常",
    spec: oncall("外科", ["出血", "傷口", "滲液", "血腫", "裂開", "wound"], [
      [ASK_VITALS, "出血量與速度、顏色", "抗凝血或抗血小板藥", ASK_CONTEXT],
      ["直接看傷口：滲血、血腫、紅腫熱痛、分泌物、裂開", "引流量是否同時增加", "末梢灌流"],
      ["活動性出血（低血壓、心跳快）", "傷口裂開、內臟外露", "深部感染或壞死性筋膜炎"],
      ["CBC、凝血功能", "血型與交叉試驗", "依懷疑：傷口培養、影像"],
      ["加壓止血、抬高", "傷口裂開：以無菌濕紗覆蓋、勿塞回", "依醫囑暫停抗凝血藥"],
      ["持續出血或生命徵象改變：立即通知主刀或值班外科醫師", "傷口裂開：立即"],
    ], [R.wound], ["em-v4-bp"]),
  },
  {
    uid: "hb-seed-drain", name: "引流液異常",
    spec: oncall("外科", ["引流", "drain", "JP", "Hemovac", "引流量", "滲漏"], [
      [ASK_VITALS, "引流量多少、多久內、顏色與性狀", "和前幾小時比較", "術式與引流管位置"],
      ["引流管是否脫出、扭折、阻塞", "引流液：鮮血、混濁、膽汁、腸內容物、乳糜", "腹部或手術部位狀況"],
      ["鮮血且量多：術後出血", "腸內容物、膽汁、混濁：吻合處或膽道滲漏、感染", "引流突然變少但病人變差：引流管阻塞"],
      ["依性狀：引流液檢驗（例如 amylase、bilirubin）、培養", "出血：CBC、凝血功能"],
      ["確認引流管通暢與負壓", "準確記錄引流量與性狀", "不自行拔除或大幅調整"],
      ["引流液鮮紅且量多、性狀突然改變、生命徵象改變：立即"],
    ], [R.drains]),
  },

  // ── 外科照護 ─────────────────────────────────────────────────
  {
    uid: "hb-seed-postop", name: "術後常規評估",
    spec: topic("surgical", "術後", ["術後", "postop", "ERAS", "查房"], [
      { title: "每日評估", items: ["生命徵象與趨勢", "疼痛控制", "進食、腸蠕動、排氣排便", "尿量與輸液平衡", "傷口與引流", "活動量", "血栓預防", "管路是否還需要（每日檢討，能拔就拔）"] },
      { title: "ERAS 重點", items: ["早期進食", "早期下床", "多模式止痛、減少鴉片類", "避免過量輸液", "儘早移除尿管與引流管"] },
    ], [R.eras]),
  },
  {
    uid: "hb-seed-drain-care", name: "引流管照護",
    spec: topic("surgical", "管路", ["引流", "drain", "JP", "Hemovac", "負壓"], [
      { title: "觀察", items: ["每班記錄引流量、顏色、性狀", "確認負壓引流瓶維持負壓", "固定良好，避免扭折牽扯", "入口處皮膚：紅腫、滲漏"] },
      { title: "拔除時機", items: ["依醫囑；常見考量為引流量減少且性狀正常", "文獻不建議常規長時間留置，會影響下床活動"] },
      { title: "異常時", items: ["見「引流液異常」值班卡"] },
    ], [R.drains]),
  },
  {
    uid: "hb-seed-wound-care", name: "傷口照護與感染預防",
    spec: topic("surgical", "傷口", ["傷口", "換藥", "SSI", "感染", "wound"], [
      { title: "日常照護", items: ["無菌技術換藥", "觀察紅、腫、熱、痛、分泌物", "血糖控制（高血糖增加感染風險）"] },
      { title: "感染徵象", items: ["傷口周圍紅腫擴大、化膿、裂開", "發燒（術後 72 小時後更需注意）", "疑感染：依醫囑培養、必要時打開引流"] },
    ], [R.whoSsi, R.cdcSsi, R.wound]),
  },
  {
    uid: "hb-seed-retention", name: "術後尿滯留與導尿",
    spec: topic("surgical", "泌尿", ["尿滯留", "解不出尿", "導尿", "尿管", "retention"], [
      { title: "評估", items: ["術後多久未解尿、下腹脹痛", "膀胱超音波估計膀胱容量", "危險因子：年紀大、脊髓麻醉、鴉片類、疝氣或肛門手術"] },
      { title: "處置", items: ["依膀胱容量與醫囑單次導尿或留置尿管", "減少造成滯留的藥物", "早期下床"] },
    ], [R.retention]),
  },

  // ── 行政流程（院內規定，待填）──────────────────────────────
  ...([
    ["hb-seed-admin-discharge", "出院流程"],
    ["hb-seed-admin-certificate", "診斷書"],
    ["hb-seed-admin-consult", "會診"],
    ["hb-seed-admin-transfer", "轉床／轉 ICU"],
    ["hb-seed-admin-death", "病人死亡處理"],
  ] as const).map(([uid, name]) => ({
    uid, name,
    spec: topic("admin", "行政", [name], [{ title: "步驟（待院內填寫）", items: [] }, { title: "注意事項", items: [] }], [], "draft"),
  })),
];

const R2 = {
  hypoNa: { title: "ESE/ESICM/ERBP Clinical practice guideline on hyponatraemia (2014)", url: "https://pubmed.ncbi.nlm.nih.gov/24569125/" },
  bp: { title: "AHA Scientific Statement: Management of Elevated Blood Pressure in the Acute Care Setting (2024)", url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000238" },
} satisfies Record<string, Ref>;

/** 第 2 批：低血鈉、血壓高 */
const SEED_V2: Seed[] = [
  {
    uid: "hb-seed-hyponatremia", name: "低血鈉",
    spec: oncall("電解質", ["低血鈉", "hyponatremia", "Na", "鈉"], [
      [ASK_VITALS, "Na 多少、前一次多少（下降速度）", "有無噁心、嘔吐、頭痛、混亂、抽搐", "目前輸液種類與速度、利尿劑等藥物"],
      ["意識與神經學狀態", "容量狀態：黏膜、頸靜脈、水腫、體重、輸入輸出量"],
      ["有嚴重症狀的急性低血鈉（腦水腫）", "矯正過快造成滲透壓性脫髓鞘", "術後低張輸液造成的急性低血鈉"],
      ["Serum osmolality、urine osmolality、urine Na", "血糖（排除高血糖造成的假性低血鈉）", "依懷疑：TSH、cortisol"],
      ["停用低張輸液與相關藥物", "有嚴重症狀：依危急處置卡給高張食鹽水", "依原因處理（容量不足補液、SIADH 限水等，依醫囑）", "矯正上限：第一個 24 小時 ≤10，之後每 24 小時 ≤8"],
      ["有中度或嚴重症狀：立即", "Na <125 或下降快速：立即"],
    ], [R2.hypoNa], ["em-v4-na"]),
  },
  {
    uid: "hb-seed-hypertension", name: "血壓高",
    spec: oncall("循環", ["高血壓", "血壓高", "hypertension", "SBP"], [
      [ASK_VITALS, "血壓多少、平常多少、怎麼量的", "有無胸痛、喘、頭痛、視力模糊、肢體無力、說話不清", "平常降壓藥今天有沒有吃"],
      ["正確重測：合適袖帶、休息 5 分鐘", "神經學檢查、心肺音", "疼痛、尿滯留（膀胱脹）、焦慮、缺氧"],
      ["高血壓急症：中風、顱內出血、急性冠心症、主動脈剝離、肺水腫", "子癇前症（孕產婦）"],
      ["有器官損傷疑慮時：ECG、Troponin、腎功能、尿液、必要時影像"],
      ["無器官損傷：處理疼痛、尿滯留、焦慮等原因，恢復平常口服藥，不需緊急降壓", "避免為了數字給靜脈降壓藥或急降", "有器官損傷：依危急處置卡「血壓高」"],
      ["有器官損傷表現：立即", "持續 ≥180/110 且處理原因後未改善：通知醫師"],
    ], [R2.bp], ["em-v4-bp"]),
  },
];

const R3 = {
  wikemPressors: { title: "WikEM: Vasopressors", url: "https://wikem.org/wiki/Vasopressors" },
  openAnes: { title: "OpenAnesthesia: Vasopressors and Inotropes — Overview and Selection of Agents", url: "https://www.openanesthesia.org/keywords/vasopressors-and-inotropes-overview-and-selection-of-agents/" },
  ssc: { title: "Surviving Sepsis Campaign Guidelines 2026", url: "https://www.sccm.org/clinical-resources/guidelines/guidelines/surviving-sepsis-campaign-international-guidelines-for-management-of-sepsis-and-septic-shock-2026" },
  htn2017: { title: "2017 ACC/AHA High Blood Pressure Guideline（Table 19–20：高血壓急症靜脈用藥）", url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000065" },
  ibccHtn: { title: "EMCrit IBCC: Hypertensive emergency & antihypertensive medications", url: "https://emcrit.org/ibcc/htn/" },
  ich2022: { title: "2022 AHA/ASA Guideline for Spontaneous Intracerebral Hemorrhage", url: "https://www.ahajournals.org/doi/10.1161/STR.0000000000000407" },
  ais2019: { title: "2019 AHA/ASA Guidelines for the Early Management of Acute Ischemic Stroke", url: "https://www.ahajournals.org/doi/10.1161/STR.0000000000000211" },
  acg: { title: "ACG Clinical Guideline: Upper Gastrointestinal and Ulcer Bleeding (2021)", url: "https://journals.lww.com/ajg/fulltext/2021/05000/acg_clinical_guideline__upper_gastrointestinal_and.14.aspx" },
  baveno: { title: "Baveno VII — Renewing consensus in portal hypertension (J Hepatol 2022)", url: "https://www.journal-of-hepatology.eu/article/S0168-8278(21)02299-6/fulltext" },
} satisfies Record<string, Ref>;

const DRUG_NOTE = "劑量為文獻常用範圍，實際依醫囑；院內泡法與幫浦速率待院內填寫（可新增「院內泡法」段落）";

/** 第 3 批：升壓藥、靜脈降壓藥、消化道出血 */
const SEED_V3: Seed[] = [
  {
    uid: "hb-seed-vasopressors", name: "升壓藥與強心劑",
    spec: {
      ...topic("drug", "循環", ["升壓藥", "vasopressor", "norepinephrine", "Levophed", "vasopressin", "epinephrine", "dopamine", "phenylephrine", "dobutamine", "休克"], [
        { title: "選擇順序（敗血性休克，SSC）", items: [
          "首選 norepinephrine，目標 MAP 65（≥65 歲可 60–65）",
          "Norepinephrine 需要量上升時加上 vasopressin（而不是一直加 norepinephrine）",
          "仍不足時加上 epinephrine",
          "心功能不全合併低灌流：加 dobutamine 或改用 epinephrine",
          "Dopamine 心律不整較多，只用於特定病人（例如心跳慢）",
          "中心靜脈為佳；為了不延誤，可先經周邊大靜脈短期開始，密切觀察外滲",
        ] },
        { title: "Norepinephrine", items: ["0.05–0.4 mcg/kg/min（起始約 5–15 mcg/min），依 MAP 調整", "作用：α 為主、少量 β1"] },
        { title: "Vasopressin", items: ["0.03–0.04 U/min，固定劑量、不調整", "第二線，加在 norepinephrine 上"] },
        { title: "Epinephrine", items: ["0.01–0.5 mcg/kg/min", "注意心律不整、乳酸上升、高血糖"] },
        { title: "Dopamine", items: ["2–20 mcg/kg/min", "心律不整風險較高"] },
        { title: "Phenylephrine", items: ["起始 100–180 mcg/min，穩定後調低（約 0.4–9 mcg/kg/min）", "純 α，可能反射性心跳變慢；適合心搏過速者"] },
        { title: "Dobutamine（強心）", items: ["2.5–20 mcg/kg/min", "用於心輸出量不足；可能降低血壓、造成心搏過速"] },
      ], [R3.ssc, R3.wikemPressors, R3.openAnes]),
      notes: DRUG_NOTE, emergency: ["em-v4-bp"],
    },
  },
  {
    uid: "hb-seed-iv-antihypertensives", name: "靜脈降壓藥",
    spec: {
      ...topic("drug", "循環", ["降壓藥", "antihypertensive", "nicardipine", "Perdipine", "labetalol", "esmolol", "hydralazine", "nitroglycerin", "NTG", "高血壓急症"], [
        { title: "依情境的血壓目標", items: [
          "一般高血壓急症：第一小時降低 ≤25%，之後 2–6 小時到 160/100–110，24–48 小時內逐步到正常",
          "主動脈剝離：第一小時收縮壓 <120（先用 β 阻斷劑控制心跳）",
          "子癇前症、嗜鉻細胞瘤危象：第一小時收縮壓 <140",
          "自發性腦出血（收縮壓 150–220）：降到 140，維持 130–150；避免 <130",
          "缺血性中風：血栓溶解前 <185/110、後 24 小時 <180/105；未接受再灌流治療者 ≥220/120 才考慮降壓",
          "只有數字高、沒有器官損傷：不用靜脈藥（見危急處置卡「血壓高」）",
        ] },
        { title: "Nicardipine", items: ["起始 5 mg/h，每 5–15 分鐘增加 2.5 mg/h，最高 15 mg/h"] },
        { title: "Clevidipine", items: ["起始 1–2 mg/h，每 2–3 分鐘加倍，最高 32 mg/h"] },
        { title: "Labetalol", items: ["0.3–1 mg/kg（最多 20 mg）緩慢 IV，每 10 分鐘可重複；或 0.4–1 mg/kg/h 持續輸注，最高 3 mg/kg/h", "累積最多 300 mg；氣喘、心跳慢、心衰竭避免"] },
        { title: "Esmolol", items: ["負荷 0.5–1 mg/kg（1 分鐘），接著 50 mcg/kg/min", "需要時重複負荷並每次增加 50 mcg/kg/min，最高 200 mcg/kg/min"] },
        { title: "Hydralazine", items: ["10 mg 緩慢 IV（起始最多 20 mg），需要時每 4–6 小時重複", "效果較難預測"] },
        { title: "Nitroglycerin", items: ["起始 5 mcg/min，每 3–5 分鐘增加 5 mcg/min", "適合急性冠心症、急性肺水腫"] },
      ], [R3.htn2017, R3.ibccHtn, R3.ich2022, R3.ais2019]),
      notes: DRUG_NOTE, emergency: ["em-v4-bp"],
    },
  },
  {
    uid: "hb-seed-gi-bleeding", name: "消化道出血",
    spec: oncall("消化", ["消化道出血", "GI bleeding", "吐血", "黑便", "血便", "咖啡渣", "hematemesis", "melena"], [
      [ASK_VITALS, "吐血、咖啡渣、黑便或血便？量與次數", "抗凝血、抗血小板、NSAID、類固醇", "肝硬化或靜脈瘤病史", ASK_CONTEXT],
      ["灌流狀態、意識、姿勢性頭暈", "腹部壓痛、腹膜刺激徵象", "看排泄物或引流（NG 引流液）"],
      ["大量出血造成休克", "靜脈瘤出血", "主動脈腸道瘻管（主動脈手術後）", "大量下消化道出血", "胃腸道穿孔"],
      ["CBC、凝血功能、BUN／Cr、肝功能", "血型與交叉試驗", "計算 GBS（危急處置卡或公式）", "依懷疑：CT 血管攝影"],
      ["兩條大號靜脈管路，依醫囑輸液復甦", "禁食", "限制性輸血：Hb <7（心血管疾病門檻較高，依醫囑）", "依醫囑暫停抗凝血藥、給 PPI；疑靜脈瘤見危急處置卡", "通知腸胃科安排內視鏡"],
      ["生命徵象不穩、持續吐血或解血便：立即", "疑靜脈瘤出血：立即", "Hb 明顯下降：立即"],
    ], [R3.acg, R3.baveno], ["em-seed-ugib", "em-v4-bp"]),
  },
];

/** uid 固定：多台電腦各自加入時以 uid 合併；since＝第幾批加入 */
/** 第 4 批沒有新條目：更新沒改過的條目（危急處置卡合併後的連結） */
export const HANDBOOK_SEED_VERSION = 4;
export const HANDBOOK_SEED: (Seed & { since: number })[] = [
  ...SEED_V1.map(e => ({ ...e, since: 1 })),
  ...SEED_V2.map(e => ({ ...e, since: 2 })),
  ...SEED_V3.map(e => ({ ...e, since: 3 })),
];
