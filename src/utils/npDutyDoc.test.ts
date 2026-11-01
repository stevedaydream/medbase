import { createRequire } from "node:module";
import { expect, it } from "vitest";
import docToText from "duty-doc-reader";
import { readDutyDoc } from "./npDutyDoc";
import { parseDutyWordText } from "./npDutyWord";

const writeDoc = createRequire(import.meta.url)("duty-doc-reader/src/textToDoc.js") as (text: string) => Uint8Array;

it("recovers EQ overlay codes from a real binary Word field without altering the original file", () => {
  const bytes = writeDoc("NP\n\u0013 EQ \\o\\ac(○,f)\u0015.王小明62001\n\u0013 EQ \\o\\ac(○,x)\u0014舊結果\u0015.李小美62002\nNP(SICU)");
  const original = bytes.slice();
  expect(docToText(bytes)).not.toContain("f.");
  const recovered = readDutyDoc(bytes)!;
  const result = parseDutyWordText(recovered, "2026-11");
  expect(result.sourcePeople?.filter(p => p.group === "NP").map(p => p.staffCode)).toEqual(["f", "x"]);
  expect(bytes).toEqual(original);
});

it("preserves plain text and unrelated fields and safely rejects non-Word data", () => {
  const bytes = writeDoc("一般文字\n\u0013 DATE\u0014日期結果\u0015");
  expect(readDutyDoc(bytes)).toBe(docToText(bytes));
  expect(readDutyDoc(new Uint8Array([1, 2, 3]))).toBeNull();
});
