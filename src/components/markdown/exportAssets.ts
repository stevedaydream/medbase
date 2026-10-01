import { parseMarkdown, type Token } from "@/shared/markdown/render";
import { emptyAssets, type ExportAssets, type ImageAsset } from "@/shared/markdown/export/html";
import { renderMermaid } from "./widgets";

/**
 * 匯出前在瀏覽器準備素材：讀取圖片（量尺寸、非 PNG/JPEG/GIF 轉 PNG）、mermaid 轉 SVG 與 PNG。
 * loadImage 由頁面提供（本機文件讀相對路徑檔案、論文稿件讀資料庫）。
 */
export type ImageLoader = (src: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;

function walk(tokens: Token[], fn: (t: Token) => void) {
  for (const t of tokens) { fn(t); if (t.children) walk(t.children, fn); }
}

export function collectSources(md: string): { images: string[]; mermaid: string[] } {
  const { tokens } = parseMarkdown(md);
  const images = new Set<string>(), mermaid = new Set<string>();
  walk(tokens, t => {
    if (t.type === "image") images.add(String(t.attrGet("src") ?? ""));
    // 原文 HTML 裡的 <img src>
    if (t.type === "html_block" || t.type === "html_inline") {
      for (const m of t.content.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) images.add(m[1] ?? m[2] ?? m[3] ?? "");
    }
    if (t.type === "fence" && t.info.trim().split(/\s+/)[0]?.toLowerCase() === "mermaid") mermaid.add(t.content);
  });
  return { images: [...images].filter(Boolean), mermaid: [...mermaid] };
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片無法讀取"));
    img.src = url;
  });
}

async function toPng(img: HTMLImageElement, w: number, h: number, scale = 1): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("圖片轉換失敗");
  return new Uint8Array(await blob.arrayBuffer());
}

const KEEP = new Set(["image/png", "image/jpeg", "image/gif"]);

async function imageAsset(bytes: Uint8Array, mime: string): Promise<ImageAsset> {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = await loadImg(url);
    const w = img.naturalWidth || 400, h = img.naturalHeight || 300;
    if (KEEP.has(mime)) return { bytes, mime, width: w, height: h };
    return { bytes: await toPng(img, w, h), mime: "image/png", width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** SVG 尺寸：取 width/height，沒有時用 viewBox */
function svgSize(svg: string): [number, number] {
  const vb = /viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
  const w = /<svg[^>]*\swidth="([\d.]+)(px)?"/.exec(svg), h = /<svg[^>]*\sheight="([\d.]+)(px)?"/.exec(svg);
  return [Number(w?.[1] ?? vb?.[1] ?? 600), Number(h?.[1] ?? vb?.[2] ?? 400)];
}

function decodeDataUri(uri: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(uri);
  if (!m) return null;
  const mime = m[1] || "image/png";
  if (!m[2]) return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime };
  const bin = atob(m[3]);
  return { bytes: Uint8Array.from(bin, c => c.charCodeAt(0)), mime };
}

export interface PrepareResult { assets: ExportAssets; warnings: string[] }

export async function prepareAssets(md: string, loadImage: ImageLoader, opts: { png: boolean }): Promise<PrepareResult> {
  const assets = emptyAssets();
  const warnings: string[] = [];
  const { images, mermaid } = collectSources(md);
  for (const src of images) {
    if (/^https?:/i.test(src)) continue;
    try {
      // data URI 自己解碼（CSP 不允許 fetch data:）
      const raw = /^data:/i.test(src) ? decodeDataUri(src) : await loadImage(src);
      if (!raw) { warnings.push(`找不到圖片：${src}`); continue; }
      assets.images.set(src, await imageAsset(raw.bytes, raw.mime));
    } catch (e) {
      warnings.push(`圖片無法讀取：${src}（${(e as Error).message}）`);
    }
  }
  for (const code of mermaid) {
    try {
      // 每張圖給唯一 id，避免多張圖的樣式互相影響
      const svg = (await renderMermaid(code, "default", true)).replace(/<br\s*>/g, "<br/>");
      assets.mermaidSvg.set(code, svg);
      if (opts.png) {
        const [w, h] = svgSize(svg);
        const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
        const img = await loadImg(url);
        assets.mermaidPng.set(code, { bytes: await toPng(img, w, h, 2), mime: "image/png", width: w, height: h });
      }
    } catch (e) {
      warnings.push(`圖表無法繪製（以原始碼匯出）：${(e as Error).message?.split("\n")[0] ?? e}`);
    }
  }
  return { assets, warnings };
}

/** 用隱藏 iframe 開啟列印對話框（選「另存為 PDF」）；對話框右側即實際分頁預覽 */
export function printHtml(html: string): Promise<void> {
  return new Promise(resolve => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    iframe.srcdoc = html;
    iframe.onload = () => {
      const win = iframe.contentWindow;
      const cleanup = () => { iframe.remove(); resolve(); };
      if (!win) { cleanup(); return; }
      win.addEventListener("afterprint", () => setTimeout(cleanup, 100));
      // 等圖片與字型載入完再列印
      setTimeout(() => { win.focus(); win.print(); }, 300);
      setTimeout(() => { if (iframe.isConnected) cleanup(); }, 120_000);
    };
    document.body.appendChild(iframe);
  });
}
