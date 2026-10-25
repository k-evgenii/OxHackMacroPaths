"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Button, WhatHappens, InfoTip, fmt } from "./ui";
import MonthDecisionPanel from "./MonthDecisionPanel";
import {
  DEMO_WALLET_BALANCE,
  CPI_YOY,
  MAX_PRACTICE_ENTRIES,
  amountsThrough,
  payoutRange,
  type Amounts,
  type PracticeEntry,
} from "../lib/demoData";
import { GOALS, goalFor } from "../lib/goals";
import { sidesText } from "../lib/history";

type Props = {
  amounts: Amounts;
  setAmounts: (a: Amounts) => void;
  entries: PracticeEntry[];
  monthIndex: number;
  setMonthIndex: (monthIndex: number) => void;
  onAddEntry: () => void;
  onRemoveEntry: (id: string) => void;
  deposited: boolean;
  onDeposited: () => void;
  availableBalance: number;
};

type Side = "more" | "less" | "skip";
const MIN = 5;
const STEP = 5;

const PRODUCTS = [
  {
    name: "Inflation Cooling",
    question: "How far did inflation fall from its peak?",
    tip: "The score reaches 100% when inflation falls 8 percentage points from an earlier peak.",
    more: "Fell a lot",
    less: "Stayed high",
    idx: [0, 1] as const,
  },
  {
    name: "Excess Inflation",
    question: "How long and how far was it above 4%?",
    tip: "Each month above 4% adds to the score. It reaches 100% at 80 point-months.",
    more: "Ran hot",
    less: "Stayed calm",
    idx: [2, 3] as const,
  },
];

const sideFrom = (a: Amounts, i: number): Side => {
  const [m, l] = PRODUCTS[i].idx;
  return a[m] > 0 ? "more" : a[l] > 0 ? "less" : "skip";
};
const amountFrom = (a: Amounts, i: number) => {
  const [m, l] = PRODUCTS[i].idx;
  return a[m] + a[l] || 10;
};

