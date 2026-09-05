import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  test: { environment: "node", include: ["verification/**/*.verify.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "../") } },
});
