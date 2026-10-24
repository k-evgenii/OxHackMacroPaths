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
 * CLI:
 *   npx tsx keeper/src/prepare.ts [--snapshot p] [--out p] [--check tests/vectors.json]
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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
  const first = dates[0];
  const last = dates[dates.length - 1];

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
    else if (isMissing(list[0].value_str)) {
      problems.push(`empty value for ${d}: ${JSON.stringify(list[0].value_str)}`);
    }
  }
  if (inWindow.length !== WINDOW_MONTHS) {
    problems.push(`expected ${WINDOW_MONTHS} rows in ${first}..${last}, found ${inWindow.length}`);
  }
  if (problems.length) {
    throw new Error(`snapshot window check failed:\n  ${problems.join("\n  ")}`);
  }

  const parsed = dates.map((d) => {
    const value_str = byDate.get(d)![0].value_str;
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
// Rows

/** Full preparation: window selection, exact parsing, eq. (1). */
export function prepare(snapshot: Snapshot): Prepared {
  const { levels, scale } = selectLevels(snapshot);
  const rows: Row[] = [];
  for (let t = 0; t < N_ROWS; t++) {
    const now = levels[t + LAG]; // P_t
    const lag = levels[t]; // P_{t-12}
    rows.push({ t, date: now.date, x: yoy(now.scaled, lag.scaled) });
  }
  return { levels, scale, rows };
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
// Commitment chain (docs/commitment-chain.md, spec §1.6)
// SHA-256 over the raw concatenation. No length prefixes.
// u32 and i64 fields are little-endian.

/** The three snapshot strings that go into `dataset_id`. */
export interface SnapshotIdentity {
  source_url: string;
  retrieved_at: string;
  sha256_of_raw: string;
}

export interface ChainRow {
  t: number;
  period_id: number;
  x: number;
  next_commitment: string;
}

export interface BuiltChain {
  dataset_id: string;
  period_ids: number[];
  /** C_0 .. C_n, lowercase hex. `n` is `rows.length` (48 for CPIAUCNS). */
  commitments: string[];
  c0: string;
  terminal: string;
  rows: ChainRow[];
}

/** `year * 100 + month` from `YYYY-MM-DD`. 2021-01-01 -> 202101. */
export function periodId(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (!Number.isInteger(y) || !Number.isInteger(m) || date.length < 7 || m < 1 || m > 12) {
    throw new Error(`bad date for period_id: ${JSON.stringify(date)}`);
  }
  return y * 100 + m;
}

function u32le(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    throw new RangeError(`not a u32: ${n}`);
  }
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function i64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(n, 0);
  return b;
}

/** SHA256( utf8(source_url) ‖ 0x0A ‖ utf8(retrieved_at) ‖ 0x0A ‖ utf8(sha_hex) ). */
export function datasetId(sourceUrl: string, retrievedAt: string, shaHex: string): Buffer {
  return createHash("sha256")
    .update(sourceUrl, "utf8")
    .update("\n", "utf8")
    .update(retrievedAt, "utf8")
    .update("\n", "utf8")
    .update(shaHex, "utf8")
    .digest();
}

/** C_n = SHA256( "PATH-END-v1" ‖ dataset_id ‖ u32_le(n) ). */
export function endHash(id: Buffer, n: number): Buffer {
  if (id.length !== 32) throw new Error("endHash: dataset_id must be 32 bytes");
  return createHash("sha256").update("PATH-END-v1").update(id).update(u32le(n)).digest();
}

/** C_i = SHA256( "PATH-OBS-v1" ‖ dataset_id ‖ u32_le(i) ‖ u32_le(period) ‖ i64_le(x) ‖ next ). */
export function obsHash(
  id: Buffer,
  i: number,
  period: number,
  value: bigint,
  next: Buffer,
): Buffer {
  if (id.length !== 32 || next.length !== 32) {
    throw new Error("obsHash: dataset_id and next must be 32 bytes");
  }
  return createHash("sha256")
    .update("PATH-OBS-v1")
    .update(id)
    .update(u32le(i))
    .update(u32le(period))
    .update(i64le(value))
    .update(next)
    .digest();
}

/**
 * Build C_0 .. C_n for `rows` (t = 0 .. n-1). `n` is `rows.length`.
 * `identity` is the three snapshot strings.
 */
export function buildChain(rows: Row[], identity: SnapshotIdentity): BuiltChain {
  if (!identity.source_url || !identity.retrieved_at || !identity.sha256_of_raw) {
    throw new Error("buildChain: snapshot is missing source_url, retrieved_at or sha256_of_raw");
  }
  const ordered = [...rows].sort((a, b) => a.t - b.t);
  const n = ordered.length;
  for (let i = 0; i < n; i++) {
    if (ordered[i].t !== i) throw new Error(`buildChain: expected t=${i}, got ${ordered[i].t}`);
  }
  const id = datasetId(identity.source_url, identity.retrieved_at, identity.sha256_of_raw);
  const periodIds = ordered.map((r) => periodId(r.date));
  const digests: Buffer[] = new Array(n + 1);
  digests[n] = endHash(id, n);
  for (let i = n - 1; i >= 0; i--) {
    digests[i] = obsHash(id, i, periodIds[i], ordered[i].x, digests[i + 1]);
  }
  const commitments = digests.map((d) => d.toString("hex"));
  return {
    dataset_id: id.toString("hex"),
    period_ids: periodIds,
    commitments,
    c0: commitments[0],
    terminal: commitments[n],
    rows: ordered.map((r, i) => ({
      t: r.t,
      period_id: periodIds[i],
      x: toSafeNumber(r.x),
      next_commitment: commitments[i + 1],
    })),
  };
}

/** Replay file written to `data/cpi-yoy-replay.json`. */
export function chainReplay(chain: BuiltChain): {
  dataset_id: string;
  rows: ChainRow[];
  c0: string;
  terminal: string;
} {
  return {
    dataset_id: chain.dataset_id,
    rows: chain.rows,
    c0: chain.c0,
    terminal: chain.terminal,
  };
}

/**
 * Compare a built chain with `vectors.chain`. Empty list means all commitments match.
 */
export function checkChain(built: BuiltChain, vectors: any): string[] {
  const out: string[] = [];
  const block = vectors?.chain;
  const commitments: unknown = block?.commitments;
  if (!block || !Array.isArray(commitments)) {
    return ["vectors file has no chain.commitments"];
  }
  if (block.dataset_id !== built.dataset_id) {
    out.push(`dataset_id vectors=${block.dataset_id} computed=${built.dataset_id}`);
  }
  if (commitments.length !== built.commitments.length) {
    out.push(`commitment count: computed ${built.commitments.length}, vectors ${commitments.length}`);
  }
  let bad = 0;
  const n = Math.max(commitments.length, built.commitments.length);
  for (let i = 0; i < n; i++) {
    if (commitments[i] !== built.commitments[i]) {
      bad++;
      if (bad <= 3) {
        out.push(`C_${i}: vectors=${String(commitments[i])} computed=${built.commitments[i] ?? "missing"}`);
      }
    }
  }
  if (bad > 3) out.push(`... ${bad} commitment mismatches`);
  const pids: unknown = block.period_ids;
  if (!Array.isArray(pids)) {
    out.push("vectors file has no chain.period_ids");
  } else if (pids.length !== built.period_ids.length) {
    out.push(`period_id count: computed ${built.period_ids.length}, vectors ${pids.length}`);
  } else {
    for (let i = 0; i < pids.length; i++) {
      if (pids[i] !== built.period_ids[i]) {
        out.push(`period_id[${i}]: vectors=${pids[i]} computed=${built.period_ids[i]}`);
        break;
      }
    }
  }
  return out;
}

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
 * Compare computed rows (and, if the vectors file carries them, the 60 levels)
 * with a vectors file. Returns a list of human-readable mismatches.
 */
export function checkAgainstVectors(prep: Prepared, vectors: any): string[] {
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
      const L = prep.levels[k];
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
  console.log(`levels: ${prep.levels.length} (${prep.levels[0].date} .. ${prep.levels[prep.levels.length - 1].date}), common scale 10^-${prep.scale}`);
  console.log(`rows: ${rows.length}`);
  console.log(`  first: ${fmtRow(rows[0])}`);
  console.log(`  last:  ${fmtRow(rows[rows.length - 1])}`);

  let status = 0;

  const { D, A } = pathStats(rows);
  const dOk = D === EXPECTED_D;
  const aOk = A === EXPECTED_A;
  console.log(`sanity: D=${D} (expect ${EXPECTED_D}) ${dOk ? "ok" : "MISMATCH"}; A=${A} (expect ${EXPECTED_A}) ${aOk ? "ok" : "MISMATCH"}`);
  if (!dOk || !aOk) status = 1;

  const json = JSON.stringify(rowsToJson(rows), null, 2) + "\n";
  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json);
    console.log(`wrote ${rows.length} rows to ${outPath}`);
  }

  const chain = buildChain(rows, {
    source_url: snapshot.source_url ?? "",
    retrieved_at: snapshot.retrieved_at ?? "",
    sha256_of_raw: snapshot.sha256_of_raw ?? "",
  });
  const replayPath = path.join(root, "data", "cpi-yoy-replay.json");
  fs.mkdirSync(path.dirname(replayPath), { recursive: true });
  fs.writeFileSync(replayPath, JSON.stringify(chainReplay(chain), null, 2) + "\n");
  console.log(`wrote chain c0=${chain.c0} terminal=${chain.terminal} to ${replayPath}`);

  if (args.check) {
    const vecPath = path.resolve(args.check);
    const vectors = JSON.parse(fs.readFileSync(vecPath, "utf8"));
    const mismatches = checkAgainstVectors(prep, vectors);
    const levelsNote =
      (Array.isArray(vectors?.levels) ? `${vectors.levels.length} levels` : "no levels") +
      (vectors?.final && typeof vectors.final === "object" ? ", final D/A" : "");
    if (mismatches.length) {
      console.error(`check FAILED against ${vecPath} (${levelsNote}): ${mismatches.length} mismatch(es)`);
      for (const m of mismatches) console.error(`  ${m}`);
      status = 1;
    } else {
      console.log(`check ok against ${vecPath}: ${rows.length} rows identical (${levelsNote})`);
    }
    const chainMismatches = checkChain(chain, vectors);
    if (chainMismatches.length) {
      console.error(`chain FAILED against ${vecPath}: ${chainMismatches.length} mismatch(es)`);
      for (const m of chainMismatches) console.error(`  ${m}`);
      status = 1;
    } else {
      console.log(`chain ok ${chain.commitments.length}/${vectors.chain.commitments.length}`);
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
