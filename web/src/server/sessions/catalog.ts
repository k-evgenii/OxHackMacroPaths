// /api/catalog: static registry metadata. No RPC, no transaction history.
import { getRegistry, presentationOf, type Registry } from "./registry";

export function buildCatalog(registry: Registry = getRegistry()) {
  return {
    version: 1 as const,
    cluster: registry.cluster,
    defaultSession: registry.defaultSession,
    sessions: registry.sessions.map((s) => ({ address: s.address, presentation: presentationOf(s) })),
    products: registry.products.map((p) => ({ ...p })),
    research: registry.research,
  };
}
