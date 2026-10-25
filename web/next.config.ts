import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  // @macropaths/client is a source-only TypeScript package (../packages/client).
  transpilePackages: ["@macropaths/client", "@macropaths/ui"],
};

export default nextConfig;
