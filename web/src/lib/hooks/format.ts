// Display formatting, integer-exact (bigint), mirroring the @macropaths/client format functions
// so the integrator can swap imports at merge.

/** Render v / 10^scale with `digits` decimals, rounding half away from zero, with thousands separators. */
export function fixed(v: string | bigint, scale: number, digits: number): string {
  let n = BigInt(v);
  const neg = n < 0n;
  if (neg) n = -n;
  const d = Math.max(0, Math.min(digits, scale));
  const drop = 10n ** BigInt(scale - d);
  n = (n + drop / 2n) / drop;
  const s = n.toString().padStart(d + 1, "0");
  const int = s.slice(0, s.length - d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = d ? "." + s.slice(s.length - d) : "";
  return (neg && n !== 0n ? "-" : "") + int + frac;
}

/** 1e-4 percentage points -> "3.25%". */
export function fmtPp(v: string | bigint, digits = 2): string {
  return `${fixed(v, 4, digits)}%`;
}
/** 1e-4 pp-months -> "69.12 pp-months". */
export function fmtPpMonths(v: string | bigint, digits = 2): string {
  return `${fixed(v, 4, digits)} pp-months`;
}
/** Millionths -> percent, "82.74%". */
export function fmtMillionthsPct(v: string | bigint, digits = 2): string {
  return `${fixed(v, 4, digits)}%`;
}
/** PLAY base units (6 decimals) -> "90.00 PLAY". */
export function fmtPlay(v: string | bigint, digits = 2): string {
  return `${fixed(v, 6, digits)} PLAY`;
}
/** YYYYMM -> "2024-12". */
export function fmtPeriod(periodId: number): string {
  const s = String(periodId);
  return `${s.slice(0, 4)}-${s.slice(4).padStart(2, "0")}`;
}
/** Unix seconds -> "2026-10-25 12:00:00 UTC". */
export function fmtTime(unix: number): string {
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
/** Shorten a pubkey or signature: "B89z...VBju". */
export function shortAddr(a: string, n = 4): string {
  return a.length <= n * 2 + 3 ? a : `${a.slice(0, n)}...${a.slice(-n)}`;
}
