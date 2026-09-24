import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts", "mobile/api/**/*.test.ts"], environment: "node" },
});
