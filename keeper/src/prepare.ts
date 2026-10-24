/**
 * prepare.ts: CPI-U (NSA) index levels to the traded YoY series x_t.
 *
 * Source of truth: docs/macropaths-maths.pdf section 1, eq. (1):
 *
 *   x_t = floor( 10^6 * (P_t - P_{t-12}) / P_{t-12} ),  t = 0..47
 *
 * where P_{-12..47} are the 60 monthly CPIAUCNS levels Jan 2020 .. Dec 2024,
 * so x_0 is Jan 2021 and x_47 is Dec 2024. Units are 1e-4 percentage points
 * (3.25% -> 32500). floor is the mathematical floor (Rust div_euclid for a
 * positive divisor), so negative inflation rounds towards -infinity.
 *
 * Everything here is exact integer arithmetic on BigInt. Index levels are
 * parsed from their decimal strings, never through Number/parseFloat.
 * Node built-ins only, no dependencies.
 *
 * It also builds the commitment chain of docs/commitment-chain.md (v1):
 * dataset_id, C_i for i = N-1..0, C_0 and C_N, with little-endian integers,
 * u32-length-prefixed UTF-8 strings, raw ASCII tags and SHA-256. The result
 * is written to data/cpi-yoy-replay.json (override with --out) for the
 * keeper's create_session and replay steps.
 *
 * CLI:
 *   npx tsx keeper/src/prepare.ts [--snapshot p] [--out p] [--check tests/vectors.json]
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Indexed read that fails loudly instead of yielding undefined (noUncheckedIndexedAccess). */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range (length ${arr.length})`);
  return v;
}

// ---------------------------------------------------------------------------
// Types

export interface SnapshotRow {
  date: string;
  value_str: string;
}

export interface Snapshot {
  id?: string;
  source?: string;
  source_url?: string;
  retrieved_at?: string;
  sha256_of_raw?: string;
  frequency?: string;
  units?: string;
  rows: SnapshotRow[];
}

/** One traded observation. x is an exact integer in 1e-4 pp. */
export interface Row {
  t: number;
  date: string;
  x: bigint;
}

/** A level in the 60-month window, kept as its original string plus exact value. */
export interface Level {
  /** Index into P, i.e. -12..47. */
  i: number;
  date: string;
  value_str: string;
  /** value_str * 10^scale, exact. */
  scaled: bigint;
}

export interface Prepared {
  /** 60 levels, P_{-12} .. P_{47}. */
  levels: Level[];
  /** Common decimal scale used for `scaled`. */
  scale: number;
  /** 48 rows, t = 0..47. */
  rows: Row[];
  /** Commitment chain v1 over the levels and rows. */
  commitment: Commitment;
}

/** Inputs to dataset_id, in the order docs/commitment-chain.md hashes them. */
export interface DatasetParams {
  seriesId: string;
  sourceUrl: string;
  windowStart: string;
  windowEnd: string;
  transformId: string;
  /** Level strings exactly as published, in date order. */
  levels: readonly string[];
  N: bigint | number;
  firstPeriodId: bigint | number;
  K: bigint | number;
  D_cap: bigint | number;
  A_cap: bigint | number;
}

/** One chain input: observation i with its period id and value. */
export interface ChainObs {
  i: bigint | number;
  periodId: bigint | number;
  value: bigint;
}

export interface ChainResult {
  /** C[i] for i = 0..N; C[N] is C_N, C[0] is C_0. */
  C: Buffer[];
  /** 91-byte preimage of C_i, i = 0..N-1. */
  preimages: Buffer[];
  /** 47-byte preimage of C_N. */
  endPreimage: Buffer;
}

export interface Commitment {
  params: DatasetParams;
  datasetPreimage: Buffer;
  datasetId: Buffer;
  /** Chain inputs, one per row. */
  obs: { i: number; periodId: number; value: bigint }[];
  chain: ChainResult;
}

// ---------------------------------------------------------------------------
// Constants

export const WINDOW_START = { year: 2020, month: 1 }; // P_{-12}
export const WINDOW_MONTHS = 60; // P_{-12} .. P_{47}
export const LAG = 12;
export const N_ROWS = WINDOW_MONTHS - LAG; // 48
export const SCALE_X = 1_000_000n; // 10^6
export const K_EXCESS = 40_000n; // 4% in 1e-4 pp (eq. 4)

const MAX_SAFE = 2n ** 53n;

// Commitment chain v1 (docs/commitment-chain.md)
export const CHAIN_SPEC = "docs/commitment-chain.md";
export const CHAIN_VERSION = "v1";
export const SERIES_ID = "CPIAUCNS";
export const SOURCE_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS";
export const TRANSFORM_ID = "yoy-1e6-floor-v1";
export const D_CAP = 80_000n; // 8 pp
export const A_CAP = 800_000n; // 80 pp-months
export const TAG_DATASET = "PATH-DATASET-v1";
export const TAG_OBS = "PATH-OBS-v1";
export const TAG_END = "PATH-END-v1";
export const OBS_PREIMAGE_LEN = 91;
export const END_PREIMAGE_LEN = 47;

// ---------------------------------------------------------------------------
// Exact integer helpers

/**
 * Mathematical floor of a / b (div_euclid semantics for b > 0).
 * BigInt `/` truncates toward zero, so it is corrected when the true
 * quotient is negative and inexact.
 */
export function floorDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("floorDiv: division by zero");
  const q = a / b; // truncates toward zero
  const r = a % b; // has the sign of a
  // When the remainder is non-zero and a, b have opposite signs, the true
  // quotient is negative and inexact; truncation rounded it up, so subtract 1.
  if (r !== 0n && (r < 0n) !== (b < 0n)) return q - 1n;
  return q;
}

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a plain non-negative decimal string ("257.971", "9.8", "100") into
 * { digits, scale } with value = digits / 10^scale. No sign, exponent,
 * whitespace, leading "." or trailing "." is accepted.
 */
export function parseDecimal(s: string): { digits: bigint; scale: number } {
  if (typeof s !== "string") throw new TypeError(`not a string: ${String(s)}`);
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new Error(`not a plain non-negative decimal: ${JSON.stringify(s)}`);
  const frac = m[2] ?? "";
  return { digits: BigInt(m[1] + frac), scale: frac.length };
}

/** digits / 10^from rescaled to / 10^to (to >= from), exact. */
function rescale(digits: bigint, from: number, to: number): bigint {
  if (to < from) throw new Error("rescale: target scale smaller than source");
  return digits * 10n ** BigInt(to - from);
}

/** The transform of eq. (1) for one pair of exact levels at a common scale. */
export function yoy(pNow: bigint, pLag: bigint): bigint {
  if (pLag <= 0n) throw new Error(`non-positive base level ${pLag}`);
  return floorDiv(SCALE_X * (pNow - pLag), pLag);
}

// ---------------------------------------------------------------------------
// Window selection

function monthDate(offset: number): string {
  const total = WINDOW_START.year * 12 + (WINDOW_START.month - 1) + offset;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

/** The 60 expected dates, 2020-01-01 .. 2024-12-01. */
export function windowDates(): string[] {
  return Array.from({ length: WINDOW_MONTHS }, (_, k) => monthDate(k));
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "" || v === ".";
}

/**
 * Select P_{-12}..P_{47} by date. Throws unless every month 2020-01..2024-12
 * is present exactly once with a non-empty value, and nothing else in that
 * date range is present.
 */
export function selectLevels(snapshot: Snapshot): { levels: Level[]; scale: number } {
  if (!snapshot || !Array.isArray(snapshot.rows)) {
    throw new Error("snapshot has no rows array");
  }
  const dates = windowDates();
  const first = at(dates, 0);
  const last = at(dates, dates.length - 1);

  const inWindow = snapshot.rows.filter(
    (r) => typeof r?.date === "string" && r.date >= first && r.date <= last,
  );
  const byDate = new Map<string, SnapshotRow[]>();
  for (const r of inWindow) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  const problems: string[] = [];
  const expected = new Set(dates);
  for (const d of byDate.keys()) {
    if (!expected.has(d)) problems.push(`unexpected date in window: ${d}`);
  }
  for (const d of dates) {
    const list = byDate.get(d);
    if (!list) problems.push(`missing month: ${d}`);
    else if (list.length > 1) problems.push(`duplicate month: ${d} (${list.length} rows)`);
    else if (isMissing(at(list, 0).value_str)) {
      problems.push(`empty value for ${d}: ${JSON.stringify(at(list, 0).value_str)}`);
    }
  }
  if (inWindow.length !== WINDOW_MONTHS) {
    problems.push(`expected ${WINDOW_MONTHS} rows in ${first}..${last}, found ${inWindow.length}`);
  }
  if (problems.length) {
    throw new Error(`snapshot window check failed:\n  ${problems.join("\n  ")}`);
  }

  const parsed = dates.map((d) => {
    const value_str = at(byDate.get(d)!, 0).value_str;
    let p;
    try {
      p = parseDecimal(value_str);
    } catch (e) {
      throw new Error(`${d}: ${(e as Error).message}`);
    }
    return { date: d, value_str, ...p };
  });
  const scale = Math.max(...parsed.map((p) => p.scale));
  const levels: Level[] = parsed.map((p, k) => ({
    i: k - LAG,
    date: p.date,
    value_str: p.value_str,
    scaled: rescale(p.digits, p.scale, scale),
  }));
  return { levels, scale };
}

// ---------------------------------------------------------------------------
// Commitment chain v1 (docs/commitment-chain.md)

export const U32_MAX = 2n ** 32n - 1n;
export const I64_MIN = -(2n ** 63n);
export const I64_MAX = 2n ** 63n - 1n;
export const U64_MAX = 2n ** 64n - 1n;

function toBig(x: bigint | number, name: string): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number" && Number.isSafeInteger(x)) return BigInt(x);
  throw new TypeError(`${name}: not an integer: ${String(x)}`);
}

/** n-byte little-endian of 0 <= x < 256^n, written byte by byte. */
function le(x: bigint, n: number): Buffer {
  const out = Buffer.alloc(n);
  let v = x;
  for (let k = 0; k < n; k++) {
    out[k] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new RangeError(`le: ${x} does not fit in ${n} bytes`);
  return out;
}

function ranged(x: bigint | number, name: string, lo: bigint, hi: bigint): bigint {
  const v = toBig(x, name);
  if (v < lo || v > hi) throw new RangeError(`${name}: ${v} outside ${lo}..${hi}`);
  return v;
}

/** u32(x): 4 bytes little-endian, 0..2^32-1. */
export function u32(x: bigint | number): Buffer {
  return le(ranged(x, "u32", 0n, U32_MAX), 4);
}

/** i64(x): 8 bytes little-endian two's complement, -2^63..2^63-1. */
export function i64(x: bigint | number): Buffer {
  const v = ranged(x, "i64", I64_MIN, I64_MAX);
  return le(v < 0n ? v + 2n ** 64n : v, 8);
}

/** u64(x): 8 bytes little-endian, 0..2^64-1. */
export function u64(x: bigint | number): Buffer {
  return le(ranged(x, "u64", 0n, U64_MAX), 8);
}

/** str(s): u32(byte length) followed by the UTF-8 bytes of s. */
export function str(s: string): Buffer {
  if (typeof s !== "string") throw new TypeError(`str: not a string: ${String(s)}`);
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u32(b.length), b]);
}

/** Raw ASCII tag, no length prefix, no NUL. */
function tag(s: string): Buffer {
  if (!/^[\x20-\x7e]+$/.test(s)) throw new Error(`tag is not printable ASCII: ${JSON.stringify(s)}`);
  return Buffer.from(s, "ascii");
}

export function sha256(...parts: Buffer[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

/** "2021-01-01" -> 202101. */
export function periodId(date: string): number {
  const m = /^(\d{4})-(\d{2})-01$/.exec(date);
  if (!m) throw new Error(`periodId: bad date ${JSON.stringify(date)}`);
  return Number(m[1]) * 100 + Number(m[2]);
}

/** The dataset_id preimage bytes, in spec order. */
export function datasetPreimage(p: DatasetParams): Buffer {
  return Buffer.concat([
    str(TAG_DATASET),
    str(p.seriesId),
    str(p.sourceUrl),
    str(p.windowStart),
    str(p.windowEnd),
    str(p.transformId),
    u32(p.levels.length),
    ...p.levels.map((l) => str(l)),
    u32(p.N),
    u32(p.firstPeriodId),
    i64(p.K),
    u64(p.D_cap),
    u64(p.A_cap),
  ]);
}

/** dataset_id = SHA256(dataset preimage). */
export function datasetId(p: DatasetParams): { id: Buffer; preimage: Buffer } {
  const preimage = datasetPreimage(p);
  return { id: sha256(preimage), preimage };
}

/** "PATH-END-v1" || dataset_id || u32(N), 47 bytes. */
export function endPreimage(dsId: Buffer, N: bigint | number): Buffer {
  if (dsId.length !== 32) throw new Error(`dataset_id must be 32 bytes, got ${dsId.length}`);
  const pre = Buffer.concat([tag(TAG_END), dsId, u32(N)]);
  if (pre.length !== END_PREIMAGE_LEN) throw new Error(`C_N preimage is ${pre.length} bytes`);
  return pre;
}

/** "PATH-OBS-v1" || dataset_id || u32(i) || u32(period_id) || i64(value) || C_{i+1}, 91 bytes. */
export function obsPreimage(dsId: Buffer, o: ChainObs, next: Buffer): Buffer {
  if (dsId.length !== 32) throw new Error(`dataset_id must be 32 bytes, got ${dsId.length}`);
  if (next.length !== 32) throw new Error(`C_{i+1} must be 32 bytes, got ${next.length}`);
  const pre = Buffer.concat([tag(TAG_OBS), dsId, u32(o.i), u32(o.periodId), i64(o.value), next]);
  if (pre.length !== OBS_PREIMAGE_LEN) throw new Error(`C_i preimage is ${pre.length} bytes`);
  return pre;
}

/**
 * The chain C_N, C_{N-1}, ..., C_0, computed from i = N-1 down to 0.
 * obs[k].i must equal k; N = obs.length.
 */
export function chain(dsId: Buffer, obs: readonly ChainObs[]): ChainResult {
  const N = obs.length;
  const endPre = endPreimage(dsId, N);
  const C: Buffer[] = new Array<Buffer>(N + 1);
  const preimages: Buffer[] = new Array<Buffer>(N);
  C[N] = sha256(endPre);
  for (let k = N - 1; k >= 0; k--) {
    const o = at(obs, k);
    if (toBig(o.i, "i") !== BigInt(k)) throw new Error(`chain: obs[${k}].i = ${o.i}`);
    const pre = obsPreimage(dsId, o, at(C, k + 1));
    preimages[k] = pre;
    C[k] = sha256(pre);
  }
  return { C, preimages, endPreimage: endPre };
}

/**
 * Walk the chain forward the way `observe` does: current = C_0; for each i
 * the keeper supplies C_{i+1}, the hash must equal current, then
 * current = C_{i+1}. Returns -1 if every step passes and the walk ends at
 * C_N, otherwise the index of the first failing step (N if only the end fails).
 */
export function walkForward(dsId: Buffer, obs: readonly ChainObs[], C: readonly Buffer[]): number {
  let current = at(C, 0);
  for (let k = 0; k < obs.length; k++) {
    const next = at(C, k + 1);
    if (!sha256(obsPreimage(dsId, at(obs, k), next)).equals(current)) return k;
    current = next;
  }
  return current.equals(sha256(endPreimage(dsId, obs.length))) ? -1 : obs.length;
}

/** Commitment for the prepared window, with the CPI demo term sheet. */
export function buildCommitment(
  snapshot: Snapshot,
  levels: readonly Level[],
  rows: readonly Row[],
): Commitment {
  const seriesId = snapshot.id ?? SERIES_ID;
  const sourceUrl = snapshot.source_url ?? SOURCE_URL;
  if (seriesId !== SERIES_ID) throw new Error(`snapshot id ${seriesId} != ${SERIES_ID}`);
  if (sourceUrl !== SOURCE_URL) throw new Error(`snapshot source_url ${sourceUrl} != ${SOURCE_URL}`);
  const obs = rows.map((r) => ({ i: r.t, periodId: periodId(r.date), value: r.x }));
  const params: DatasetParams = {
    seriesId,
    sourceUrl,
    windowStart: at(levels, 0).date,
    windowEnd: at(levels, levels.length - 1).date,
    transformId: TRANSFORM_ID,
    levels: levels.map((l) => l.value_str),
    N: rows.length,
    firstPeriodId: at(obs, 0).periodId,
    K: K_EXCESS,
    D_cap: D_CAP,
    A_cap: A_CAP,
  };
  const { id, preimage } = datasetId(params);
  return { params, datasetPreimage: preimage, datasetId: id, obs, chain: chain(id, obs) };
}

/** JSON integer policy: a JSON number when |v| < 2^53, otherwise a decimal string. */
export function jsonInt(v: bigint | number): number | string {
  const b = toBig(v, "jsonInt");
  return b < MAX_SAFE && b > -MAX_SAFE ? Number(b) : b.toString();
}

/** The `commitment` and `chain` sections in the tests/vectors.json shape. */
export function commitmentToVectors(c: Commitment): { commitment: any; chain: any[] } {
  const N = c.obs.length;
  return {
    commitment: {
      spec: CHAIN_SPEC,
      version: CHAIN_VERSION,
      dataset_id: c.datasetId.toString("hex"),
      dataset_preimage_hex: c.datasetPreimage.toString("hex"),
      dataset_preimage_len: c.datasetPreimage.length,
      N,
      first_period_id: jsonInt(c.params.firstPeriodId),
      K: jsonInt(c.params.K),
      D_cap: jsonInt(c.params.D_cap),
      A_cap: jsonInt(c.params.A_cap),
      transform_id: c.params.transformId,
      series_id: c.params.seriesId,
      source_url: c.params.sourceUrl,
      window: [c.params.windowStart, c.params.windowEnd],
      C_N: at(c.chain.C, N).toString("hex"),
      C_0: at(c.chain.C, 0).toString("hex"),
    },
    chain: c.obs.map((o, k) => ({
      i: o.i,
      period_id: o.periodId,
      value: jsonInt(o.value),
      C_i: at(c.chain.C, k).toString("hex"),
      preimage_hex: at(c.chain.preimages, k).toString("hex"),
    })),
  };
}

export const REPLAY_FORMAT = "macropaths-replay-v1";

/** The replay file consumed by create_session and replay. */
export function replayJson(prep: Prepared, snapshot: Snapshot): any {
  const c = prep.commitment;
  const N = c.obs.length;
  return {
    format: REPLAY_FORMAT,
    spec: CHAIN_SPEC,
    chain_version: CHAIN_VERSION,
    integers:
      "Integers are JSON numbers when |v| < 2^53 and decimal strings otherwise. Every " +
      "integer in this file (i, period_id, value, N, first_period_id, K, D_cap, A_cap, " +
      "dataset_preimage_len) is currently below 2^53, so all are JSON numbers. Hashes are " +
      "32-byte lowercase hex without 0x.",
    usage:
      "create_session stores dataset_id, N, C_0 (current) and C_N (terminal) with K, D_cap, A_cap; " +
      "then for each row in order observe(i, period_id, value) with C_next = C_{i+1} " +
      "(the last row's C_next is C_N).",
    dataset_id: c.datasetId.toString("hex"),
    dataset_preimage_hex: c.datasetPreimage.toString("hex"),
    dataset_preimage_len: c.datasetPreimage.length,
    N,
    first_period_id: jsonInt(c.params.firstPeriodId),
    K: jsonInt(c.params.K),
    D_cap: jsonInt(c.params.D_cap),
    A_cap: jsonInt(c.params.A_cap),
    transform_id: c.params.transformId,
    window: [c.params.windowStart, c.params.windowEnd],
    source: {
      series_id: c.params.seriesId,
      source_url: c.params.sourceUrl,
      retrieved_at: snapshot.retrieved_at ?? null,
      sha256_of_raw: snapshot.sha256_of_raw ?? null,
    },
    C_0: at(c.chain.C, 0).toString("hex"),
    C_N: at(c.chain.C, N).toString("hex"),
    rows: c.obs.map((o, k) => ({
      i: o.i,
      period_id: o.periodId,
      value: jsonInt(o.value),
      C_i: at(c.chain.C, k).toString("hex"),
      C_next: at(c.chain.C, k + 1).toString("hex"),
    })),
  };
}

// ---------------------------------------------------------------------------
// Rows

/** Full preparation: window selection, exact parsing, eq. (1). */
export function prepare(snapshot: Snapshot): Prepared {
  const { levels, scale } = selectLevels(snapshot);
  const rows: Row[] = [];
  for (let t = 0; t < N_ROWS; t++) {
    const now = at(levels, t + LAG); // P_t
    const lag = at(levels, t); // P_{t-12}
    rows.push({ t, date: now.date, x: yoy(now.scaled, lag.scaled) });
  }
  return { levels, scale, rows, commitment: buildCommitment(snapshot, levels, rows) };
}

/** The 48 traded rows x_0..x_47 (bigint x). */
export function computeRows(snapshot: Snapshot): Row[] {
  return prepare(snapshot).rows;
}

/** Convert one bigint to a JSON-safe number, asserting |v| < 2^53. */
export function toSafeNumber(v: bigint): number {
  if (v >= MAX_SAFE || v <= -MAX_SAFE) {
    throw new RangeError(`value ${v} outside the safe integer range`);
  }
  return Number(v);
}

/** Rows in the JSON shape shared with tests/vectors.json. */
export function rowsToJson(rows: Row[]): { t: number; date: string; x: number }[] {
  return rows.map((r) => ({ t: r.t, date: r.date, x: toSafeNumber(r.x) }));
}

// ---------------------------------------------------------------------------
// Path statistics (sanity check only; on-chain code is the real one)

/** D_47 (eqs. 2-3) and A_47 (eq. 4) over the rows. */
export function pathStats(rows: Row[]): { D: bigint; A: bigint } {
  let M: bigint | null = null; // M_{-1} = -infinity
  let D = 0n;
  let A = 0n;
  for (const { x } of rows) {
    M = M === null || x > M ? x : M;
    const dd = M - x;
    if (dd > D) D = dd;
    const ex = x - K_EXCESS;
    if (ex > 0n) A += ex;
  }
  return { D, A };
}

export const EXPECTED_D = 66_191n;
export const EXPECTED_A = 691_184n;

// ---------------------------------------------------------------------------
// --check against a vectors file

/** Exact decimal equality of two decimal strings ("9.80" == "9.8"). */
function decimalEq(a: string, b: string): boolean {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const s = Math.max(pa.scale, pb.scale);
  return rescale(pa.digits, pa.scale, s) === rescale(pb.digits, pb.scale, s);
}

function toBigIntStrict(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
}

/**
 * Compare computed rows (and, if the vectors file carries them, the 60 levels
 * and final D/A) with a vectors file. The commitment chain is compared when
 * the file has `commitment` / `chain`, and always with requireCommitment (the
 * CLI sets it). Returns a list of human-readable mismatches.
 */
export function checkAgainstVectors(
  prep: Prepared,
  vectors: any,
  opts: { requireCommitment?: boolean } = {},
): string[] {
  const out: string[] = [];
  const vrows: any[] | undefined = vectors?.rows;
  if (!Array.isArray(vrows)) {
    return ["vectors file has no `rows` array"];
  }
  if (vrows.length !== prep.rows.length) {
    out.push(`row count: computed ${prep.rows.length}, vectors ${vrows.length}`);
  }
  const n = Math.max(vrows.length, prep.rows.length);
  for (let k = 0; k < n; k++) {
    const c = prep.rows[k];
    const v = vrows[k];
    if (!c) {
      out.push(`row[${k}]: extra in vectors ${JSON.stringify(v)}`);
      continue;
    }
    if (!v) {
      out.push(`row[${k}]: missing in vectors (computed t=${c.t} ${c.date} x=${c.x})`);
      continue;
    }
    const diffs: string[] = [];
    if (v.t !== c.t) diffs.push(`t ${JSON.stringify(v.t)} != ${c.t}`);
    if (v.date !== c.date) diffs.push(`date ${JSON.stringify(v.date)} != ${c.date}`);
    const vx = toBigIntStrict(v.x);
    if (vx === null) diffs.push(`x ${JSON.stringify(v.x)} is not an integer`);
    else if (vx !== c.x) diffs.push(`x vectors=${vx} computed=${c.x} (diff ${vx - c.x})`);
    if (diffs.length) out.push(`row[${k}] (t=${c.t}, ${c.date}): ${diffs.join("; ")}`);
  }

  // Optional levels: accept `levels` as an array of strings/numbers (in order)
  // or of objects with a date and value_str / value / level field.
  const vlevels: any[] | undefined = vectors?.levels;
  if (Array.isArray(vlevels)) {
    if (vlevels.length !== prep.levels.length) {
      out.push(`level count: snapshot ${prep.levels.length}, vectors ${vlevels.length}`);
    }
    for (let k = 0; k < Math.min(vlevels.length, prep.levels.length); k++) {
      const L = at(prep.levels, k);
      const v = vlevels[k];
      let vstr: unknown;
      let vdate: unknown;
      let vt: unknown;
      if (v !== null && typeof v === "object") {
        vstr = v.level ?? v.value_str ?? v.value ?? v.P;
        vdate = v.date;
        vt = v.t;
      } else {
        vstr = v;
      }
      if (vdate !== undefined && vdate !== L.date) {
        out.push(`level[${k}] (${L.date}): date ${JSON.stringify(vdate)}`);
      }
      if (vt !== undefined && vt !== L.i) {
        out.push(`level[${k}] (${L.date}): t ${JSON.stringify(vt)} != ${L.i}`);
      }
      const s = typeof vstr === "number" ? String(vstr) : vstr;
      if (typeof s !== "string") {
        out.push(`level[${k}] (${L.date}): unreadable value ${JSON.stringify(vstr)}`);
        continue;
      }
      let eq = false;
      try {
        eq = decimalEq(s, L.value_str);
      } catch {
        eq = false;
      }
      if (!eq) {
        out.push(`level[${k}] (${L.date}): vectors ${JSON.stringify(s)} != snapshot ${JSON.stringify(L.value_str)}`);
      } else if (s !== L.value_str) {
        out.push(`level[${k}] (${L.date}): same value, different string ${JSON.stringify(s)} vs ${JSON.stringify(L.value_str)}`);
      }
    }
  }

  // Optional final path statistics: compare D and A if present.
  const vfinal = vectors?.final;
  if (vfinal !== null && typeof vfinal === "object") {
    const stats = pathStats(prep.rows);
    for (const key of ["D", "A"] as const) {
      if (vfinal[key] === undefined) continue;
      const v = toBigIntStrict(vfinal[key]);
      if (v === null) out.push(`final.${key}: ${JSON.stringify(vfinal[key])} is not an integer`);
      else if (v !== stats[key]) out.push(`final.${key}: vectors=${v} computed=${stats[key]}`);
    }
  }

  if (opts.requireCommitment || vectors?.commitment !== undefined || vectors?.chain !== undefined) {
    out.push(...checkCommitment(prep, vectors));
  }
  return out;
}

/** Exact string equality for lowercase hex (no case folding, no 0x stripping). */
function hexEq(v: unknown, c: string): boolean {
  return typeof v === "string" && v === c;
}

/**
 * Compare the commitment chain with `commitment` and `chain` of a vectors
 * file: dataset_id, the dataset preimage bytes, every C_i (and its preimage),
 * C_0 and C_N, as exact lowercase hex strings, plus the scalar parameters.
 */
export function checkCommitment(prep: Prepared, vectors: any): string[] {
  const out: string[] = [];
  const want = commitmentToVectors(prep.commitment);
  const vc = vectors?.commitment;
  if (vc === null || typeof vc !== "object") {
    out.push("vectors file has no `commitment` section");
  } else {
    for (const key of ["dataset_id", "dataset_preimage_hex", "C_0", "C_N"] as const) {
      if (!hexEq(vc[key], want.commitment[key])) {
        out.push(`commitment.${key}: vectors ${JSON.stringify(vc[key])} != computed ${want.commitment[key]}`);
      }
    }
    for (const key of ["spec", "version", "transform_id", "series_id", "source_url"] as const) {
      if (vc[key] !== want.commitment[key]) {
        out.push(`commitment.${key}: vectors ${JSON.stringify(vc[key])} != computed ${JSON.stringify(want.commitment[key])}`);
      }
    }
    for (const key of ["dataset_preimage_len", "N", "first_period_id", "K", "D_cap", "A_cap"] as const) {
      const v = toBigIntStrict(vc[key]);
      const c = toBigIntStrict(want.commitment[key]);
      if (v === null || v !== c) {
        out.push(`commitment.${key}: vectors ${JSON.stringify(vc[key])} != computed ${String(c)}`);
      }
    }
    if (JSON.stringify(vc.window) !== JSON.stringify(want.commitment.window)) {
      out.push(`commitment.window: vectors ${JSON.stringify(vc.window)} != computed ${JSON.stringify(want.commitment.window)}`);
    }
  }

  const vchain: any[] | undefined = vectors?.chain;
  if (!Array.isArray(vchain)) {
    out.push("vectors file has no `chain` array");
    return out;
  }
  if (vchain.length !== want.chain.length) {
    out.push(`chain length: computed ${want.chain.length}, vectors ${vchain.length}`);
  }
  for (let k = 0; k < Math.min(vchain.length, want.chain.length); k++) {
    const v = vchain[k];
    const c = at(want.chain, k);
    const diffs: string[] = [];
    if (v?.i !== c.i) diffs.push(`i ${JSON.stringify(v?.i)} != ${c.i}`);
    if (v?.period_id !== c.period_id) diffs.push(`period_id ${JSON.stringify(v?.period_id)} != ${c.period_id}`);
    const vv = toBigIntStrict(v?.value);
    if (vv === null || vv !== toBigIntStrict(c.value)) diffs.push(`value ${JSON.stringify(v?.value)} != ${c.value}`);
    if (!hexEq(v?.C_i, c.C_i)) diffs.push(`C_i vectors ${JSON.stringify(v?.C_i)} != computed ${c.C_i}`);
    if (!hexEq(v?.preimage_hex, c.preimage_hex)) diffs.push(`preimage_hex differs (computed ${c.preimage_hex})`);
    if (diffs.length) out.push(`chain[${k}]: ${diffs.join("; ")}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI

