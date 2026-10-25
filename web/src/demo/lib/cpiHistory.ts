// History helpers: any 48-month window, the same statistics and scores as the program,
// and how 2021–24 ranks against every earlier window.
import { HIST_START, HIST_X } from "./cpiHistoryData";
import {
  pathStats,
  scoresFrom,
  illustrativePayout,
  type Amounts,
  type PathStats,
  type Scores,
} from "./demoData";

export { HIST_X };
export const WINDOW = 48;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const base = HIST_START.year * 12 + (HIST_START.month - 1);

/** Index (0 = Jan 1914) → { year, month 1-12, label "Jun 2022" } */
export function periodOf(i: number) {
  const t = base + i;
  const year = Math.floor(t / 12);
  const month = (t % 12) + 1;
  return { year, month, label: `${MONTHS[month - 1]} ${year}` };
}

export const indexOf = (year: number, month: number) =>
  year * 12 + (month - 1) - base;
export const LAST_INDEX = HIST_X.length - 1;
export const LAST_START = HIST_X.length - WINDOW; // latest start with 48 full months
export const LIVE_START = indexOf(2021, 1);

/** Percent values for a window starting at index `start`. */
export const windowValues = (start: number) =>
  HIST_X.slice(start, start + WINDOW).map((x) => x / 10000);

export type WindowResult = { start: number; stats: PathStats; scores: Scores };

export function windowResult(start: number): WindowResult {
  const stats = pathStats(windowValues(start));
  return { start, stats, scores: scoresFrom(stats) };
}

/** Payout for the demo amounts if this window had been the contract (same seeded pools, exact rule). */
export const windowPayout = (start: number, a: Amounts) =>
  illustrativePayout(a, windowResult(start).scores);

// Every 48-month window, computed once (≈1,300 windows, each 48 steps: fast).
let cache: WindowResult[] | null = null;
export function allWindows(): WindowResult[] {
  if (!cache)
    cache = Array.from({ length: LAST_START + 1 }, (_, s) => windowResult(s));
  return cache;
}

/**
 * How 2021–24 ranks against the windows that ended by Dec 2020 and started in 1960 or later,
 * the comparison set the team's research notebook uses (685 windows).
 */
export function rank2021() {
  const from = indexOf(1960, 1);
  const lastStart = indexOf(2020, 12) - (WINDOW - 1);
  const set = allWindows().slice(from, lastStart + 1);
  const live = windowResult(LIVE_START).stats;
  const pct = (f: (w: WindowResult) => number, v: number) =>
    set.filter((w) => f(w) <= v).length / set.length;
  return {
    windows: set.length,
    cooling: pct((w) => w.stats.D, live.D),
    excess: pct((w) => w.stats.A, live.A),
  };
}

export type Episode = {
  key: string;
  label: string;
  years: string;
  start: number;
  story: string;
  live?: boolean;
};

export const EPISODES: Episode[] = [
  {
    key: "ww1",
    label: "World War I",
    years: "1917–20",
    start: indexOf(1917, 1),
    story: "Wartime inflation near 20%, then a sharp deflation.",
  },
  {
    key: "postwar",
    label: "Post-war boom",
    years: "1946–49",
    start: indexOf(1946, 1),
    story: "Price controls end: a spike, then prices fall.",
  },
  {
    key: "oil",
    label: "Oil shock",
    years: "1973–76",
    start: indexOf(1973, 1),
    story: "OPEC embargo pushes inflation above 12%.",
  },
  {
    key: "volcker",
    label: "Volcker years",
    years: "1979–82",
    start: indexOf(1979, 1),
    story: "Peak near 15%, then the Fed breaks inflation.",
  },
  {
    key: "gfc",
    label: "Financial crisis",
    years: "2007–10",
    start: indexOf(2007, 1),
    story: "Oil spike, then inflation briefly below zero.",
  },
  {
    key: "live",
    label: "Post-pandemic",
    years: "2021–24",
    start: LIVE_START,
    story: "The 2021–24 replay you play.",
    live: true,
  },
];
