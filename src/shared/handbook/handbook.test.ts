import { describe, it, expect } from "vitest";
import { FORMULAS } from "./formulas";
import { ALL_TOOLS, toolById } from "../tools";
import { HANDBOOK_SEED } from "./seed";
import { SEED_CARDS } from "../emergency/seed";
import { checkHbSpec, searchHandbook, visibleEntries, parseHbSpec, emptyHbSpec, ONCALL_BLOCKS } from "./types";

const f = (id: string) => FORMULAS.find(x => x.id === id)!;

describe("公式", () => {
  it("MAP、校正鈣、Anion gap（含白蛋白校正）", () => {
    expect(f("map").compute({ sbp: 120, dbp: 60 })).toMatchObject({ value: 80 });
    expect(f("map").compute({ sbp: 60, dbp: 120 })).toBeNull();
    expect(f("ca").compute({ ca: 8, alb: 2 })).toMatchObject({ value: 9.6 });
    expect(f("ag").compute({ na: 140, cl: 100, hco3: 24 })).toMatchObject({ value: 16 });
    expect(f("ag").compute({ na: 140, cl: 100, hco3: 24, alb: 2 })).toMatchObject({ value: 21, note: "未校正 16" });
  });
  it("Cockcroft-Gault：女性 × 0.85", () => {
    expect(f("crcl").compute({ age: 70, wt: 72, cr: 1, female: 0 })).toMatchObject({ value: 70 });
    expect(f("crcl").compute({ age: 70, wt: 72, cr: 1, female: 1 })).toMatchObject({ value: 60 });
    expect(f("crcl").compute({ age: 70, wt: 72, cr: 0, female: 0 })).toBeNull();
  });
  it("滲透壓、校正鈉、BMI", () => {
    expect(f("osm").compute({ na: 140, glu: 180, bun: 28 })).toMatchObject({ value: 300 });
    expect(f("na-glu").compute({ na: 130, glu: 600 })).toMatchObject({ value: 138 });
    expect(f("bmi").compute({ ht: 170, wt: 72.25, female: 0 })?.value).toBe(25);
  });
  it("計算工具只有一份清單：校正鈣只留公式版並附判讀", () => {
    expect(ALL_TOOLS.filter(t => t.name.includes("校正鈣")).map(t => t.id)).toEqual(["ca"]);
    expect(new Set(ALL_TOOLS.map(t => t.id)).size).toBe(ALL_TOOLS.length);
    expect(f("ca").compute({ ca: 7, alb: 3 })?.note).toContain("低血鈣");
    expect(toolById("abg")?.kind).toBe("calc");
  });
  it("GBS", () => {
    const base = { bun: 15, hb: 14, sbp: 120, hr: 80, female: 0, melena: 0, syncope: 0, liver: 0, hf: 0 };
    expect(f("gbs").compute(base)).toMatchObject({ value: 0 });
    expect(f("gbs").compute({ ...base, bun: 30, hb: 11, sbp: 95, hr: 110, melena: 1 })?.value).toBe(4 + 3 + 2 + 1 + 1);
    expect(f("gbs").compute({ ...base, female: 1, hb: 11 })?.value).toBe(1);
    expect(f("gbs").compute({ ...base, bun: 80, hb: 8, sbp: 80, hr: 120, melena: 1, syncope: 1, liver: 1, hf: 1 })?.value).toBe(23);
  });
  it("缺值回傳 null；每個公式都有參考連結", () => {
    for (const x of FORMULAS) {
      expect(x.compute({}), x.id).toBeNull();
      expect(x.ref.url, x.id).toMatch(/^https:\/\//);
    }
  });
});

describe("首批內容", () => {
  it("文獻版沒有錯誤；值班卡段落齊全；uid 不重複", () => {
    const uids = new Set<string>();
    for (const e of HANDBOOK_SEED) {
      expect(uids.has(e.uid), e.uid).toBe(false);
      uids.add(e.uid);
      if (e.spec.status !== "draft") expect(checkHbSpec(e.name, e.spec), e.name).toEqual([]);
      if (e.spec.section === "oncall") {
        expect(e.spec.blocks.map(b => b.title)).toEqual([...ONCALL_BLOCKS]);
        expect(e.spec.blocks.every(b => b.items.length), e.name).toBe(true);
      }
    }
    expect(HANDBOOK_SEED.filter(e => e.spec.section === "oncall").length).toBe(14);
    expect(HANDBOOK_SEED.filter(e => e.spec.section === "drug").length).toBe(2);
  });
  it("連到的危急處置卡都存在", () => {
    const em = new Set(SEED_CARDS.map(c => c.uid));
    for (const e of HANDBOOK_SEED) for (const u of e.spec.emergency) expect(em.has(u), `${e.name} → ${u}`).toBe(true);
  });
  it("行政流程是草稿、不顯示；搜尋", () => {
    const vis = visibleEntries(HANDBOOK_SEED);
    expect(vis.some(e => e.spec.section === "admin")).toBe(false);
    expect(searchHandbook(vis, "喘").map(e => e.name)).toEqual(["喘／血氧低"]);
    expect(parseHbSpec("{x")).toBeNull();
    expect(parseHbSpec(JSON.stringify({ section: "surgical" }))!.blocks).toEqual(emptyHbSpec("surgical").blocks);
  });
});
