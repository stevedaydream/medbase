import { describe, it, expect } from "vitest";
import { parseModels, fetchModels, modelOptions, validModel, modelLabel, AUTO_MODEL } from "./geminiModels";

const RAW = {
  models: [
    { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent", "countTokens"] },
    { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
    { name: "models/imagen-3.0", supportedGenerationMethods: ["predict"] },
    { name: "models/gemini-flash-latest", displayName: "Gemini Flash Latest", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-10.0-flash", displayName: "Gemini 10", supportedGenerationMethods: ["generateContent"] },
  ],
};

describe("Gemini 模型清單", () => {
  it("只留能生成文字的 gemini 模型，版本新的在前", () => {
    expect(parseModels(RAW).map(m => m.id)).toEqual(["gemini-flash-latest", "gemini-10.0-flash", "gemini-2.5-pro", "gemini-2.0-flash"]);
  });
  it("查詢失敗丟出 API 的錯誤訊息；沒有金鑰直接擋", async () => {
    const bad = (async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(fetchModels("k", bad)).rejects.toThrow("API key not valid");
    await expect(fetchModels("")).rejects.toThrow("金鑰");
    const ok = (async () => new Response(JSON.stringify(RAW))) as unknown as typeof fetch;
    expect((await fetchModels("k", ok)).length).toBe(4);
  });
  it("選單：自動在第一個、不重複；選的不在清單也列出", () => {
    const list = parseModels(RAW);
    const opts = modelOptions(list, "gemini-old");
    expect(opts[0].id).toBe(AUTO_MODEL);
    expect(opts.filter(m => m.id === AUTO_MODEL).length).toBe(1);
    expect(opts[opts.length - 1]).toEqual({ id: "gemini-old", label: "gemini-old" });
  });
  it("已下架的模型改回自動；清單查不到時保留原選擇", () => {
    const list = parseModels(RAW);
    expect(validModel(list, "gemini-2.5-flash-preview-04-17")).toBe(AUTO_MODEL);
    expect(validModel(list, "gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(validModel([], "gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(validModel(list, "")).toBe(AUTO_MODEL);
    expect(modelLabel(list, "gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
  });
});
