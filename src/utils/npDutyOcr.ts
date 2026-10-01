import { createWorker } from "tesseract.js";
import { isNpWard, type NpDutyImportRow } from "./npDutyXlsx";
import type { SavedDutyMap } from "./npDutyMatch";

export async function recognizeDutyImages(images: Array<Blob | Uint8Array>): Promise<string> {
  if (!images.length) return "";
  const worker = await createWorker("chi_tra+eng", 1, {
    workerPath: "/ocr/worker.min.js",
    workerBlobURL: false,
    corePath: "/ocr/",
    langPath: "/ocr/",
  });
  try {
    const texts: string[] = [];
    for (const image of images) {
      const result = await worker.recognize(image instanceof Blob ? image : new Blob([new Uint8Array(image)]));
      texts.push(result.data.text);
    }
    return texts.join("\n");
  } finally {
    await worker.terminate();
  }
}

export function rosterMatchesFromOcr(text: string, rows: NpDutyImportRow[]): SavedDutyMap {
  const matches: SavedDutyMap = {};
  for (const line of text.normalize("NFKC").split(/\r?\n/)) {
    const match = line.trim().match(/^([a-z]|\d{1,2})\s*[.．:：、○◯〇●◎⊙◉)]*\s*([\u3400-\u9fff]{2,4})\s*(\d{5})?\s*(GS|CRS|ORTHO|NS|PS|URO|CVS?|Chest|Trauma|ICU|總值)?/i);
    if (!match) continue;
    const code = match[1].toLowerCase();
    const name = match[2];
    const extension = match[3] ?? "";
    const unit = match[4]?.toUpperCase() === "CV" ? "CVS" : match[4];
    if (/^[a-z]$/.test(code)) {
      if (rows.some(row => isNpWard(row.ward) && row.staffCode === code)) matches[`NP|${code}`] = { name, extension };
    } else if (unit) {
      const key = `VS:${unit}|${code}`;
      if (rows.some(row => `VS:${row.ward}|${row.staffCode}` === key)) matches[key] = { name, extension };
    }
  }
  return matches;
}
