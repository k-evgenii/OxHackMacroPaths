// The checked-in session registry (web/config/sessions.json): the single client allowlist.
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@macropaths/client";
import registryJson from "../../../config/sessions.json";

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Int = z.string().regex(/^-?\d+$/);

const RegistrySession = z.object({
  address: Base58,
  label: z.string().min(1),
  mode: z.literal("historical_replay"),
  layout: z.literal("v1"),
  programId: Base58,
  firstPeriodId: z.number().int().refine((p) => p % 100 >= 1 && p % 100 <= 12, "YYYYMM"),
  nObs: z.number().int().positive(),
  datasetId: z.string().regex(/^[0-9a-f]{64}$/),
  terms: z.object({ k: Int, dCap: Int, aCap: Int }),
  researchBundleId: z.string().min(1).nullable(),
});
export type RegistrySession = z.infer<typeof RegistrySession>;

const Registry = z
  .object({
    version: z.literal(1),
    cluster: z.string().min(1),
    defaultSession: Base58,
    sessions: z.array(RegistrySession).min(1),
    products: z.array(
      z.object({
        key: z.enum(["cooling", "excess", "fuel"]),
        name: z.string().min(1),
        description: z.string(),
        status: z.enum(["supported", "research"]),
        productIndex: z.union([z.literal(0), z.literal(1), z.null()]),
      }),
    ),
    research: z.object({ bundleId: z.string().min(1), path: z.literal("/api/artifacts/bundle") }).nullable(),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    for (const s of r.sessions) {
      if (seen.has(s.address)) ctx.addIssue({ code: "custom", message: `duplicate session ${s.address}` });
      seen.add(s.address);
      try {
        new PublicKey(s.address);
      } catch {
        ctx.addIssue({ code: "custom", message: `invalid session address ${s.address}` });
      }
    }
    if (!seen.has(r.defaultSession)) ctx.addIssue({ code: "custom", message: "defaultSession is not registered" });
  });
export type Registry = z.infer<typeof Registry>;

/** Parse and validate a registry document; throws with every issue on invalid configuration. */
export function parseRegistry(input: unknown): Registry {
  const r = Registry.safeParse(input);
  if (!r.success) throw new Error(`invalid session registry: ${r.error.issues.map((i) => i.message).join("; ")}`);
  for (const s of r.data.sessions)
    if (s.programId !== PROGRAM_ID.toBase58())
      throw new Error(`invalid session registry: ${s.address} names program ${s.programId}, client is ${PROGRAM_ID.toBase58()}`);
  return r.data;
}

let loaded: Registry | undefined;
/** The checked-in registry, validated once per process. */
export function getRegistry(): Registry {
  loaded ??= parseRegistry(registryJson);
  return loaded;
}

export function findRegistered(registry: Registry, address: string): RegistrySession | undefined {
  return registry.sessions.find((s) => s.address === address);
}

/** Presentation-safe metadata for a registered session (catalog and overview). */
export function presentationOf(s: RegistrySession) {
  return {
    label: s.label,
    mode: s.mode,
    layout: s.layout,
    firstPeriodId: s.firstPeriodId,
    researchBundleId: s.researchBundleId,
  };
}
