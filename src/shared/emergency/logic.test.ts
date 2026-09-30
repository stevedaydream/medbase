import { describe, it, expect } from "vitest";
import {
  matchTiers, checkSpec, searchCards, visibleCards, rangeText, tierRangeText, tierRefs, measureValue, measureValues, relevantConditions,
} from "./logic";
import { SEED_CARDS, ACTIVE_SEED_CARDS } from "./seed";
import { emptySpec, parseSpec } from "./types";

const card = (name: string) => ACTIVE_SEED_CARDS.find(c => c.name === name)!.spec;
const titles = (r: ReturnType<typeof matchTiers>) => r.matched.map(t => t.title);

describe("合併後的數值卡：輸入數值自動判斷高、低、正常", () => {
  it("鉀：6.2 中度、只問高血鉀的是非題；2.8 只問低血鉀的；4.2 正常", () => {
    const k = card("鉀離子");
    const r = matchTiers(k, 6.2, {});
    expect(titles(r)).toEqual(["中度（6.0–6.4）"]);
    expect(r.needAnswers).toEqual(["hi_ecg", "hi_lowbg"]);
    expect(r.neighbors.below?.title).toBe("輕度（5.5–5.9）");
    expect(r.neighbors.above?.title).toBe("重度（≥6.5）");
    expect(relevantConditions(k, 2.8)).toEqual(["lo_sym"]);
    expect(relevantConditions(k, null)).toEqual([]);
    const n = matchTiers(k, 4.2, {});
    expect(n.matched.map(t => t.level)).toEqual(["normal"]);
    expect(n.uncovered).toBe(false);
  });
  it("鉀 6.8 有 ECG 變化、血糖偏低：重度＋鈣劑＋葡萄糖輸注，程度為緊急", () => {
    const r = matchTiers(card("鉀離子"), 6.8, { hi_ecg: true, hi_lowbg: true });
    expect(titles(r)).toEqual(["重度（≥6.5）", "ECG 變化：先穩定心肌", "治療前血糖偏低：預防低血糖"]);
    expect(r.matched.map(t => t.level)).toEqual(["urgent", "urgent", "watch"]);
  });
  it("血糖：60 可口服、45 不能口服、650 疑 HHS 且有 DKA 表現、120 在目標範圍", () => {
    const g = card("血糖");
    expect(titles(matchTiers(g, 60, { lo_oral: true }))).toEqual(["Level 1 低血糖（54–69）", "可口服：給速效醣類"]);
    expect(titles(matchTiers(g, 45, { lo_oral: false }))).toEqual(["無法口服或意識改變", "Level 2 低血糖（<54）"]);
    expect(titles(matchTiers(g, 650, { hi_crisis: true }))).toEqual(["血糖 ≥600：疑似 HHS", "DKA／HHS 處置（2024 國際共識）"]);
    expect(matchTiers(g, 120, {}).matched.map(t => t.level)).toEqual(["normal"]);
  });
  it("鈉：122 嚴重症狀給高張食鹽水；140 正常；165 重度", () => {
    const na = card("鈉離子");
    expect(titles(matchTiers(na, 122, { lo_severe: true, lo_moderate: false }))).toEqual(["重度（<125）", "嚴重症狀：高張食鹽水"]);
    expect(matchTiers(na, 140, {}).matched[0].level).toBe("normal");
    expect(titles(matchTiers(na, 165, { hi_cns: false }))).toEqual(["重度（≥160）"]);
  });
  it("鈣：輸入 Ca＋白蛋白算校正鈣", () => {
    const ca = card("鈣離子");
    expect(measureValue(ca, { ca: "6.8", alb: "3" })).toBe(7.6);
    expect(titles(matchTiers(ca, 7.2, { lo_sym: false }))).toEqual(["重度（<7.6）"]);
    expect(titles(matchTiers(ca, 14.5, { hi_sym: false }))).toEqual(["重度（≥14）"]);
  });
  it("血壓：SBP／DBP 一次輸入；低血壓看 MAP、高血壓看收縮壓、正常要兩者都符合", () => {
    const bp = card("血壓");
    const v = (s: string, d: string) => measureValues(bp, { sbp: s, dbp: d });
    expect(v("80", "50")).toMatchObject({ main: 60, sbp: 80, dbp: 50, pp: 30 });
    expect(titles(matchTiers(bp, v("80", "50"), { lo_sepsis: false }))).toEqual(["低血壓（MAP <65）"]);
    expect(titles(matchTiers(bp, v("190", "100"), { hi_organ: false }))).toEqual(["明顯升高、無器官損傷（≥180/110）"]);
    expect(relevantConditions(bp, v("190", "100"))).toEqual(["hi_organ"]);
    expect(matchTiers(bp, v("120", "70"), {}).matched.map(t => t.level)).toEqual(["normal"]);
    expect(titles(matchTiers(bp, v("150", "90"), {}))).toEqual(["血壓偏高"]);
    // 102/98：MAP 99 在範圍內，但脈壓過窄、舒張壓偏高，不能判為正常
    const r = matchTiers(bp, v("102", "98"), {});
    expect(titles(r)).toEqual(["脈壓過窄（<收縮壓的 25%）", "舒張壓偏高（80–109）"]);
    expect(r.matched[0].level).toBe("urgent");
    // 88/60：MAP 69，但收縮壓 <90
    expect(titles(matchTiers(bp, v("88", "60"), {}))).toEqual(["收縮壓 <90（MAP 尚 ≥65）"]);
    // 150/115：收縮壓看 130–179、舒張壓 ≥110 要問器官損傷
    expect(relevantConditions(bp, v("150", "115"))).toEqual(["hi_organ"]);
    expect(tierRangeText(bp, bp.tiers.find(t => t.id === "pp_narrow")!)).toBe("脈壓／收縮壓 ≤ 24.9 %");
    const hi = bp.tiers.find(t => t.id === "hi_b2")!;
    expect(tierRangeText(bp, hi)).toBe("收縮壓 ≥ 180 mmHg");
  });
  it("升壓藥調整：依目前 NE 劑量建議下一步", () => {
    const p = card("升壓藥調整");
    expect(titles(matchTiers(p, 0, { cardiac: false, tachy: false }))).toEqual(["尚未使用：開始 norepinephrine"]);
    expect(relevantConditions(p, 0.3)).toEqual(["vaso", "cardiac", "tachy"]);
    expect(relevantConditions(p, 0.1)).toEqual(["cardiac", "tachy"]);
    expect(titles(matchTiers(p, 0.3, { vaso: false, cardiac: false, tachy: false }))).toEqual(["NE ≥0.25：加上 vasopressin"]);
    expect(titles(matchTiers(p, 0.3, { vaso: true, cardiac: true, tachy: false }))).toEqual(["NE＋vasopressin 仍不足：加上 epinephrine", "心功能不全：強心"]);
    expect(p.tiers[0].meds[0].name).toContain("Levophed");
  });
  it("降壓藥選擇：點選情境後依收縮壓給目標與用藥", () => {
    const h = card("降壓藥選擇");
    const v = (sbp: string, scen: number) => measureValues(h, { sbp, dbp: "100", scen: String(scen) });
    expect(titles(matchTiers(h, v("170", 1), {}))).toEqual(["主動脈剝離：第一小時收縮壓 <120"]);
    expect(titles(matchTiers(h, v("180", 2), {}))).toEqual(["腦出血：降到 140（維持 130–150）"]);
    expect(titles(matchTiers(h, v("190", 3), {}))).toEqual(["要做再灌流：先降到 <185/110"]);
    expect(titles(matchTiers(h, v("200", 4), {}))).toEqual(["不做再灌流：<220"]);
    expect(titles(matchTiers(h, v("165", 6), {}))).toEqual(["子癇前症／產後：嚴重高血壓（≥160 或舒張壓 ≥110）"]);
    expect(measureValues(h, { sbp: "170", dbp: "100" })).toBeNull();
  });
  it("上消化道出血：GBS 計分", () => {
    const ug = card("上消化道出血");
    const v = measureValue(ug, { bun: "30", hb: "9", sbp: "95", hr: "110", female: "0", melena: "1", syncope: "0", liver: "1", hf: "0" });
    expect(v).toBe(4 + 6 + 2 + 1 + 1 + 2);
    expect(titles(matchTiers(ug, v, { varix: true }))).toEqual(["需住院處置（GBS ≥2）", "疑似靜脈瘤出血（Baveno VII）"]);
  });
});

