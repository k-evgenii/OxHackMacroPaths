// Local runner for kit tests until Agent 15 wires @macropaths/ui into web.
// packages/ui has no node_modules of its own, so pin React resolution to web's copy.
// Run from web/: npx vitest run --config test/ui-primitives/vitest.config.ts
import { defineConfig, mergeConfig } from "vitest/config";
import path from "node:path";
import base from "../../vitest.config";

const web = path.resolve(__dirname, "../..");

export default mergeConfig(
  base,
  defineConfig({
    resolve: { dedupe: ["react", "react-dom"] },
    server: { fs: { allow: [path.resolve(web, "..")] } },
    test: {
      root: web,
      include: ["test/ui-primitives/**/*.test.ts", "test/ui-primitives/**/*.test.tsx"],
      server: { deps: { inline: [/packages\/ui/] } },
      alias: [
        { find: /^react$/, replacement: path.join(web, "node_modules/react/index.js") },
        { find: /^react\/jsx-runtime$/, replacement: path.join(web, "node_modules/react/jsx-runtime.js") },
        { find: /^react\/jsx-dev-runtime$/, replacement: path.join(web, "node_modules/react/jsx-dev-runtime.js") },
      ],
    },
  }),
);
