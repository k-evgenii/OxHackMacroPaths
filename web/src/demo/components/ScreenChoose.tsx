"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Button, WhatHappens, InfoTip, fmt } from "./ui";
import {
  DEMO_WALLET_BALANCE,
  payoutRange,
  type Amounts,
} from "../lib/demoData";
import { GOALS, goalFor } from "../lib/goals";

type Props = {
  amounts: Amounts;
  setAmounts: (a: Amounts) => void;
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
    tip: "Score 0 to 1. A fall of 8 points or more from the peak scores 1.",
    more: "Fell a lot",
    less: "Stayed high",
    idx: [0, 1] as const,
  },
  {
    name: "Excess Inflation",
    question: "How long and how far was it above 4%?",
    tip: "Score 0 to 1. Adds up how far above 4% inflation was each month. Reaching the cap scores 1.",
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
  const tooMuch = total > Math.min(DEMO_WALLET_BALANCE, availableBalance);
  const range = payoutRange(amounts);
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
          What do you want covered?
        </h1>
        <p className="mt-2 text-muted">
          Choose a scenario to explore. Adjust More or Less yourself. These
          examples are not recommendations.
        </p>
        <p className="mt-2 text-xs text-brand">
          Historical walkthrough · Jan 2021–Dec 2024 · no tokens are sent
        </p>
      </div>

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

      {/* 3. Confirm */}
      <Card order={3}>
        <div className="grid gap-6 md:grid-cols-3 md:items-center">
          <div>
            <p className="text-sm text-muted">Demo amount</p>
            <p className="num mt-1 text-3xl font-semibold">{fmt(total)} PLAY</p>
          </div>
          <div>
            <p className="text-sm text-muted">Illustrative payout range</p>
            <p className="num mt-1 text-2xl font-semibold">
              {fmt(range.min)} – {fmt(range.max)} PLAY
            </p>
          </div>
          <div ref={triggerRef}>
            <Button
              disabled={total <= 0 || tooMuch || deposited}
              onClick={() => setReview(true)}
            >
              {deposited
                ? "Demo position saved ✓"
                : `Review ${fmt(total)} demo PLAY`}
            </Button>
            {tooMuch ? (
              <p className="mt-2 text-sm text-down">More than your balance.</p>
            ) : null}
            {total <= 0 ? (
              <p className="mt-2 text-sm text-muted">
                Pick a goal or a side first.
              </p>
            ) : null}
            <WhatHappens>
              Review your sides, then start a local historical replay. No wallet
              transaction.
            </WhatHappens>
          </div>
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
          Review your demo position
        </h2>
        <p className="mt-2 text-sm text-muted">
          Local walkthrough · 48 historical months in 12 seconds
        </p>
        <dl className="my-5 space-y-3 text-sm">
          {amounts.map((a, j) =>
            a > 0 ? (
              <div key={j} className="flex justify-between gap-2">
                <dt>
                  {
                    [
                      "Cooling · More",
                      "Cooling · Less",
                      "Excess · More",
                      "Excess · Less",
                    ][j]
                  }
                </dt>
                <dd className="num">{fmt(a)} PLAY</dd>
              </div>
            ) : null,
          )}
          <div className="flex justify-between border-t border-line pt-3 font-semibold">
            <dt>Total</dt>
            <dd className="num">{fmt(total)} demo PLAY</dd>
          </div>
        </dl>
        <Button
          disabled={tooMuch || total <= 0 || deposited}
          onClick={() => {
            setReview(false);
            onDeposited();
          }}
        >
          Confirm demo position →
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
          Your balance changes locally. Nothing is deposited on Solana.
        </p>
      </dialog>
    </div>
  );
}