/** Walk up from `start` to the directory holding pixi.toml (repo root). */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pixi.toml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

interface CliArgs {
  snapshot?: string;
  out?: string;
  check?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const take = (): string => {
      const v = argv[++k];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a path`);
      return v;
    };
    if (a === "--snapshot") args.snapshot = take();
    else if (a === "--out") args.out = take();
    else if (a === "--check") args.check = take();
    else if (a === "-h" || a === "--help") {
      console.log("usage: prepare.ts [--snapshot p] [--out p] [--check vectors.json]");
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function fmtRow(r: Row): string {
  return `t=${r.t} ${r.date} x=${r.x}`;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const root = findRepoRoot();
  const snapPath = path.resolve(args.snapshot ?? path.join(root, "data", "snapshots", "CPIAUCNS.json"));
  const snapshot: Snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const prep = prepare(snapshot);
  const { rows } = prep;

  console.log(`snapshot: ${snapPath}`);
  if (snapshot.id || snapshot.retrieved_at || snapshot.sha256_of_raw) {
    console.log(`  id=${snapshot.id} retrieved_at=${snapshot.retrieved_at} sha256_of_raw=${snapshot.sha256_of_raw}`);
  }
  console.log(`levels: ${prep.levels.length} (${at(prep.levels, 0).date} .. ${at(prep.levels, prep.levels.length - 1).date}), common scale 10^-${prep.scale}`);
  console.log(`rows: ${rows.length}`);
  console.log(`  first: ${fmtRow(at(rows, 0))}`);
  console.log(`  last:  ${fmtRow(at(rows, rows.length - 1))}`);

  let status = 0;

  const { D, A } = pathStats(rows);
  const dOk = D === EXPECTED_D;
  const aOk = A === EXPECTED_A;
  console.log(`sanity: D=${D} (expect ${EXPECTED_D}) ${dOk ? "ok" : "MISMATCH"}; A=${A} (expect ${EXPECTED_A}) ${aOk ? "ok" : "MISMATCH"}`);
  if (!dOk || !aOk) status = 1;

  const c = prep.commitment;
  const walk = walkForward(c.datasetId, c.obs, c.chain.C);
  console.log(`commitment ${CHAIN_VERSION}: dataset_id=${c.datasetId.toString("hex")} (preimage ${c.datasetPreimage.length} bytes)`);
  console.log(`  C_0=${at(c.chain.C, 0).toString("hex")}`);
  console.log(`  C_N=${at(c.chain.C, rows.length).toString("hex")}`);
  console.log(`  forward walk (as observe): ${walk === -1 ? "ok, ends at C_N" : `FAILED at step ${walk}`}`);
  if (walk !== -1) status = 1;

  const outPath = path.resolve(args.out ?? path.join(root, "data", "cpi-yoy-replay.json"));
  const json = JSON.stringify(replayJson(prep, snapshot), null, 2) + "\n";
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, json);
  console.log(`wrote replay (${rows.length} rows, C_0, C_N) to ${outPath}`);

  if (args.check) {
    const vecPath = path.resolve(args.check);
    const vectors = JSON.parse(fs.readFileSync(vecPath, "utf8"));
    const mismatches = checkAgainstVectors(prep, vectors, { requireCommitment: true });
    const levelsNote =
      (Array.isArray(vectors?.levels) ? `${vectors.levels.length} levels` : "no levels") +
      (vectors?.final && typeof vectors.final === "object" ? ", final D/A" : "") +
      (Array.isArray(vectors?.chain) ? `, dataset_id, C_0, C_N, ${vectors.chain.length} C_i` : "");
    if (mismatches.length) {
      console.error(`check FAILED against ${vecPath} (${levelsNote}): ${mismatches.length} mismatch(es)`);
      for (const m of mismatches) console.error(`  ${m}`);
      status = 1;
    } else {
      console.log(`check ok against ${vecPath}: ${rows.length} rows identical (${levelsNote})`);
    }
  }
  return status;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`prepare: ${(e as Error).message}`);
    process.exitCode = 2;
  }
}
