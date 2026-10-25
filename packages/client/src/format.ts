// Display strings only; never feed results back into math. Pure bigint/string arithmetic.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Fixed-point `v / 10^scale` with `digits` decimals (clamped to scale), rounded half away from zero. */
function fixed(v: string | bigint, scale: number, digits: number): string {
  const n = BigInt(v);
  const d = Math.max(0, Math.min(Math.trunc(digits), scale));
  const drop = 10n ** BigInt(scale - d);
  const a = ((n < 0n ? -n : n) + drop / 2n) / drop;
  const unit = 10n ** BigInt(d);
  const int = (a / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = d > 0 ? "." + (a % unit).toString().padStart(d, "0") : "";
  return (n < 0n && a !== 0n ? "-" : "") + int + frac;
}

/** 1e-4 percentage points -> "1.40 %". */
export function fmtPp(v: string | bigint, digits = 2): string {
  return `${fixed(v, 4, digits)} %`;
}
/** 1e-4 pp-months -> "69.12 pp·months". */
export function fmtPpMonths(v: string | bigint, digits = 2): string {
  return `${fixed(v, 4, digits)} pp·months`;
}
/** Millionths -> "82.7387 %". */
export function fmtMillionthsPct(v: string | bigint, digits = 4): string {
  return `${fixed(v, 4, digits)} %`;
}
/** PLAY base units (6 decimals) -> "148.93 PLAY". */
export function fmtPlay(v: string | bigint, digits = 2): string {
  return `${fixed(v, 6, digits)} PLAY`;
}
/** 202101 -> "Jan 2021". */
export function fmtPeriod(periodId: number): string {
  const m = periodId % 100;
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${Math.floor(periodId / 100)}` : String(periodId);
}

// ---- frontend v2 shared exact formatters (interfaces.md "Exact helper exports") ----

/** Signed difference in 1e-4 percentage points -> "+1.40 pp" / "-0.25 pp" / "0.00 pp". */
export function fmtPpDifference(v: string | bigint, digits = 2): string {
  const s = fixed(v, 4, digits);
  const zero = !/[1-9]/.test(s);
  return `${!zero && !s.startsWith("-") ? "+" : ""}${zero ? s.replace(/^-/, "") : s} pp`;
}
/** 1e-4 pp-months -> "69.1 point-months" (plain-language accumulated excess). */
export function fmtPointMonths(v: string | bigint, digits = 1): string {
  return `${fixed(v, 4, digits)} point-months`;
}
/** Quote price in millionths -> PLAY paid per one PLAY of maximum payout, e.g. "0.057153 PLAY". */
export function fmtQuotePlay(v: string | bigint, digits = 6): string {
  return `${fixed(v, 6, digits)} PLAY`;
}
