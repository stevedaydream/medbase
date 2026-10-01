import { describe, it, expect } from "vitest";
import { highlightToSegs, collectSources } from "./exportAssets";

describe("匯出用程式碼上色", () => {
  it("SQL 關鍵字、字串、註解有顏色，文字完整", async () => {
    const code = "SELECT name FROM users WHERE id = 'a'; -- 註解\n";
    const segs = (await highlightToSegs(code, "sql"))!;
    expect(segs.map(s => s.text).join("")).toBe(code);
    expect(segs.find(s => s.text.includes("SELECT"))?.color).toBe("CF222E");
    expect(segs.find(s => s.text.includes("'a'"))?.color).toBe("0A3069");
    expect(segs.find(s => s.text.includes("註解"))?.italic).toBe(true);
  });
  it("不認得的語言回傳 null", async () => {
    expect(await highlightToSegs("x", "不存在的語言")).toBeNull();
  });
  it("收集程式碼區塊（略過 mermaid 與 text）", () => {
    const { code } = collectSources("```py\na=1\n```\n\n```mermaid\ngraph TD\n```\n\n```text\nx\n```");
    expect(code).toEqual([{ lang: "py", code: "a=1\n" }]);
  });
});
