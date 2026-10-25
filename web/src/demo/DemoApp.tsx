"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ScreenChoose from "./components/ScreenChoose";
import Proof from "./components/Proof";
import Dashboard from "./components/Dashboard";
import InflationTimeline from "./components/InflationTimeline";
import {
  AnimatedNumber,
  Button,
  Card,
  StepBar,
  Tag,
  fmt,
  type StepKey,
} from "./components/ui";
import {
  CPI_YOY,
  DEMO_WALLET_BALANCE,
  FINAL_SCORES,
  TOTAL_OBSERVATIONS,
  illustrativePayout,
  pathStats,
  scoresFrom,
  claimsBySide,
  type Amounts,
} from "./lib/demoData";
import {
  loadName,
  loadRuns,
  saveName,
  saveRuns,
  sidesText,
  type Run,
} from "./lib/history";

type Screen =
  | "home"
  | "account"
  | "wallet"
  | "history"
  | "explore"
  | "news"
  | "forecast"
  | StepKey;
const DEFAULT_AMOUNTS: Amounts = [10, 0, 10, 0];
const ExploreScreen = dynamic(() => import("./components/ExploreScreen"), {
  loading: () => (
    <div
      role="status"
      className="h-80 motion-safe:animate-pulse rounded-3xl border border-line bg-panel p-8 text-muted"
    >
      Loading historical patterns…
    </div>
  ),
});

const NewsScreen = dynamic(() => import("./components/NewsScreen"), {
  loading: () => (
    <div
      role="status"
      className="h-80 motion-safe:animate-pulse rounded-2xl bg-panel p-6 text-muted"
    >
      Loading the inflation brief…
    </div>
  ),
});

const ForecastScreen = dynamic(() => import("./components/ForecastScreen"), {
  loading: () => (
    <div role="status" className="rounded-2xl bg-panel p-8 text-muted">
      Loading forecast research…
    </div>
  ),
});
const WalletReadPanel = dynamic(() => import("./components/WalletReadPanel"), {
  loading: () => (
    <div role="status" className="rounded-2xl bg-panel p-8 text-muted">
      Loading wallet lookup…
    </div>
  ),
});

