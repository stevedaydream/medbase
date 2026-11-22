import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;
const require = createRequire(import.meta.url);

// PDF 的繁中字型對照表隨程式打包，院內與離線環境不需向外部 CDN 取字型資料。
function dutyPdfCmaps(): Plugin {
  const directory = resolve(require.resolve("pdfjs-dist/package.json"), "../cmaps");
  const names = new Set(readdirSync(directory).filter(name => name.endsWith(".bcmap")));
  return {
    name: "duty-pdf-cmaps",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split("?")[0]?.replace(/^\/pdf\/cmaps\//, "");
        if (!request.url?.startsWith("/pdf/cmaps/") || !name || !names.has(name)) return next();
        response.setHeader("Content-Type", "application/octet-stream");
        response.end(readFileSync(resolve(directory, name)));
      });
    },
    generateBundle() {
      for (const name of names) this.emitFile({ type: "asset", fileName: `pdf/cmaps/${name}`, source: readFileSync(resolve(directory, name)) });
    },
  };
}

function dutyOcrAssets(): Plugin {
  const packageDir = (name: string) => resolve(require.resolve(`${name}/package.json`), "..");
  const core = packageDir("tesseract.js-core");
  const assets = new Map<string, string>([
    ["worker.min.js", resolve(packageDir("tesseract.js"), "dist/worker.min.js")],
    ...["tesseract-core-lstm", "tesseract-core-simd-lstm"]
      .flatMap(name => ["wasm.js", "wasm"].map(ext => [`${name}.${ext}`, resolve(core, `${name}.${ext}`)] as [string, string])),
    ["chi_tra.traineddata.gz", resolve(packageDir("@tesseract.js-data/chi_tra"), "4.0.0_best_int/chi_tra.traineddata.gz")],
    ["eng.traineddata.gz", resolve(packageDir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz")],
  ]);
  return {
    name: "duty-ocr-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split("?")[0]?.replace(/^\/ocr\//, "");
        const file = name && request.url?.startsWith("/ocr/") ? assets.get(name) : undefined;
        if (!file) return next();
        response.setHeader("Content-Type", name?.endsWith(".js") ? "text/javascript"
          : name?.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of assets) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: readFileSync(file) });
    },
  };
}

/**
 * 網頁開發版（npm run dev）的真實資料：把本機桌機版的 medbase.db 做一份一致的快照給瀏覽器（src/db/webDb.ts）。
 * 用 VACUUM INTO 複製，含 WAL 裡尚未寫回主檔的資料，且不改動來源。只在開發伺服器、且只綁 localhost 時提供。
 * 路徑可用環境變數 MEDBASE_DB 指定；預設 %APPDATA%/com.medbase.app/medbase.db。
 */
function devRealDb(): Plugin {
  return {
    name: "dev-real-db",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/medbase.db", async (_request, response) => {
        const fail = (code: number, msg: string) => { response.statusCode = code; response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.end(msg); };
        if (host) return fail(403, "開發伺服器對外開放（TAURI_DEV_HOST）時不提供真實資料");
        const src = process.env.MEDBASE_DB || resolve(process.env.APPDATA ?? "", "com.medbase.app", "medbase.db");
        if (!existsSync(src)) return fail(404, `找不到本機資料庫：${src}`);
        const tmp = resolve(tmpdir(), `medbase-dev-${process.pid}-${Date.now()}.db`);
        try {
          const { DatabaseSync } = await import("node:sqlite");
          let db;
          try { db = new DatabaseSync(src, { readOnly: true }); db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); }
          catch { db?.close(); db = new DatabaseSync(src); db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); }
          db.close();
          response.setHeader("Content-Type", "application/octet-stream");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("X-MedBase-Db", encodeURIComponent(src));
          response.end(readFileSync(tmp));
        } catch (e) {
          fail(500, `讀取本機資料庫失敗：${(e as Error).message}`);
        } finally {
          rmSync(tmp, { force: true });
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), tailwindcss(), dutyOcrAssets(), dutyPdfCmaps(), devRealDb()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
