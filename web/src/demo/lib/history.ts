// "My history": every finished demo run, saved in this browser only.
// Wrapped in try/catch because browser storage can be blocked (private mode etc.).
import { z } from "zod";
import {
  DEMO_WALLET_BALANCE,
  FINAL_SCORES,
  illustrativePayout,
  type Amounts,
} from "./demoData";

export type Run = {
  id: string;
  at: string; // ISO time the claim happened
  amounts: Amounts;
  put: number; // PLAY deposited
  back: number; // PLAY claimed
};

const KEY = "macropaths.runs.v2";
const NAME_KEY = "macropaths.name.v2";
const MAX_RUNS = 100;
const amountSchema = z.number().finite().nonnegative().max(DEMO_WALLET_BALANCE);
const runSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9_-]+$/),
    at: z.string().datetime({ offset: true }),
    amounts: z.tuple([amountSchema, amountSchema, amountSchema, amountSchema]),
    put: amountSchema.positive(),
    back: z.number().finite().nonnegative(),
  })
  .superRefine((run, context) => {
    const total = run.amounts.reduce((sum, amount) => sum + amount, 0);
    const validAmounts = run.amounts.every(
      (amount) =>
        Number.isFinite(amount) && amount >= 0 && amount <= DEMO_WALLET_BALANCE,
    );
    if (
      !validAmounts ||
      total > DEMO_WALLET_BALANCE ||
      Math.abs(total - run.put) > 0.00000001
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["put"],
        message: "Invalid demo position total",
      });
      return;
    }
    const payout = illustrativePayout(run.amounts, FINAL_SCORES);
    if (Math.abs(run.back - payout) > 0.00000001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["back"],
        message: "Result differs from the published rule",
      });
    }
  })
  .transform((run) => ({
    ...run,
    back: illustrativePayout(run.amounts, FINAL_SCORES),
  }));
const runsSchema = z.array(runSchema).max(MAX_RUNS);
// A display name for this browser's walkthrough, never an authentication credential.
const nameSchema = z
  .string()
  .max(512)
  .transform((name) =>
    name
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f<>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40),
  );

export const profitOf = (r: Run) => r.back - r.put;
export const pctOf = (r: Run) =>
  r.put > 0 ? ((r.back - r.put) / r.put) * 100 : 0;

export function loadRuns(): Run[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw || raw.length > 100_000) return [];
    const parsed = runsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: Run[]) {
  try {
    const parsed = runsSchema.safeParse(runs.slice(-MAX_RUNS));
    if (parsed.success)
      window.localStorage.setItem(KEY, JSON.stringify(parsed.data));
  } catch {
    /* storage unavailable: history lasts until refresh */
  }
}

export function loadName(): string {
  try {
    const parsed = nameSchema.safeParse(
      window.localStorage.getItem(NAME_KEY) ?? "",
    );
    return parsed.success ? parsed.data : "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    const parsed = nameSchema.safeParse(name);
    if (parsed.success) window.localStorage.setItem(NAME_KEY, parsed.data);
  } catch {
    /* ignore */
  }
}

// Plain-English description of which sides a run used.
export function sidesText(a: Amounts): string {
  const parts: string[] = [];
  if (a[0] > 0) parts.push(`More cooling ${a[0]}`);
  if (a[1] > 0) parts.push(`Less cooling ${a[1]}`);
  if (a[2] > 0) parts.push(`More excess ${a[2]}`);
  if (a[3] > 0) parts.push(`Less excess ${a[3]}`);
  return parts.join(" · ") || "No sides";
}

export function bestRun(runs: Run[]): Run | null {
  return runs.reduce<Run | null>(
    (best, r) => (!best || profitOf(r) > profitOf(best) ? r : best),
    null,
  );
}
