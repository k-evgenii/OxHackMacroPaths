import type { Page, Request } from "@playwright/test";
import { handleFixtureRequest, type FixtureOptions } from "../support/frontend-v2/handlers";

// Known Solana RPC hosts plus any JSON-RPC POST body: the browser must never talk to RPC directly.
const RPC_HOST = /(solana\.com|helius|quiknode|alchemy|triton|rpcpool|:8899)/i;

export function isBrowserRpc(req: Request): boolean {
  if (RPC_HOST.test(req.url())) return true;
  if (req.method() !== "POST") return false;
  const body = req.postData() ?? "";
  return /"jsonrpc"\s*:\s*"2\.0"/.test(body);
}

/** Serve /api/* from fixtures and record every browser RPC attempt. */
export async function withFixtures(page: Page, opts: FixtureOptions = {}) {
  const rpc: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (r) => {
    if (isBrowserRpc(r)) rpc.push(r.url());
  });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.route("**/api/**", async (route) => {
    const res = handleFixtureRequest(route.request().url(), opts);
    if (!res) return route.continue();
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  return { rpc, consoleErrors };
}
