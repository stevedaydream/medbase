import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;
const require = createRequire(import.meta.url);

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

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), tailwindcss(), dutyOcrAssets()],
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
