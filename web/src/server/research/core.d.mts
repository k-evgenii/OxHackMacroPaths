// Types for core.mjs (the shared JS implementation used by the server and the node publication scripts).
export declare const SCHEMA_VERSION: 1;
export declare const FILES: readonly ["manifest", "forecast", "planner"];
export type ArtifactName = (typeof FILES)[number];
export type ResearchProductKey = "cooling" | "excess" | "fuel";
export type ResearchUnits = "1e-4-pp" | "1e-4-pp-months" | "1e-4-usd-months";
export type BundleErrorCode =
  | "missing_file"
  | "malformed_json"
  | "schema"
  | "inconsistent"
  | "unsupported_product"
  | "unsafe_integer"
  | "identity_mismatch";

export declare const SUPPORTED: Record<
  ResearchProductKey,
  { index: number | null; executable: boolean; capUnits: string; units: ResearchUnits }
>;

export declare class BundleError extends Error {
  readonly code: BundleErrorCode;
  constructor(code: BundleErrorCode, message: string);
}

export type BundleHashes = { manifest: string; forecast: string; planner: string };
export type ResearchTerm = {
  key: ResearchProductKey;
  threshold: string | null;
  cap: string;
  units: ResearchUnits;
  quoteMillionths: string;
  researchOnly: boolean;
};
/** Mirrors the frozen ResearchBundle contract; manifest/forecast/planner are the raw (legacy-shaped) artifacts. */
export type BuiltBundle = {
  id: string;
  schemaVersion: 1;
  metadata: {
    generatedAt: string | null;
    modelCurrency: "USD";
    moneyMeaning: "illustrative";
    hashes: BundleHashes;
    associatedSession: string | null;
  };
  terms: ResearchTerm[];
  manifest: Record<string, unknown>;
  forecast: Record<string, unknown>;
  planner: Record<string, unknown>;
};
export type BundleIdentity = { id: string; schemaVersion: 1; hashes: BundleHashes };
export type SessionTermsForAssociation = {
  address: string;
  k: string;
  dCap: string;
  aCap: string;
  nObs: number;
  datasetId: string | null;
  replayVerified: boolean;
};

export declare function sha256(text: string): string;
export declare function contentHash(text: string): string;
export declare function bundleIdOf(hashes: BundleHashes): string;
export declare function exactIntString(value: unknown, what: string): string;
export declare function buildBundle(
  texts: Partial<Record<ArtifactName, string>>,
  opts?: { associatedSession?: string | null },
): BuiltBundle;
export declare function associateSession(bundle: BuiltBundle, session: SessionTermsForAssociation): string | null;
export declare function identityOf(bundle: BuiltBundle): BundleIdentity;