export default function ScreenChoose({
  amounts,
  setAmounts,
  entries,
  monthIndex,
  setMonthIndex,
  onAddEntry,
  onRemoveEntry,
  deposited,
  onDeposited,
  availableBalance,
}: Props) {
  const [review, setReview] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (review) dialogRef.current?.showModal();
    else if (dialogRef.current?.open) dialogRef.current.close();
  }, [review]);
  // Side and amount are kept separately, so clearing the box while typing never flips the card to "Skip".
  const [sides, setSides] = useState<Side[]>([
    sideFrom(amounts, 0),
    sideFrom(amounts, 1),
  ]);
  const [typed, setTyped] = useState<string[]>([
    String(amountFrom(amounts, 0)),
    String(amountFrom(amounts, 1)),
  ]);

  const total = amounts.reduce((s, v) => s + v, 0);
  const combined = amountsThrough(entries);
  const basketTotal = combined.reduce((s, v) => s + v, 0);
  const tooMuch = basketTotal + total > availableBalance;
  const tooLarge = basketTotal + total > DEMO_WALLET_BALANCE;
  const full = entries.length >= MAX_PRACTICE_ENTRIES;
  const range = payoutRange(combined);
  const goal = goalFor(amounts);

  const apply = (nextSides: Side[], nextTyped: string[]) => {
    const next = [0, 0, 0, 0] as Amounts;
    nextSides.forEach((side, i) => {
      const [m, l] = PRODUCTS[i].idx;
      const parsed = Number(nextTyped[i]);
      const v = Number.isFinite(parsed)
        ? Number(Math.min(DEMO_WALLET_BALANCE, Math.max(0, parsed)).toFixed(6))
        : 0;
      if (side === "more") next[m] = v;
      if (side === "less") next[l] = v;
    });
    setSides(nextSides);
    setTyped(
      nextTyped.map((t) =>
        Number(t) > 1000 ? "1000" : Number(t) < 0 ? "0" : t,
      ),
    );
    setAmounts(next);
  };

  const pickGoal = (preset: Amounts) => {
    const s: Side[] = [sideFrom(preset, 0), sideFrom(preset, 1)];
    apply(s, [String(amountFrom(preset, 0)), String(amountFrom(preset, 1))]);
  };

  const setSide = (i: number, side: Side) =>
    apply(
      sides.map((s, k) => (k === i ? side : s)),
      typed,
    );
  const setAmount = (i: number, v: string) =>
    apply(
      sides,
      typed.map((t, k) => (k === i ? v : t)),
    );
  const bump = (i: number, d: number) =>
    setAmount(i, String(Math.max(MIN, (Number(typed[i]) || 0) + d)));

  return (
    <div className="space-y-6">
      <div className="reveal">
        <h1 className="text-4xl font-semibold tracking-tight">
          Build your position
        </h1>
        <p className="mt-2 text-muted">
          Choose a recorded month, inspect the pool and inflation path, then add
          one or more practice entries. You can add several for the same month
          before reviewing the combined position.
        </p>
        <p className="mt-2 text-xs text-brand">
          US CPI · Jan 2021–Dec 2024 · Practice position
        </p>
      </div>

      <MonthDecisionPanel
        entries={entries}
        monthIndex={monthIndex}
        setMonthIndex={setMonthIndex}
        deposited={deposited}
      />

      {/* 1. Choose by goal */}
      <div
        role="group"
        aria-label="Goal"
        className="reveal grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        {GOALS.map((g) => {
          const on = goal?.key === g.key;
          return (
            <button
              key={g.key}
              type="button"
              aria-pressed={on}
              disabled={deposited}
              onClick={() => pickGoal(g.preset)}
              className={`flex flex-col rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed ${
                on
                  ? "border-accent bg-accent/10 shadow-[0_10px_24px_-16px_rgba(239,106,34,0.9)]"
                  : "border-line bg-panel hover:border-text/30"
              }`}
            >
              <span
                className={`font-semibold leading-snug ${on ? "text-brand" : ""}`}
              >
                {g.label}
              </span>
              <span className="mt-1 text-xs text-muted">{g.detail}</span>
            </button>
          );
        })}
      </div>

      {/* 2. The sides it sets (adjustable) */}
      <div className="grid gap-6 md:grid-cols-2">
        {PRODUCTS.map((p, i) => {
          const side = sides[i];
          return (
            <Card key={p.name} order={i + 1}>
              <h2 className="flex items-center text-lg font-semibold">
                {p.name}
                <InfoTip text={p.tip} label={`About ${p.name}`} />
              </h2>
              <p className="mt-0.5 text-sm text-muted">{p.question}</p>

              <div
                role="group"
                aria-label={`${p.name} side`}
                className="mt-4 grid grid-cols-3 gap-2"
              >
                {(["more", "less", "skip"] as Side[]).map((s) => {
                  const on = side === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      disabled={deposited}
                      onClick={() => setSide(i, s)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed ${
                        on
                          ? s === "skip"
                            ? "border-text bg-panel-2"
                            : "border-accent bg-accent/10"
                          : "border-line hover:border-text/30"
                      }`}
                    >
                      <span
                        className={`block text-sm font-semibold ${on && s !== "skip" ? "text-brand" : ""}`}
                      >
                        {s === "more" ? "More" : s === "less" ? "Less" : "Skip"}
                      </span>
                      <span className="block text-xs text-muted">
                        {s === "more"
                          ? p.more
                          : s === "less"
                            ? p.less
                            : "Not this one"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {side !== "skip" ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-panel-2 px-4 py-2.5">
                  <label htmlFor={`amt-${i}`} className="text-sm">
                    Amount
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Decrease ${p.name} amount`}
                      disabled={deposited || (Number(typed[i]) || 0) <= MIN}
                      onClick={() => bump(i, -STEP)}
                      className="grid h-8 w-8 place-items-center rounded-full border border-line bg-panel text-lg disabled:opacity-40"
                    >
                      −
                    </button>
                    <input
                      id={`amt-${i}`}
                      type="number"
                      min={MIN}
                      max={1000}
                      step="0.000001"
                      inputMode="decimal"
                      value={typed[i]}
                      disabled={deposited}
                      onChange={(e) => setAmount(i, e.target.value)}
                      onBlur={() =>
                        setAmount(
                          i,
                          String(
                            Number(
                              Math.min(
                                1000,
                                Math.max(MIN, Number(typed[i]) || MIN),
                              ).toFixed(6),
                            ),
                          ),
                        )
                      }
                      className="num w-16 bg-transparent text-center text-lg font-semibold outline-none"
                    />
                    <button
                      type="button"
                      aria-label={`Increase ${p.name} amount`}
                      disabled={deposited}
                      onClick={() => bump(i, STEP)}
                      className="grid h-8 w-8 place-items-center rounded-full border border-line bg-panel text-lg disabled:opacity-40"
                    >
                      +
                    </button>
                    <span className="text-xs text-muted">PLAY</span>
                  </div>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {/* 3. Add decisions and review the combined position */}
      <Card order={3}>
        <div className="grid gap-6 md:grid-cols-3 md:items-center">
          <div>
            <p className="text-sm text-muted">
              Draft for {CPI_YOY[monthIndex].period}
            </p>
            <p className="num mt-1 text-3xl font-semibold">{fmt(total)} PLAY</p>
          </div>
          <div>
            <p className="text-sm text-muted">Entries already added</p>
            <p className="num mt-1 text-2xl font-semibold">{entries.length}</p>
            <p className="mt-1 text-xs text-muted">
              {fmt(basketTotal)} PLAY in your local scenario
            </p>
          </div>
          <div>
            <Button
              disabled={total <= 0 || tooMuch || tooLarge || deposited || full}
              onClick={onAddEntry}
            >
              {deposited
                ? "Position confirmed ✓"
                : "Add entry for " + CPI_YOY[monthIndex].period + " →"}
            </Button>
            {tooMuch ? (
              <p className="mt-2 text-sm text-down">More than your balance.</p>
            ) : null}
            {tooLarge && !tooMuch ? (
              <p className="mt-2 text-sm text-down">
                Maximum 1,000 PLAY per combined practice position.
              </p>
            ) : null}
            {total <= 0 ? (
              <p className="mt-2 text-sm text-muted">
                Pick a goal or a side first.
              </p>
            ) : null}
            {full ? (
              <p className="mt-2 text-sm text-muted">
                Maximum {MAX_PRACTICE_ENTRIES} entries per practice position.
              </p>
            ) : null}
            <WhatHappens>
              Adding an entry updates the local pot. Add the same choice again,
              or change month, side and amount.
            </WhatHappens>
          </div>
        </div>
      </Card>
      <Card order={4}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Your monthly entries</h2>
            <p className="mt-1 text-sm text-muted">
              Entries combine into one practice position for final settlement.
            </p>
          </div>
          <span
            aria-live="polite"
            className="num text-sm font-semibold text-brand"
          >
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        {entries.length ? (
          <ol className="mt-5 divide-y divide-line">
            {entries.map((entry, index) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-semibold">
                    {index + 1}. {CPI_YOY[entry.monthIndex].period}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {sidesText(entry.amounts)}
                  </p>
                </div>
                {!deposited ? (
                  <button
                    type="button"
                    onClick={() => onRemoveEntry(entry.id)}
                    aria-label={
                      "Remove entry " +
                      (index + 1) +
                      " for " +
                      CPI_YOY[entry.monthIndex].period
                    }
                    className="rounded-full border border-line px-3 py-2 text-xs font-semibold text-muted hover:text-text"
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-5 rounded-xl bg-panel-2 p-4 text-sm text-muted">
            No entries yet. Choose a side and add your first month decision.
          </p>
        )}
        <div className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted">Combined amount</p>
            <p className="num mt-1 text-2xl font-semibold">
              {fmt(basketTotal)} PLAY
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">
              Illustrative final payout range
            </p>
            <p className="num mt-1 text-xl font-semibold">
              {entries.length
                ? fmt(range.min) + " – " + fmt(range.max) + " PLAY"
                : "—"}
            </p>
          </div>
        </div>
        <div ref={triggerRef} className="mt-5 max-w-sm">
          <Button
            disabled={!entries.length || deposited}
            onClick={() => setReview(true)}
          >
            {deposited
              ? "Position confirmed ✓"
              : "Review " +
                entries.length +
                " " +
                (entries.length === 1 ? "entry" : "entries") +
                " →"}
          </Button>
        </div>
      </Card>
      <dialog
        ref={dialogRef}
        onClose={() => {
          setReview(false);
          triggerRef.current?.querySelector("button")?.focus();
        }}
        onCancel={() => setReview(false)}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const buttons =
            dialogRef.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            );
          const first = buttons?.[0];
          const last = buttons?.[buttons.length - 1];
          if (!e.shiftKey && e.target === last) {
            e.preventDefault();
            first?.focus();
          }
          if (e.shiftKey && e.target === first) {
            e.preventDefault();
            last?.focus();
          }
        }}
        aria-labelledby="review-title"
        className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-3xl border border-line bg-panel p-6 text-text shadow-xl backdrop:bg-black/40"
      >
        <h2 id="review-title" className="text-2xl font-semibold">
          Review monthly entries
        </h2>
        <p className="mt-2 text-sm text-muted">
          US CPI · 48 monthly readings · Jan 2021–Dec 2024
        </p>
        <dl className="my-5 space-y-3 text-sm">
          {entries.map((entry, index) => (
            <div key={entry.id} className="flex justify-between gap-2">
              <dt>
                {index + 1}. {CPI_YOY[entry.monthIndex].period} ·{" "}
                {sidesText(entry.amounts)}
              </dt>
              <dd className="num">
                {fmt(entry.amounts.reduce((sum, value) => sum + value, 0))} PLAY
              </dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-3 font-semibold">
            <dt>Total</dt>
            <dd className="num">{fmt(basketTotal)} PLAY</dd>
          </div>
        </dl>
        <Button
          disabled={
            !entries.length ||
            basketTotal > availableBalance ||
            basketTotal > DEMO_WALLET_BALANCE ||
            deposited
          }
          onClick={() => {
            setReview(false);
            onDeposited();
          }}
        >
          Confirm combined practice position →
        </Button>
        <button
          type="button"
          autoFocus
          onClick={() => setReview(false)}
          className="mt-3 w-full rounded-full py-2 text-sm text-muted"
        >
          Back to edit
        </button>
        <p className="mt-3 text-xs text-muted">
          Month-labelled entries are local scenarios. The reference session
          closed deposits before its replay; no wallet transfer occurs.
        </p>
      </dialog>
    </div>
  );
}
