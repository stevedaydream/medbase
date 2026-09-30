import { describe, it, expect } from "vitest";
import { matchTiers, checkSpec, searchCards, visibleCards, rangeText } from "./logic";
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
  const cards: EmCard[] = SEED_CARDS.map((c, i) => ({ uid: String(i), ...c }));
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
