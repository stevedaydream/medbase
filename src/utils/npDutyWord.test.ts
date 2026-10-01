import { expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseDutyWordText, readDutyDocx } from "./npDutyWord";

it("parses a legacy Word calendar, specialty roster, and NP codes", () => {
  const days = Array.from({ length: 31 }, (_, index) =>
    `\t\t${index + 1}\t一\tf/l\t\tj/p\t2/3\t3/8\t\t14\t18\t4\t1\t1\t1\t1\t1\t1\t1\t1`).join("");
  const specialties = [
    "1.甲乙丙\n2.乙丙丁\n3.丙丁戊\n4.陳小華", "1.林小明", "1.王甲乙", "1.王乙丙",
    "1.王丙丁", "1.王丁戊", "1.王戊己", "1.王己庚", "1.王庚辛",
  ].join("\n");
  const text = `某院115年10月份外科值班表\n日期\t星期\t9A\t9B\t8A${days}\nGS\nORTHO\nNS\nURO\nPS\nCV\nChest\nTrauma\n${specialties}\nVS\n14.李大明61345 GS\n18.林大華61346 NS\nSA(OR)\nNP\nf.王小明62001\nl.李小美62002\nNP(SICU)`;
  const result = parseDutyWordText(text, "2026-09");
  expect(result.errors).toEqual([]);
  expect(result.rows.find(row => row.dutyDate === "2026-10-01" && row.ward === "GS")?.npName).toBe("陳小華");
  expect(result.rows.find(row => row.dutyDate === "2026-10-01" && row.ward === "9A" && row.staffCode === "f")?.npName).toBe("王小明");
  expect(result.rows.find(row => row.dutyDate === "2026-10-01" && row.ward === "8A" && row.staffCode === "j")?.resolution).toBe("unresolved");
});

it("reads calendar cells and embedded images from a docx", () => {
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:r><w:t>某院115年10月份外科值班表</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>四</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>f/l</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
  const zip = zipSync({ "word/document.xml": strToU8(xml), "word/media/roster.png": new Uint8Array([1, 2, 3]) });
  const result = readDutyDocx(zip.buffer as ArrayBuffer);
  expect(result.calendar).toEqual([["1", "四", "f/l"]]);
  expect(result.images).toHaveLength(1);
  expect(result.text).toContain("外科值班表");
});
