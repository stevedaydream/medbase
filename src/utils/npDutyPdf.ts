import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseDutyPdfPages, type PositionedText } from "./npDutyPdfLayout";
import type { NpDutyParseResult } from "./npDutyXlsx";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function parseNpDutyPdf(data: ArrayBuffer, fallbackMonth: string): Promise<NpDutyParseResult> {
  const task = getDocument({ data: new Uint8Array(data), cMapUrl: `${import.meta.env.BASE_URL}pdf/cmaps/`, cMapPacked: true });
  try {
    const pdf = await task.promise;
    const pages: PositionedText[][] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push(content.items.filter(item => "str" in item).map(item => ({
        text: item.str, x: item.transform[4] * 595.32 / viewport.width,
        top: viewport.height - item.transform[5],
      })));
      page.cleanup();
    }
    return parseDutyPdfPages(pages, fallbackMonth);
  } finally {
    await task.destroy();
  }
}
