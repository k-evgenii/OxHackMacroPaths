// Stand-in formatting (bigint/string based) until @macropaths/client format.ts lands (fe-01).

/** Divide a decimal integer string by 10^decimals, trimming trailing zeros. "827387",4 -> "82.7387". */
export function fixed(v: string | bigint, decimals: number, maxFrac = decimals): string {
  let n = BigInt(v);
  const neg = n < 0n;
  if (neg) n = -n;
  const base = 10n ** BigInt(decimals);
  const int = n / base;
  const frac = (n % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + intStr + (frac ? "." + frac : "");
}
/** 1e-4 pp -> "1.3997 %" */
export const pct4 = (v: string | bigint) => `${fixed(v, 4)} %`;
/** 1e-4 pp-months -> "69.1184 pp·mo" */
export const ppMonths = (v: string | bigint) => `${fixed(v, 4)} pp·mo`;
/** millionths -> percent: 827387 -> "82.7387 %" */
export const millionthsPct = (v: string | bigint) => `${fixed(v, 4)} %`;
/** PLAY base units (6 decimals) -> "148.92966 PLAY" */
export const play = (v: string | bigint) => `${fixed(v, 6)} PLAY`;
/** YYYYMM -> "2021-01" */
export const period = (p: number) => `${Math.floor(p / 100)}-${String(p % 100).padStart(2, "0")}`;
export const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
