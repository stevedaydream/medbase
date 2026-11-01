import { CFB } from "xlsx";
import docToText from "duty-doc-reader";
import { dutyEquationCode } from "./dutySymbols";

/** 僅修復記憶體副本的 EQ 欄位，保留原位元組長度、piece table 與修訂刪除判斷。 */
export function readDutyDoc(data: ArrayBuffer | Uint8Array): string | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  try {
    const container = CFB.read(bytes, { type: "array" });
    const stream = CFB.find(container, "WordDocument") as { content: Uint8Array } | null;
    if (!stream) return docToText(bytes);
    const content = new Uint8Array(stream.content);
    const text = new TextDecoder("utf-16le", { ignoreBOM: true }).decode(content.subarray(0, content.length - content.length % 2));
    let repaired = false;
    for (const match of text.matchAll(/\u0013([^\u0013-\u0015]*)(?:\u0014[^\u0013-\u0015]*)?\u0015/g)) {
      const code = dutyEquationCode(match[1]);
      if (!code) continue;
      // Replace the whole field in place; never infer letters from roster order.
      const replacement = code.padEnd(match[0].length, " ");
      for (let i = 0; i < replacement.length; i++) {
        const offset = (match.index + i) * 2;
        content[offset] = replacement.charCodeAt(i) & 0xff;
        content[offset + 1] = replacement.charCodeAt(i) >> 8;
      }
      repaired = true;
    }
    if (!repaired) return docToText(bytes);
    stream.content = content;
    return docToText(new Uint8Array(CFB.write(container, { type: "array" })));
  } catch {
    return docToText(bytes);
  }
}
