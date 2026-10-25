// @/server/sessions — owned by Agent 04.
import type { PublicKey } from "@solana/web3.js";
import { getRegistry } from "./registry";
import { getDefaultSessionRepository, type SessionRepository } from "./repository";
import { buildSessionOverview, type SessionOverview } from "./overview";

export { buildCatalog } from "./catalog";
export { getRegistry, findRegistered, parseRegistry, presentationOf, type Registry, type RegistrySession } from "./registry";
export {
  SESSION_V1_SIZE,
  createSessionRepository,
  discoverV1SessionAccounts,
  legacyReader,
  ownAccount,
  parsePubkey,
  sessionTtlMs,
  validateSessionAccount,
  type RpcReader,
  type SessionRepository,
} from "./repository";
export { TOKEN_PROGRAM_ID, buildSessionOverview, currentScores, offerStatus, tokenAmount, type SessionOverview } from "./overview";

/** Process-wide repository over the checked-in registry (lazy, so importing has no side effects). */
export const sessionRepository: SessionRepository = {
  listRegistered: () => getDefaultSessionRepository().listRegistered(),
  get: (address: string) => getDefaultSessionRepository().get(address),
  getManyAccounts: (keys: readonly PublicKey[]) => getDefaultSessionRepository().getManyAccounts(keys),
};

export function getSessionOverview(address: string): Promise<SessionOverview> {
  return buildSessionOverview(address, { repository: sessionRepository, registry: getRegistry() });
}
