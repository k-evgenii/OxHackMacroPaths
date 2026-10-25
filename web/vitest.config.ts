import { defineConfig } from "vitest/config";
import path from "node:path";

// @macropaths/ui is a symlink to packages/ui, which has no node_modules: resolve React from web.
const nm = (p: string) => path.join(__dirname, "node_modules", p);

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") }, dedupe: ["react", "react-dom"] },
  esbuild: { jsx: "automatic" }, // tsconfig says "preserve" (Next compiles JSX); tests import .tsx components
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./test/rpc/setup-env.ts"],
    server: { deps: { inline: [/packages\/ui/] } },
    alias: [
      { find: /^react$/, replacement: nm("react/index.js") },
      { find: /^react\/jsx-runtime$/, replacement: nm("react/jsx-runtime.js") },
      { find: /^react\/jsx-dev-runtime$/, replacement: nm("react/jsx-dev-runtime.js") },
      { find: /^react-dom$/, replacement: nm("react-dom/index.js") },
      { find: /^react-dom\/server$/, replacement: nm("react-dom/server.node.js") },
    ],
  },
});
