// Research caps (nearest-rank p90 of history, from public/data/manifest.json) and the research scores computed
// against them are a research-only parameterisation. A session scores against the terms in its own account
// (reference session: d_cap 8 pp, a_cap 80 pp·mo), so every research cap or score the UI shows is labelled as
// research and, when a session is in context, carries the session's own cap beside it.
import type { SessionView } from "@macropaths/client";
import type { ManifestProduct } from "@/lib/artifacts";
import { fixed, fmtMillionthsPct, shortAddr } from "@/lib/hooks/format";

export const RESEARCH_CAP = "research p90 cap";
export const RESEARCH_ILLUSTRATION = "research illustration";

type SessionTerms = Pick<SessionView, "address" | "terms">;
type Product = Pick<ManifestProduct, "index" | "cap" | "cap_units">;

/** Manifest cap_units -> display unit: "1e-4 pp-months" -> "pp·mo". */
const UNIT: Record<string, string> = { "1e-4 pp": "pp", "1e-4 pp-months": "pp·mo", "1e-4 usd-months": "usd·mo" };
const capUnit = (capUnits: string) => UNIT[capUnits] ?? capUnits.replace(/^1e-4 /, "");

/** 1e-4 units -> "8 pp", "7.6973 pp", "188.3141 pp·mo" (trailing zeros dropped). */
export function fmtCap(raw: string | number | bigint, unit: string): string {
  return `${fixed(typeof raw === "number" ? BigInt(raw) : raw, 4, 4).replace(/[.]?0+$/, "")} ${unit}`;
}

/** The manifest's p90 cap for a product, e.g. "188.3141 pp·mo". */
export const researchCap = (p: Pick<Product, "cap" | "cap_units">) => fmtCap(p.cap, capUnit(p.cap_units));

/**
 * The cap the session scores this product against: on-chain product 0 (Inflation Cooling) uses d_cap in pp,
 * product 1 (Excess Inflation) uses a_cap in pp·mo (PRODUCT_NAMES order). Research-only products have none.
 */
export function sessionCap(p: Pick<Product, "index">, s: SessionTerms): string | null {
  if (p.index === 0) return fmtCap(s.terms.dCap, "pp");
  if (p.index === 1) return fmtCap(s.terms.aCap, "pp·mo");
  return null;
}

/** "session B89z...BVju cap 8 pp", "no on-chain cap" for research-only products, null without a session. */
export function sessionCapText(p: Pick<Product, "index">, s?: SessionTerms): string | null {
  if (p.index === null) return "no on-chain cap";
  if (!s) return null;
  const own = sessionCap(p, s);
  return own ? `session ${shortAddr(s.address)} cap ${own}` : null;
}

/** The session's own terms and scores in one line, for notes beside research scores. */
export function sessionTermsText(s: SessionTerms & Pick<SessionView, "scores">): string {
  const t = s.terms;
  return `session ${shortAddr(s.address)} (k ${fmtCap(t.k, "pp")}, d_cap ${fmtCap(t.dCap, "pp")}, a_cap ${fmtCap(t.aCap, "pp·mo")}) scored ${fmtMillionthsPct(s.scores[0])} / ${fmtMillionthsPct(s.scores[1])} against its own terms`;
}

/** "research p90 cap 7.6973 pp · session B89z...BVju cap 8 pp" */
export function ResearchCap({ p, session, className = "" }: { p: Product; session?: SessionTerms; className?: string }) {
  const own = sessionCapText(p, session);
  return (
    <span className={`num ${className}`}>
      {RESEARCH_CAP} {researchCap(p)}
      {own ? ` · ${own}` : null}
    </span>
  );
}
