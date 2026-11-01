import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { COMPLAINTS, LEARNING_DOCUMENTS, LEARNING_ENTRIES, LEARNING_ASSETS,
  filterLearningEntries, learningEntryForAnchor, learningAsset, learningNotice } from "./index";
import learningProvider from "@/search/providers/learning";
import { searchHits } from "@/search/types";

it("preserves both complete source documents, all 109 original rows, 126 readings and eight complaints", () => {
  expect(COMPLAINTS).toHaveLength(8);
  expect(LEARNING_ENTRIES.filter(e => e.kind === "original")).toHaveLength(109);
  expect(LEARNING_ENTRIES.filter(e => e.kind === "reading")).toHaveLength(126);
  expect(new Set(LEARNING_ENTRIES.map(e => e.id)).size).toBe(LEARNING_ENTRIES.length);
  for (const doc of LEARNING_DOCUMENTS) {
    expect(createHash("sha256").update(doc.markdown).digest("hex")).toBe(doc.sha256);
  }
  expect(learningNotice("reading")).toContain("仍需臨床複核");
  expect(learningNotice("original")).toContain("轉寫");
  expect(LEARNING_ENTRIES.filter(e => e.kind === "reading" && !e.complaints.length)).toEqual([]);
});

it("bundles all 13 original scans and resolves encoded asset links without depending on the original folders", () => {
  expect(Object.keys(LEARNING_ASSETS)).toHaveLength(13);
  for (const [source, target] of Object.entries(LEARNING_ASSETS)) {
    expect(existsSync(resolve("public", target))).toBe(true);
    expect(learningAsset(encodeURI(source))).toBe(`/${target}`);
  }
  expect(learningAsset("../secret.md")).toBe("");
});

it("filters original and extended content by complaint, Chinese/English text and multiple query terms", () => {
  expect(filterLearningEntries("", "胸痛", "original")).toHaveLength(11);
  expect(filterLearningEntries("", "發燒", "original")).toHaveLength(33);
  expect(filterLearningEntries("心肌梗塞", "胸痛").some(e => e.kind === "original")).toBe(true);
  expect(filterLearningEntries("myocardial infarction", "胸痛", "original")).toHaveLength(1);
  expect(filterLearningEntries("幽門 螺旋桿菌", "腹痛", "reading").some(e => e.title === "消化性潰瘍")).toBe(true);
  expect(filterLearningEntries("不存在的條目xyz")).toEqual([]);
  expect(filterLearningEntries("", "", "document")).toHaveLength(2);
});

it("resolves every disease link in the source complaint index and opens entries directly from Ctrl+K", async () => {
  const reading = LEARNING_DOCUMENTS.find(d => d.id === "reading")!;
  const index = reading.markdown.split(/^## 原表對照/m)[0];
  for (const link of index.matchAll(/\]\(#([^)]+)\)/g)) {
    expect(learningEntryForAnchor(link[1], "reading"), link[1]).toBeDefined();
  }
  const hits = await learningProvider.load();
  const hit = searchHits(hits, "氣胸").find(h => h.label === "氣胸");
  expect(hit?.route).toContain("entry=reading-");
  expect(LEARNING_ENTRIES.find(e => e.id === new URL(hit!.route, "https://medbase.local").searchParams.get("entry"))?.title).toBe("氣胸");
});
