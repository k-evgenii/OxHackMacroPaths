// Typed RPC transport failures. Server-only.
import "./server-only";

export type RpcFailureKind =
  | "rate_limited" // HTTP 429 after retries / budget exhausted
  | "timeout" // a per-attempt five-second timeout fired
  | "deadline" // the caller's request budget cannot fit another attempt
  | "aborted" // the caller cancelled
  | "transient" // network failure or retryable upstream 5xx
  | "upstream" // deterministic upstream rejection (4xx other than 429, JSON-RPC error)
  | "config" // missing or invalid server RPC configuration
  | "unknown";

const RETRYABLE: ReadonlySet<RpcFailureKind> = new Set(["rate_limited", "timeout", "deadline", "transient"]);

/**
 * Thrown for any failure talking to the RPC node; the API maps it to 502 rpc_error.
 * `message` is sanitized (no URLs / credentials). `cause` keeps the original for server diagnostics.
 * `retryable` tells history code the work is pending/retryable rather than a hard failure.
 */
export class RpcFailure extends Error {
  readonly kind: RpcFailureKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly attempts: number;
  constructor(
    message: string,
    readonly cause?: unknown,
    info: { kind?: RpcFailureKind; status?: number; retryAfterMs?: number; attempts?: number } = {},
  ) {
    super(redact(message));
    this.name = "RpcFailure";
    this.kind = info.kind ?? "unknown";
    this.status = info.status;
    this.retryAfterMs = info.retryAfterMs;
    this.attempts = info.attempts ?? 0;
  }
  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

/** Thrown when live RPC is needed but RPC_URL is not configured. */
export class RpcConfigError extends RpcFailure {
  constructor(message: string) {
    super(message, undefined, { kind: "config" });
    this.name = "RpcConfigError";
  }
}

/** Strip URLs (which may carry API keys in path or query) and obvious key=value tokens from text. */
export function redact(text: string): string {
  return text
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi, "[rpc-url]")
    .replace(/((?:api[-_]?key|token|secret|auth)[=:]\s*)[^\s&"']+/gi, "$1[redacted]");
}
