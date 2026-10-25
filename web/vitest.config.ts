import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" }, // tsconfig says "preserve" (Next compiles JSX); tests import .tsx components
  test: { include: ["test/**/*.test.ts", "src/**/*.test.ts"], environment: "node" },
});
