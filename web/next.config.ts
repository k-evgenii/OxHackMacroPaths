import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @macropaths/client is a source-only TypeScript package (../packages/client).
  transpilePackages: ["@macropaths/client", "@macropaths/ui"],
  // Monorepo root (web/ + packages/): pins output tracing instead of letting Next guess from lockfiles.
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
