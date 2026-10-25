import { defineConfig, devices } from "@playwright/test";

// Browser QA for frontend v2. Widths per acceptance: 375x812, 768x1024, 1440x900.
// Browser-side /api/* calls are served from fixtures by test/e2e/support.ts (page.route);
// server-side (RSC) reads use the app's own fixture mode, never live RPC.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "test/e2e",
  outputDir: "test-results/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "mobile-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEXT_PUBLIC_USE_FIXTURES: "1", DEV_CONSOLE: process.env.DEV_CONSOLE ?? "1" },
  },
});
