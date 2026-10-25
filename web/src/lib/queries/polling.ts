// Client freshness policy (api-and-architecture.md "Client query freshness").
// TanStack Query pauses refetchInterval while the document is hidden (refetchIntervalInBackground=false),
// which gives the "while visible" behavior. Client slot health is never polled.
import type { SessionState } from "@macropaths/client/types";

export const POLL_MS = {
  open: 15_000,
  running: 5_000,
  terminal: 60_000,
  wallet: 15_000,
} as const;

/** Session overview polling interval for a session state; no data yet means no polling. */
export function sessionPollInterval(state: SessionState | undefined): number | false {
  switch (state) {
    case "Open":
      return POLL_MS.open;
    case "Running":
      return POLL_MS.running;
    case "Settled":
    case "Refunding":
      return POLL_MS.terminal;
    default:
      return false;
  }
}
