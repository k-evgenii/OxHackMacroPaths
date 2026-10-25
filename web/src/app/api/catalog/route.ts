import { CatalogResponse } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { buildCatalog } from "@/server/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Static registry metadata: no chain discovery, no transaction history, no RPC. */
export function GET(): Promise<Response> {
  return handle(async () => okJson(CatalogResponse, buildCatalog()));
}
