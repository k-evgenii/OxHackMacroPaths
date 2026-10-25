import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @macropaths/client is a source-only TypeScript package (../packages/client).
  transpilePackages: ["@macropaths/client", "@macropaths/ui"],
};

export default nextConfig;
