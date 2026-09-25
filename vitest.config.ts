import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      // api/swap.ts 執行時用打包好的 schedCore.js；測試直接用原始碼
      { find: /^\.\/_lib\/schedCore\.js$/, replacement: resolve(__dirname, "src/shared/sched/empSwap.ts") },
    ],
  },
  test: { include: ["src/**/*.test.ts", "mobile/api/**/*.test.ts"], environment: "node" },
});