export default function DemoApp({
  initialScreen = "home",
}: {
  initialScreen?: "home" | "forecast";
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [draftName, setDraftName] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [amounts, setAmounts] = useState<Amounts>(DEFAULT_AMOUNTS);
  const [deposited, setDeposited] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [observed, setObserved] = useState(0);
  const [running, setRunning] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const [resetPrompt, setResetPrompt] = useState(false);
  const [newRunPrompt, setNewRunPrompt] = useState(false);
  const claimGuard = useRef(false);
  const titleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setName(loadName());
    setDraftName(loadName());
    setRuns(loadRuns());
    setReady(true);
    try {
      const k = "macropaths.storage-check";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
    } catch {
      setStorageNotice(
        "Browser storage is unavailable. Your profile and history will last for this visit only.",
      );
    }
  }, []);
  useEffect(() => {
    if (ready) {
      titleRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [screen, ready]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setObserved((n) => Math.min(TOTAL_OBSERVATIONS, n + 1)),
      250,
    );
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (observed === TOTAL_OBSERVATIONS) setRunning(false);
  }, [observed]);

  const total = amounts.reduce((a, b) => a + b, 0);
  const done = observed === TOTAL_OBSERVATIONS;
  const stats = useMemo(
    () => pathStats(CPI_YOY.slice(0, observed).map((o) => o.value)),
    [observed],
  );
  const scores = scoresFrom(stats);
  const payout = illustrativePayout(amounts, FINAL_SCORES);
  const currentDelta = claimed ? payout - total : deposited ? -total : 0;
  const historyDelta = runs.reduce((sum, r) => sum + r.back - r.put, 0);
  // Completed runs already include this run; don't count its result twice.
  const balance =
    DEMO_WALLET_BALANCE + historyDelta + (claimed ? 0 : currentDelta);
  const nextStep: StepKey = !deposited ? "choose" : !done ? "watch" : "claim";

  function resetPosition() {
    setRunning(false);
    setObserved(0);
    setDeposited(false);
    setClaimed(false);
    setAmounts([...DEFAULT_AMOUNTS]);
    claimGuard.current = false;
    setNewRunPrompt(false);
    setScreen("choose");
  }
  function startNew() {
    if (runs.length >= 100) {
      setStorageNotice(
        "You have saved 100 position previews. Reset your practice balance in Wallet to start again.",
      );
      setScreen("wallet");
      return;
    }
    resetPosition();
  }
  function finishRun() {
    if (!deposited || !done || claimGuard.current || runs.length >= 100) return;
    claimGuard.current = true;
    const run: Run = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      amounts: [...amounts],
      put: total,
      back: payout,
    };
    const next = [...runs, run];
    setRuns(next);
    saveRuns(next);
    setClaimed(true);
  }
  function profileSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = draftName.trim().slice(0, 40);
    if (!clean) return;
    setName(clean);
    saveName(clean);
    setScreen("home");
  }
  const nav = [
    { key: "home", label: "Discover" },
    { key: "explore", label: "Explore" },
    { key: "forecast", label: "Forecast" },
    { key: "news", label: "News" },
    { key: "history", label: "Portfolio" },
    { key: "wallet", label: "Wallet" },
  ] as const;
  const activeNav = ["choose", "watch", "claim"].includes(screen)
    ? "home"
    : screen;

  return (
    <div className="min-h-screen">
      <a
        href="#demo-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-panel focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 md:px-8">
          <button
            type="button"
            onClick={() => setScreen("home")}
            className="flex items-center gap-2.5"
            aria-label="MacroPaths home"
          >
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-ink">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 17 8 7l5 9 4-6 4 3" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight">
              MacroPaths<span className="text-accent">.</span>
            </span>
          </button>
          <nav
            aria-label="Main"
            className="mp-nav order-3 w-full justify-between overflow-x-auto lg:order-none lg:w-auto"
          >
            {nav.map((n) => (
              <button
                key={n.key}
                type="button"
                aria-current={activeNav === n.key ? "page" : undefined}
                onClick={() => setScreen(n.key)}
                className="mp-nav-item shrink-0"
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-up/8 px-2.5 py-1.5 text-[10px] font-semibold text-up sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
              Devnet
            </span>
            <button
              type="button"
              onClick={() => setScreen("wallet")}
              className="hidden rounded-xl border border-line px-3 py-2 text-xs font-semibold sm:block"
            >
              <AnimatedNumber value={balance} /> PLAY
            </button>
            <button
              type="button"
              onClick={() => setScreen("account")}
              aria-label="Account settings"
              className="grid h-9 w-9 place-items-center rounded-full bg-forecast/10 text-xs font-semibold text-forecast"
            >
              {name ? (
                name.slice(0, 1).toUpperCase()
              ) : (
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden
                >
                  <circle cx="10" cy="6" r="3" />
                  <path d="M4 18v-2a6 6 0 0 1 12 0v2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>
      <main
        key={screen}
        id="demo-main"
        ref={titleRef}
        tabIndex={-1}
        className="mp-page-enter mx-auto max-w-7xl space-y-6 px-4 pb-12 pt-6 outline-none md:px-8 md:pt-7"
      >
        {storageNotice ? (
          <p
            role="status"
            className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted"
          >
            {storageNotice}
          </p>
        ) : null}
        {!ready ? (
          <div
            role="status"
            className="h-80 motion-safe:animate-pulse rounded-3xl border border-line bg-panel p-8 text-muted"
          >
            Loading MacroPaths…
          </div>
        ) : screen === "account" ? (
          <div className="mx-auto grid max-w-4xl gap-8 py-5 md:grid-cols-2 md:items-center">
            <div>
              <Tag tone="accent">MacroPaths · OxHack ’26</Tag>
              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
                Inflation takes a path.
                <br />
                <span className="text-brand">Your position follows.</span>
              </h1>
              <p className="mt-5 max-w-sm leading-relaxed text-muted">
                Choose your exposure. Explore the history. See how a fixed
                formula changes the payout.
              </p>
              <ol className="mt-6 space-y-3 text-sm">
                {[
                  "Choose a goal and your More / Less sides",
                  "Replay the historical case study",
                  "Review your result and portfolio",
                ].map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <span className="num text-brand">0{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
            <Card>
              <h2 className="text-2xl font-semibold">
                {name ? "Account settings" : "Make yourself at home"}
              </h2>
              <p className="mt-2 text-sm text-muted">
                Personalise MacroPaths on this device. Your display name is
                saved in this browser.
              </p>
              <form onSubmit={profileSubmit} className="mt-6 space-y-4">
                <label
                  htmlFor="profile-name"
                  className="block text-sm font-medium"
                >
                  Display name
                  <input
                    id="profile-name"
                    autoComplete="nickname"
                    required
                    maxLength={40}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Your name"
                    className="mt-2 block h-12 w-full rounded-xl border border-line bg-panel-2 px-4"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!draftName.trim()}
                  className="h-12 w-full rounded-full bg-accent text-sm font-semibold text-white disabled:opacity-40"
                >
                  {name ? "Save profile" : "Save & continue →"}
                </button>
              </form>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                Your profile and practice portfolio stay on this device. Wallet
                identity and transaction signing are separate.
              </p>
              {name ? (
                <button
                  type="button"
                  onClick={() => {
                    setName("");
                    setDraftName("");
                    saveName("");
                    setRunning(false);
                  }}
                  className="mt-5 text-sm text-brand underline"
                >
                  Clear profile
                </button>
              ) : null}
            </Card>
          </div>
        ) : (
          <>
            {screen === "forecast" ? <ForecastScreen /> : null}
            {screen === "home" ? (
              <Dashboard
                balance={balance}
                locked={deposited && !claimed ? total : 0}
                runs={runs.length}
                deposited={deposited && !claimed}
                query={query}
                onQuery={setQuery}
                onStart={() => (claimed ? startNew() : setScreen(nextStep))}
                onExplore={() => setScreen("explore")}
                onForecast={() => setScreen("forecast")}
                onNews={() => setScreen("news")}
                onWallet={() => setScreen("wallet")}
                onSelect={(product, side) => {
                  if (deposited && !claimed) {
                    setScreen(nextStep);
                    return;
                  }
                  if (runs.length >= 100) {
                    setScreen("choose");
                    return;
                  }
                  resetPosition();
                  const next: Amounts = [0, 0, 0, 0];
                  next[product * 2 + side] = 10;
                  setAmounts(next);
                }}
              />
            ) : null}

            {["choose", "watch", "claim"].includes(screen) ? (
              <StepBar
                current={screen as StepKey}
                done={{ choose: deposited, watch: done, claim: claimed }}
                enabled={{
                  choose: true,
                  watch: deposited,
                  claim: deposited && done,
                }}
                onGo={setScreen}
              />
            ) : null}
            {screen === "choose" ? (
              runs.length >= 100 ? (
                <Card>
                  <h1 className="text-2xl font-semibold">
                    Your saved portfolio has reached its limit.
                  </h1>
                  <p className="mt-3 text-sm text-muted">
                    You have saved 100 position previews. Reset the practice
                    balance in Wallet to start again.
                  </p>
                  <div className="mt-5 max-w-64">
                    <Button onClick={() => setScreen("wallet")}>
                      Open wallet controls →
                    </Button>
                  </div>
                </Card>
              ) : (
                <ScreenChoose
                  key={deposited ? "locked" : "editable"}
                  amounts={amounts}
                  setAmounts={setAmounts}
                  deposited={deposited}
                  availableBalance={balance}
                  onDeposited={() => {
                    if (runs.length >= 100) {
                      setScreen("wallet");
                      return;
                    }
                    setDeposited(true);
                    setRunning(true);
                    setScreen("watch");
                  }}
                />
              )
            ) : null}
            {screen === "watch" ? (
              <>
                <div>
                  <Tag tone="accent">US CPI · Jan 2021–Dec 2024</Tag>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                    Every month changes the path.
                  </h1>
                  <p className="mt-2 max-w-2xl text-muted">
                    Follow your {fmt(total)} PLAY position across the full
                    period. Each recorded month contributes to the score.
                  </p>
                </div>
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-muted">
                        {observed
                          ? CPI_YOY[observed - 1].period
                          : "Ready to replay"}
                      </p>
                      <p className="num mt-2 text-5xl font-semibold">
                        {observed
                          ? `${CPI_YOY[observed - 1].value.toFixed(2)}%`
                          : "—"}
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        Recorded US inflation · year on year
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="num text-2xl font-semibold text-brand">
                        {observed}
                        <span className="text-base text-muted"> / 48</span>
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        monthly readings
                      </p>
                      <Tag tone={done ? "up" : "muted"}>
                        {done
                          ? "Replay complete"
                          : running
                            ? "Replaying history"
                            : "Paused"}
                      </Tag>
                    </div>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Historical replay progress"
                    aria-valuenow={observed}
                    aria-valuemin={0}
                    aria-valuemax={48}
                    className="mt-6 h-2.5 overflow-hidden rounded-full bg-panel-2"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-all duration-200"
                      style={{ width: `${(observed / 48) * 100}%` }}
                    />
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    {[
                      {
                        l: "Cooling score",
                        s: scores.cooling,
                        t: `${stats.largestDecline.toFixed(2)} point fall from peak`,
                      },
                      {
                        l: "Excess score",
                        s: scores.excess,
                        t: `${stats.accumulatedExcess.toFixed(1)} point-months above 4%`,
                      },
                    ].map((p) => (
                      <div key={p.l} className="rounded-2xl bg-panel-2 p-4">
                        <p className="text-xs text-muted">{p.l}</p>
                        <p className="num mt-2 text-3xl font-semibold">
                          <AnimatedNumber value={p.s * 100} />%
                        </p>
                        <p className="mt-2 text-xs text-muted">{p.t}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                    <p className="max-w-lg text-xs text-muted">
                      This is a local playback of recorded data. The keeper’s
                      real devnet replay and settlement are linked separately
                      below.
                    </p>
                    <div className="w-full sm:w-56">
                      {done ? (
                        <Button onClick={() => setScreen("claim")}>
                          Review settlement →
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => setRunning(!running)}
                        >
                          {running ? "Pause replay" : "Resume replay"}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
                <Card>
                  <InflationTimeline observed={observed} />
                </Card>
                <Proof />
              </>
            ) : null}
            {screen === "claim" ? (
              <>
                <div>
                  <Tag tone={claimed ? "up" : "accent"}>
                    {claimed
                      ? "Saved to portfolio"
                      : "48 of 48 readings complete"}
                  </Tag>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                    {claimed
                      ? "Result added to your portfolio."
                      : "The path has a result."}
                  </h1>
                  <p className="mt-2 text-muted">
                    Illustrative payout using the recorded path and seeded
                    pools. No tokens are transferred.
                  </p>
                </div>
                <Card className="border-accent/40">
                  <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
                    <div>
                      <p className="text-sm text-muted">Illustrative payout</p>
                      <p className="num mt-3 text-5xl font-semibold text-brand">
                        <AnimatedNumber value={payout} decimals={6} />
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        PLAY on a {fmt(total)} PLAY practice position
                      </p>
                      <p
                        className={`num mt-5 text-lg ${payout >= total ? "text-up" : "text-down"}`}
                      >
                        {payout >= total ? "+" : ""}
                        {fmt(payout - total)} PLAY difference
                      </p>
                    </div>
                    <div className="flex flex-col justify-center rounded-2xl bg-panel-2 p-5">
                      <p className="text-sm font-medium">
                        Your choice, by product
                      </p>
                      {claimsBySide(amounts, FINAL_SCORES).map((v, j) =>
                        amounts[j] ? (
                          <div
                            key={j}
                            className="mt-3 flex justify-between gap-2 text-sm"
                          >
                            <span className="text-muted">
                              {
                                [
                                  "Cooling · More",
                                  "Cooling · Less",
                                  "Excess · More",
                                  "Excess · Less",
                                ][j]
                              }
                            </span>
                            <span className="num">{fmt(v)} PLAY</span>
                          </div>
                        ) : null,
                      )}
                      <div className="mt-5">
                        {claimed ? (
                          <Button onClick={() => setScreen("history")}>
                            View portfolio →
                          </Button>
                        ) : (
                          <Button onClick={finishRun} disabled={!done}>
                            Save settlement preview →
                          </Button>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {claimed
                          ? "Result saved in this browser."
                          : "Practice portfolio only · no wallet transfer."}
                      </p>
                    </div>
                  </div>
                </Card>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      t: "Inflation Cooling",
                      s: FINAL_SCORES.cooling,
                      text: "Largest fall: 6.6191 points · cap 8 points",
                    },
                    {
                      t: "Excess Inflation",
                      s: FINAL_SCORES.excess,
                      text: "69.1184 point-months above 4% · cap 80",
                    },
                  ].map((p) => (
                    <Card key={p.t}>
                      <p className="text-sm text-muted">{p.t}</p>
                      <p className="num mt-2 text-3xl font-semibold">
                        <AnimatedNumber value={p.s * 100} />%
                      </p>
                      <p className="mt-2 text-xs text-muted">{p.text}</p>
                    </Card>
                  ))}
                </div>
                <Proof />
              </>
            ) : null}
            {screen === "explore" ? <ExploreScreen /> : null}
            {screen === "news" ? <NewsScreen /> : null}
            {screen === "history" ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <Tag>Practice portfolio</Tag>
                    <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                      Your choices. Your results.
                    </h1>
                    <p className="mt-2 max-w-2xl text-muted">
                      Your settled position previews, saved on this device.
                      Compare how different sides respond to the same inflation
                      path.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      claimed || !deposited ? startNew() : setNewRunPrompt(true)
                    }
                    className="rounded-full bg-night px-5 py-3 text-sm font-semibold text-white"
                  >
                    New position →
                  </button>
                </div>
                {newRunPrompt ? (
                  <Card>
                    <p>
                      Start a new position? Your unfinished preview will be
                      reset.
                    </p>
                    <div className="mt-4 flex gap-4">
                      <button
                        type="button"
                        className="text-brand underline"
                        onClick={startNew}
                      >
                        Start new
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewRunPrompt(false)}
                      >
                        Keep current run
                      </button>
                    </div>
                  </Card>
                ) : null}
                {!runs.length ? (
                  <Card className="py-12 text-center">
                    <span className="text-4xl text-accent" aria-hidden>
                      ↗
                    </span>
                    <h2 className="mt-3 text-xl font-semibold">
                      Your first result starts with a choice.
                    </h2>
                    <p className="mt-2 text-sm text-muted">
                      Build a position and save its settlement preview to see it
                      here.
                    </p>
                    <div className="mx-auto mt-5 max-w-56">
                      <Button onClick={() => setScreen(nextStep)}>
                        Build a position →
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {[...runs].reverse().map((r, i) => (
                      <Card key={r.id} className="!py-5">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <p className="font-semibold">
                              Position {runs.length - i}{" "}
                              <span className="ml-2 text-xs font-normal text-muted">
                                Preview settled
                              </span>
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {new Date(r.at).toLocaleString("en-GB", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </p>
                            <p className="mt-2 text-sm text-muted">
                              {sidesText(r.amounts)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="num text-2xl font-semibold">
                              {fmt(r.back)}{" "}
                              <span className="text-xs font-normal text-muted">
                                PLAY
                              </span>
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              Illustrative payout · {fmt(r.put)} put in
                            </p>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
                <Proof />
              </>
            ) : null}
            {screen === "wallet" ? (
              <>
                <div>
                  <Tag>PLAY wallet · Devnet</Tag>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                    Everything in one place.
                  </h1>
                  <p className="mt-2 max-w-2xl text-muted">
                    Your practice portfolio and read-only devnet wallet lookup.
                    Practice activity stays on this device.
                  </p>
                </div>
                <WalletReadPanel />
                <section className="rounded-3xl bg-night p-7 text-white md:p-9">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div>
                      <p className="text-sm text-white/60">
                        Available practice balance
                      </p>
                      <p className="num mt-3 text-4xl font-semibold sm:text-5xl">
                        <AnimatedNumber value={balance} />{" "}
                        <span className="text-lg font-normal text-white/50">
                          PLAY
                        </span>
                      </p>
                      <p className="mt-4 text-xs text-white/60">
                        1,000 PLAY starting balance · test tokens, no cash value
                      </p>
                    </div>
                    <span className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/70">
                      No wallet connected
                    </span>
                  </div>
                  <div className="mt-7 grid gap-5 border-t border-white/15 pt-5 sm:grid-cols-3">
                    {[
                      {
                        l: "In position",
                        v: deposited && !claimed ? total : 0,
                      },
                      {
                        l: "Completed payouts",
                        v: runs.reduce((s, r) => s + r.back, 0),
                      },
                      { l: "Net result", v: historyDelta },
                    ].map((p) => (
                      <div key={p.l}>
                        <p className="text-xs text-white/60">{p.l}</p>
                        <p className="num mt-2 text-xl">{fmt(p.v)} PLAY</p>
                      </div>
                    ))}
                  </div>
                </section>
                <Card>
                  <h2 className="text-xl font-semibold">Activity</h2>
                  <p className="mt-1 text-sm text-muted">
                    Local records only. For actual on-chain activity, open the
                    proof below.
                  </p>
                  {!runs.length && !deposited ? (
                    <p className="py-8 text-sm text-muted">
                      Your position activity will appear here.
                    </p>
                  ) : (
                    <ul className="mt-5 divide-y divide-line">
                      {deposited && !claimed ? (
                        <li className="flex justify-between gap-3 py-4 text-sm">
                          <span>
                            Current position preview
                            <span className="mt-1 block text-xs text-muted">
                              {running
                                ? "Historical replay running"
                                : done
                                  ? "Settlement preview ready"
                                  : "Replay paused"}
                            </span>
                          </span>
                          <span className="num">−{fmt(total)} PLAY</span>
                        </li>
                      ) : null}
                      {[...runs].reverse().map((r) => (
                        <li
                          key={r.id}
                          className="flex justify-between gap-3 py-4 text-sm"
                        >
                          <div>
                            <p className="font-medium">
                              Position preview settled
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {fmt(r.put)} put in → {fmt(r.back)} illustrative
                              payout
                            </p>
                          </div>
                          <span
                            className={`num ${r.back >= r.put ? "text-up" : "text-down"}`}
                          >
                            {r.back >= r.put ? "+" : ""}
                            {fmt(r.back - r.put)} PLAY
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Proof />
                <details className="rounded-2xl border border-line px-5 py-4 text-sm">
                  <summary className="cursor-pointer text-muted">
                    Practice settings
                  </summary>
                  <p className="mt-3 text-xs text-muted">
                    Reset removes this device’s saved previews and restores
                    1,000 PLAY. Your profile is kept.
                  </p>
                  {resetPrompt ? (
                    <div className="mt-4 flex gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          saveRuns([]);
                          setRuns([]);
                          setResetPrompt(false);
                          setStorageNotice("");
                          resetPosition();
                        }}
                        className="text-down underline"
                      >
                        Confirm reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetPrompt(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setResetPrompt(true)}
                      className="mt-4 text-brand underline"
                    >
                      Reset practice balance
                    </button>
                  )}
                </details>
              </>
            ) : null}
          </>
        )}
      </main>
      <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 border-t border-line px-4 py-6 text-[11px] text-muted md:px-8">
        <p>MacroPaths · OxHack ’26 · US BLS / FRED data</p>
        <p>
          Solana devnet · PLAY test tokens · Personal positions are previews
        </p>
      </footer>
    </div>
  );
}
