import { describe, it, expect } from "vitest";
import {
  parseSdmSpec, emptySdmSpec, emptyDecision, searchSdm, groupByDept, decisionSections, checkSdm, normalizeSdm, type SdmEntry,
} from "./types";

const entry = (uid: string, name: string, patch: Partial<ReturnType<typeof emptySdmSpec>> = {}): SdmEntry =>
  ({ uid, name, spec: { ...emptySdmSpec(), ...patch } });

describe("SDM 範本", () => {
  it("parseSdmSpec：壞 JSON 回空白；缺欄位補預設；至少一個決定", () => {
    expect(parseSdmSpec("{bad").decisions.length).toBe(1);
    const s = parseSdmSpec(JSON.stringify({ dept: "骨科", decisions: [{ name: "手術", surgery: "同意" }] }));
    expect(s.dept).toBe("骨科");
    expect(s.methods).toEqual([]);
    expect(s.decisions[0]).toMatchObject({ name: "手術", surgery: "同意", exam: "", extra: [] });
    expect(parseSdmSpec(JSON.stringify({ decisions: [] })).decisions.length).toBe(1);
  });

  it("搜尋：名稱、科別、手術名稱、內文；多字都要符合", () => {
    const d = { ...emptyDecision("手術"), surgeryName: "開放式復位內固定手術" };
    const list = [
      entry("1", "肱骨骨折", { dept: "骨科", decisions: [d], explanation: "保守治療與手術比較" }),
      entry("2", "膽結石", { dept: "一般外科" }),
    ];
    expect(searchSdm(list, "內固定").map(e => e.uid)).toEqual(["1"]);
    expect(searchSdm(list, "骨科 保守").map(e => e.uid)).toEqual(["1"]);
    expect(searchSdm(list, "骨科 膽").length).toBe(0);
    expect(searchSdm(list, " ").length).toBe(2);
  });

  it("依科別分組，未分類放最後", () => {
    const g = groupByDept([entry("1", "B", { dept: "骨科" }), entry("2", "X"), entry("3", "A", { dept: "骨科" }), entry("4", "C", { dept: "一般外科" })]);
    expect(g.map(x => x.dept)).toEqual(["一般外科", "骨科", "未分類"]);
    expect(g[1].items.map(e => e.name)).toEqual(["A", "B"]);
  });

  it("要勾的大項依有填的欄位判斷", () => {
    expect(decisionSections(emptyDecision(), "")).toEqual([]);
    expect(decisionSections({ ...emptyDecision(), surgery: "同意" }, "說明")).toEqual(["重大病情討論", "手術、檢查或治療"]);
  });

  it("存檔檢查與整理", () => {
    const s = { ...emptySdmSpec(), decisions: [emptyDecision("手術"), emptyDecision("")] };
    expect(checkSdm("", s)).toEqual(["請填範本名稱", "有多個決定時，每個決定都要命名"]);
    const n = normalizeSdm({ ...emptySdmSpec(), keywords: [" a ", ""], extra: [{ label: "", value: "" }, { label: "出院準備", value: "x" }] });
    expect(n.keywords).toEqual(["a"]);
    expect(n.extra).toEqual([{ label: "出院準備", value: "x" }]);
  });
});
