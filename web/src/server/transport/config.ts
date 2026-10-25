// Lazy server-side RPC configuration. Reading happens on first live use, never at module load,
// so fixture mode and build-time route discovery need no credentials and open no connection.
import "./server-only";
import { RpcConfigError } from "./errors";

export type RpcConfig = { url: string };

/** Read and validate RPC_URL from the given environment. Throws RpcConfigError (sanitized) when absent/invalid. */
export function readRpcConfig(env: Record<string, string | undefined> = process.env): RpcConfig {
  const url = env.RPC_URL?.trim();
  if (!url) throw new RpcConfigError("RPC_URL is not set. Configure a server-side Solana RPC endpoint for live reads.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RpcConfigError("RPC_URL is not a valid http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new RpcConfigError("RPC_URL is not a valid http(s) URL.");
  return { url };
}

/** Host only, for diagnostics. Never log the full URL (paths/queries commonly carry API keys). */
export function describeEndpoint(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "[invalid]";
  }
}
