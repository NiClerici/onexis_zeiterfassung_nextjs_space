import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Ohne all/include zählt der Bericht nur Dateien, die von einem Test
      // tatsächlich importiert wurden — ungetestete Routen tauchen dann gar
      // nicht auf statt mit 0% (HARDENING.md B1). Genau die sind aber der
      // interessante Teil der Bestandsaufnahme.
      all: true,
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "lib/**/*.spec.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
