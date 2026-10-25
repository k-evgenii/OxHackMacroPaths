import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // dedupe: @macropaths/ui is a symlink to packages/ui, which has no node_modules; resolve react from web
  resolve: { alias: { "@": path.resolve(__dirname, "src") }, dedupe: ["react", "react-dom"] },
  esbuild: { jsx: "automatic" }, // tsconfig says "preserve" (Next compiles JSX); tests import .tsx components
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