describe("首批內容", () => {
  it("使用中 9 張；高低分開的 10 張改為停用的草稿", () => {
    expect(ACTIVE_SEED_CARDS.map(c => c.name).sort()).toEqual(["上消化道出血", "血壓", "血氧低", "血糖", "鈉離子", "鈣離子", "鉀離子", "升壓藥調整", "降壓藥選擇"].sort());
    const retired = SEED_CARDS.filter(c => c.retired);
    expect(retired.length).toBe(10);
    expect(retired.every(c => c.spec.status === "draft" && c.spec.notes.includes("已由合併版"))).toBe(true);
  });
  it("沒有錯誤；每張都有文獻連結；合併後級距的文獻索引正確", () => {
    for (const c of ACTIVE_SEED_CARDS) {
      expect(checkSpec(c.name, c.spec).filter(i => i.level === "error"), c.name).toEqual([]);
      expect(c.spec.refs.length, c.name).toBeGreaterThan(0);
      for (const r of c.spec.refs) expect(r.url, c.name).toMatch(/^https:\/\//);
      for (const t of c.spec.tiers) for (const i of t.refs ?? []) expect(c.spec.refs[i], `${c.name} ${t.id}`).toBeTruthy();
    }
    const g = card("血糖");
    const dka = g.tiers.find(t => t.id === "hi_c1")!;
    expect(tierRefs(g, dka).map(r => r.title)).toEqual([g.refs.find(r => r.title.includes("Consensus Report"))!.title]);
  });
});

describe("編輯檢查", () => {
  it("重疊為錯誤、空隙為提醒、院內審核版要填依據", () => {
    const s = emptySpec();
    s.measure = { label: "K", unit: "mEq/L", step: 0.1 };
    const t = (id: string, min: number, max: number) => ({ id, min, max, when: {}, title: id, actions: ["x"], meds: [], rechecks: [], notes: "" });
    s.tiers = [t("A", 5.5, 6.0), t("B", 6.0, 6.4), t("C", 6.6, 7)];
    s.status = "published";
    const msgs = checkSpec("K", s).map(i => `${i.level}:${i.message}`);
    expect(msgs.some(m => m.startsWith("error:「A」與「B」的範圍重疊"))).toBe(true);
    expect(msgs.some(m => m.startsWith("warn:「B」與「C」之間有空白"))).toBe(true);
    expect(msgs.filter(m => m.includes("院內審核版")).length).toBe(3);
  });
});

describe("搜尋與顯示", () => {
  it("關鍵字搜尋（舊的高／低名稱也找得到）", () => {
    expect(searchCards(ACTIVE_SEED_CARDS, "喘").map(c => c.name)).toEqual(["血氧低"]);
    expect(searchCards(ACTIVE_SEED_CARDS, "高血鉀").map(c => c.name)).toEqual(["鉀離子"]);
    expect(searchCards(ACTIVE_SEED_CARDS, "低血鈉").map(c => c.name)).toEqual(["鈉離子"]);
  });
  it("草稿不顯示", () => {
    expect(visibleCards(SEED_CARDS).length).toBe(ACTIVE_SEED_CARDS.length);
  });
  it("範圍文字與解析", () => {
    expect(rangeText({ min: null, max: 69 }, "mg/dL")).toBe("≤ 69 mg/dL");
    expect(rangeText({ min: 6.5, max: null })).toBe("≥ 6.5");
    expect(parseSpec("{bad")).toBeNull();
    expect(parseSpec(JSON.stringify({ kind: "general" }))!.general.actions).toEqual([]);
  });
});
