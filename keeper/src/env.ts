/**
 * Keeper environment: loads .env, exposes typed config, keypair and connection.
 *
 * SECRET HANDLING: RPC_URL embeds a paid API key (in the query string for
 * Helius, in the path for QuickNode). Nothing in this module ever prints or
 * throws a variable's value. Errors name the variable only; URLs are reduced
 * to their hostname via `redactUrl`.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { Connection, Keypair, type Commitment } from "@solana/web3.js";

/** Files/dirs that mark the repository root. */
const ROOT_MARKERS = ["pixi.toml", ".git"];

export class EnvError extends Error {
  constructor(
    public readonly variable: string,
    message: string,
  ) {
    super(`${variable}: ${message}`);
    this.name = "EnvError";
  }
}

/** Walk up from `start` to the first directory containing a root marker. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (ROOT_MARKERS.some((m) => existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start); // no marker: fall back to start
    dir = parent;
  }
}

/**
 * Find the .env to load: an explicit DOTENV_PATH wins; otherwise walk up from
 * the cwd to the repo root (inclusive) and take the first `.env` found.
 */
function findDotenv(repoRoot: string): string | undefined {
  const explicit = process.env.DOTENV_PATH;
  if (explicit !== undefined && explicit !== "") {
    const p = path.resolve(expandHome(explicit));
    if (!existsSync(p)) throw new EnvError("DOTENV_PATH", "file does not exist");
    return p;
  }
  let dir = path.resolve(process.cwd());
  const root = path.resolve(repoRoot);
  for (;;) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let loaded: { repoRoot: string; dotenvPath: string | undefined } | undefined;

/** Load .env once (idempotent). Existing process.env values take precedence. */
export function loadEnv(): { repoRoot: string; dotenvPath: string | undefined } {
  if (loaded) return loaded;
  const repoRoot = findRepoRoot();
  const dotenvPath = findDotenv(repoRoot);
  if (dotenvPath) {
    // quiet: dotenv must not print anything about the file it loads.
    const res = dotenv.config({ path: dotenvPath, quiet: true });
    if (res.error) throw new EnvError("DOTENV_PATH", "failed to parse env file");
  }
  loaded = { repoRoot, dotenvPath };
  return loaded;
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/** Reduce a URL to something safe to print: protocol + hostname only. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return "<unparseable url>";
  }
}

export interface KeeperConfig {
  /** Full RPC URL. SECRET: never log; use `rpcHost` for display. */
  readonly RPC_URL: string;
  /** Hostname of RPC_URL; safe to print. */
  readonly rpcHost: string;
  /** Absolute path to the keeper keypair JSON (after ~ expansion). */
  readonly KEEPER_KEYPAIR: string;
  readonly repoRoot: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new EnvError(name, "is not set (see .env.example)");
  }
  return v.trim();
}

function parseRpcUrl(raw: string): { url: string; host: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new EnvError("RPC_URL", "is not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new EnvError("RPC_URL", `must be http(s) (host ${u.hostname || "<none>"})`);
  }
  return { url: raw, host: u.hostname };
}

let cached: KeeperConfig | undefined;

/** Typed, validated config. Throws EnvError naming the bad variable. */
export function getConfig(): KeeperConfig {
  if (cached) return cached;
  const { repoRoot } = loadEnv();
  const rpc = parseRpcUrl(required("RPC_URL"));
  const kp = expandHome(required("KEEPER_KEYPAIR"));
  cached = {
    RPC_URL: rpc.url,
    rpcHost: rpc.host,
    KEEPER_KEYPAIR: path.isAbsolute(kp) ? kp : path.resolve(repoRoot, kp),
    repoRoot,
  };
  return cached;
}

/** Read KEEPER_KEYPAIR (a solana-keygen JSON array of 64 bytes) into a Keypair. */
export function loadKeypair(file: string = getConfig().KEEPER_KEYPAIR): Keypair {
  if (!existsSync(file)) throw new EnvError("KEEPER_KEYPAIR", "file does not exist");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new EnvError("KEEPER_KEYPAIR", "file is not valid JSON");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  ) {
    throw new EnvError("KEEPER_KEYPAIR", "file must be a JSON array of 64 bytes");
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  } catch {
    throw new EnvError("KEEPER_KEYPAIR", "bytes are not a valid ed25519 secret key");
  }
}

export function getConnection(commitment: Commitment = "confirmed"): Connection {
  return new Connection(getConfig().RPC_URL, { commitment });
}

/** Human-readable env status. Never includes secret values. */
export function describeEnv(): string[] {
  const lines: string[] = [];
  let repoRoot: string;
  try {
    const l = loadEnv();
    repoRoot = l.repoRoot;
    lines.push(`env file: ${l.dotenvPath ? "loaded" : "none found (using process env)"}`);
  } catch (e) {
    return [`env file: ${e instanceof Error ? e.message : "error"}`];
  }

  const rawRpc = process.env.RPC_URL?.trim();
  if (!rawRpc) lines.push("RPC_URL: NOT SET");
  else {
    try {
      lines.push(`RPC_URL: set (host ${parseRpcUrl(rawRpc).host})`);
    } catch (e) {
      lines.push(`RPC_URL: set but invalid (${e instanceof EnvError ? e.message : "error"})`);
    }
  }

  const rawKp = process.env.KEEPER_KEYPAIR?.trim();
  if (!rawKp) lines.push("KEEPER_KEYPAIR: NOT SET");
  else {
    const kp = expandHome(rawKp);
    const abs = path.isAbsolute(kp) ? kp : path.resolve(repoRoot, kp);
    try {
      lines.push(`KEEPER_KEYPAIR: set, pubkey ${loadKeypair(abs).publicKey.toBase58()}`);
    } catch (e) {
      lines.push(`KEEPER_KEYPAIR: set but unusable (${e instanceof Error ? e.message : "error"})`);
    }
  }
  return lines;
}
