import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts", "src/bin.ts"], // pure types + the process-exit entry
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
});
