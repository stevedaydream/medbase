import { describe, it, expect } from "vitest";
import { PROVIDERS } from "./index";
import { SEARCH_EXCLUDED, scoreHit, searchHits, focusRoute, type SearchHit } from "./types";
import { ALL_GROUP_TABLES } from "@/utils/backupRegistry";

describe("全域搜尋來源", () => {
  it("Child–Pugh 可用中英文關鍵字搜尋並開啟計算工具", async () => {
    const hits = await PROVIDERS.find(p => p.key === "child-pugh")!.load();
    for (const query of ["Child", "Pugh", "肝功能", "肝臟", "CTP"]) {
      expect(searchHits(hits, query)[0]?.route).toBe("/care?tab=tools&t=child-pugh");
    }
  });
  it("自動讀到 providers 資料夾的所有來源，key 不重複", () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(11);
    expect(new Set(PROVIDERS.map(p => p.key)).size).toBe(PROVIDERS.length);
  });
  it("備份清單的每張表都有來源負責或列為不搜尋（新增功能請在 src/search/providers/ 加檔案）", () => {
    const covered = new Set([...PROVIDERS.flatMap(p => p.tables), ...SEARCH_EXCLUDED]);
    expect(ALL_GROUP_TABLES.filter(t => !covered.has(t))).toEqual([]);
  });
  it("病人資料與個人論文資料不進全域搜尋", () => {
    const tables = PROVIDERS.flatMap(p => p.tables);
    expect(tables).not.toContain("note_records");
    expect(tables.filter(t => t.startsWith("research_") && t !== "research_projects")).toEqual([]);
  });
});

describe("排序與篩選", () => {
  const h = (type: string, label: string, sub = "", keywords = ""): SearchHit => ({ type, label, sub, keywords, route: "/" });
  it("名稱開頭 > 名稱包含 > 多字都在名稱 > 其他欄位；不符合排除", () => {
    expect(scoreHit(h("處方", "Cefazolin 1g"), "cef")).toBe(0);
    expect(scoreHit(h("處方", "術前 Cefazolin"), "cef")).toBe(1);
    expect(scoreHit(h("SDM", "肝癌手術 HCC"), "hcc 肝癌")).toBe(2);
    expect(scoreHit(h("SDM", "肝癌手術", "", "TACE"), "tace")).toBe(3);
    expect(scoreHit(h("SDM", "肝癌手術"), "胃")).toBe(-1);
  });
  it("每種類型最多 N 筆，名稱符合的排前面", () => {
    const hits = [
      ...Array.from({ length: 10 }, (_, i) => h("處方", `abc ${i}`)),
      h("SDM", "x", "", "abc"), h("SDM", "abc 範本"),
    ];
    const r = searchHits(hits, "abc", 3);
    expect(r.filter(x => x.type === "處方").length).toBe(3);
    expect(r[0].label.startsWith("abc")).toBe(true);
    expect(r[r.length - 1].label).toBe("x");
  });
  it("focusRoute 帶 tab 與 focus", () => {
    expect(focusRoute("/sets", "sdm", "u1", { tab: "sdm" })).toBe("/sets?tab=sdm&focus=sdm%3Au1");
  });
});
