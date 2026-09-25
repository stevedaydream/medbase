import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// 伺服器端換班（api/swap.ts）用的共用排班邏輯，打包成單一 ESM 檔：
// Vercel 函式以 Node ESM 執行，共用程式的無副檔名 import 無法直接載入。
// 產物 api/_lib/schedCore.js 需一併 commit（npm run build 會重新產生）。
export default defineConfig({
  publicDir: false,
  build: {
    lib: { entry: here('../src/shared/sched/empSwap.ts'), formats: ['es'], fileName: () => 'schedCore.js' },
    outDir: here('api/_lib'),
    emptyOutDir: false,
    minify: false,
    target: 'node20',
  },
})
