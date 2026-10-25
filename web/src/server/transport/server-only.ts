// Server-only guard. The `server-only` package is not a declared dependency (Agent 15 owns manifests),
// so fail loudly if a client bundle ever evaluates the transport.
if (typeof window !== "undefined") {
  throw new Error("@/server/transport is server-only and must not be imported by client code");
}
export {};
