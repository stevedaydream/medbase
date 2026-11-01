import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// node scripts/import-osce-resources.mjs <原表.md> <診斷延伸閱讀.md>
const [originalPath, readingPath] = process.argv.slice(2);
if (!originalPath || !readingPath) throw new Error("請提供原表與診斷延伸閱讀兩份 Markdown 路徑");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = {};
const documents = [["original", originalPath, "八大主訴原表"], ["reading", readingPath, "診斷延伸閱讀"]]
  .map(([id, file, title]) => {
    const markdown = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\((assets\/[^)]+)\)/g)) {
      const relative = match[1];
      if (assets[relative]) continue;
      const page = relative.match(/第(\d+)頁\.png$/)?.[1];
      if (!page) throw new Error(`未知的本機學習資源：${relative}`);
      const target = `learning/osce/page-${page.padStart(2, "0")}.png`;
      mkdirSync(resolve(root, "public/learning/osce"), { recursive: true });
      copyFileSync(resolve(dirname(file), relative), resolve(root, "public", target));
      assets[relative] = target;
    }
    return { id, title, sourceFile: file.split(/[\\/]/).pop(), markdown,
      sha256: createHash("sha256").update(markdown).digest("hex") };
  });
mkdirSync(resolve(root, "src/shared/learning"), { recursive: true });
writeFileSync(resolve(root, "src/shared/learning/content.json"), JSON.stringify({ documents, assets }, null, 2) + "\n");
console.log(`已匯入 ${documents.length} 份文件與 ${Object.keys(assets).length} 張原始掃描圖片`);
