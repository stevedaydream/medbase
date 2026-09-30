import { describe, it, expect } from "vitest";
import { matchTiers, checkSpec, searchCards, visibleCards, rangeText, tierRefs, measureValue } from "./logic";
import { SEED_CARDS } from "./seed";
import { emptySpec, parseSpec, type EmCard } from "./types";

const card = (name: string) => SEED_CARDS.find(c => c.name === name)!.spec;
const titles = (r: ReturnType<typeof matchTiers>) => r.matched.map(t => t.title);

describe("數值 → 級距", () => {
  it("K 6.2：中度；ECG 題未答時提示要回答", () => {
    const r = matchTiers(card("鉀離子高"), 6.2, {});
    expect(titles(r)).toEqual(["中度（6.0–6.4）"]);
    expect(r.needAnswers).toEqual(["ecg", "lowbg"]);
    expect(r.neighbors.below?.title).toBe("輕度（5.5–5.9）");
    expect(r.neighbors.above?.title).toBe("重度（≥6.5）");
  });
  it("K 6.8 有 ECG 變化、血糖偏低：重度＋鈣劑＋葡萄糖輸注", () => {
    const r = matchTiers(card("鉀離子高"), 6.8, { ecg: true, lowbg: true });
    expect(titles(r)).toEqual(["重度（≥6.5）", "ECG 變化：先穩定心肌", "治療前血糖偏低：預防低血糖"]);
    expect(r.needAnswers).toEqual([]);
  });
  it("血糖低依能否口服分流；<54 另加 Level 2", () => {
    expect(titles(matchTiers(card("血糖低"), 60, { oral: true }))).toEqual(["可口服：給速效醣類"]);
    expect(titles(matchTiers(card("血糖低"), 45, { oral: false }))).toEqual(["無法口服或意識改變", "Level 2 低血糖（<54）"]);
  });
  it("血糖 650 且有 DKA／HHS 表現", () => {
    expect(titles(matchTiers(card("血糖高"), 650, { crisis: true }))).toEqual(["血糖 ≥600：疑似 HHS", "DKA／HHS 處置（2024 國際共識）"]);
  });
  it("範圍外：標示未涵蓋", () => {
    const r = matchTiers(card("鉀離子高"), 4.2, { ecg: false, lowbg: false });
    expect(r.uncovered).toBe(true);
    expect(matchTiers(card("鉀離子高"), null, {}).uncovered).toBe(false);
  });
});

describe("參考文獻", () => {
  it("每張文獻版卡片都有連結；級距可指定依據，未指定用全部", () => {
    for (const c of SEED_CARDS) {
      expect(c.spec.refs.length, c.name).toBeGreaterThan(0);
      for (const r of c.spec.refs) expect(r.url, c.name).toMatch(/^https:\/\//);
    }
    const hi = card("血糖高");
    const dka = hi.tiers.find(t => t.id === "c1")!;
    expect(tierRefs(hi, dka).map(r => r.title)).toEqual([hi.refs[1].title]);
    const k = card("鉀離子高");
    expect(tierRefs(k, k.tiers[0]).length).toBe(k.refs.length);
  });
});

describe("用公式計算數值", () => {
  it("血壓低輸入 SBP／DBP 算 MAP；血鈣輸入 Ca／白蛋白算校正鈣", () => {
    const bp = card("血壓低");
    expect(measureValue(bp, { sbp: "80", dbp: "50" })).toBe(60);
    expect(measureValue(bp, { sbp: "80" })).toBeNull();
    expect(titles(matchTiers(bp, measureValue(bp, { sbp: "80", dbp: "50" }), { sepsis: false }))).toEqual(["低血壓（MAP <65）"]);
    const ca = card("鈣離子低");
    expect(measureValue(ca, { ca: "6.8", alb: "3" })).toBe(7.6);
    expect(titles(matchTiers(ca, 7.2, { sym: false }))).toEqual(["重度（<7.6）"]);
    expect(measureValue(card("鈉離子低"), { value: "128" })).toBe(128);
  });
  it("第 2 批：低血鈉嚴重症狀給高張食鹽水；血壓高無器官損傷不急降", () => {
    expect(titles(matchTiers(card("鈉離子低"), 122, { severe: true, moderate: false }))).toEqual(["重度（<125）", "嚴重症狀：高張食鹽水"]);
    expect(titles(matchTiers(card("血壓高"), 190, { organ: false }))).toEqual(["明顯升高、無器官損傷（≥180/110）"]);
    expect(SEED_CARDS.filter(c => c.since === 2).length).toBe(5);
  });
});

describe("編輯檢查", () => {
  it("首批文獻版卡片沒有錯誤", () => {
    for (const c of SEED_CARDS) expect(checkSpec(c.name, c.spec).filter(i => i.level === "error"), c.name).toEqual([]);
  });
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
  const cards: EmCard[] = SEED_CARDS;
  it("關鍵字搜尋", () => {
    expect(searchCards(cards, "喘").map(c => c.name)).toEqual(["血氧低"]);
    expect(searchCards(cards, "鉀").map(c => c.name)).toEqual(["鉀離子高", "鉀離子低"]);
  });
  it("草稿不顯示", () => {
    const d = { uid: "x", name: "草稿", spec: emptySpec() };
    expect(visibleCards([...cards, d]).length).toBe(cards.length);
  });
  it("範圍文字與解析", () => {
    expect(rangeText({ min: null, max: 69 } as never, "mg/dL")).toBe("≤ 69 mg/dL");
    expect(rangeText({ min: 6.5, max: null } as never)).toBe("≥ 6.5");
    expect(parseSpec("{bad")).toBeNull();
    expect(parseSpec(JSON.stringify({ kind: "general" }))!.general.actions).toEqual([]);
  });
});
