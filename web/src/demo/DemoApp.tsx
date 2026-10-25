"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ScreenChoose from "./components/ScreenChoose";
import Proof from "./components/Proof";
import { Button, Card, StepBar, Tag, fmt, type StepKey } from "./components/ui";
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

type Screen = "home" | "account" | "wallet" | "history" | "explore" | StepKey;
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

export default function DemoApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
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
    if (ready) titleRef.current?.focus();
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
        "This demo ledger has reached 100 runs. Reset it in Demo controls to start again.",
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
    { key: "play", label: "Play" },
    { key: "explore", label: "Explore" },
    { key: "history", label: "History" },
    { key: "wallet", label: "Wallet" },
  ] as const;
  const activeNav = ["choose", "watch", "claim"].includes(screen)
    ? "play"
    : screen;

  return (
    <div className="min-h-screen">
      <a
        href="#demo-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-panel focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
          <button
            type="button"
            onClick={() => setScreen("home")}
            className="flex items-center gap-2.5"
            aria-label="MacroPaths home"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent font-bold text-white">
              M<span className="sr-only">acroPaths</span>
            </span>
            <span className="text-lg font-semibold tracking-tight">
              MacroPaths<span className="ml-1 text-accent">.</span>
            </span>
          </button>
          <nav
            aria-label="Main"
            className="order-3 flex w-full gap-1 rounded-full bg-night p-1.5 sm:order-none sm:w-auto"
          >
            {nav.map((n) => (
              <button
                key={n.key}
                type="button"
                disabled={!name}
                aria-current={activeNav === n.key ? "page" : undefined}
                onClick={() => setScreen(n.key === "play" ? nextStep : n.key)}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${activeNav === n.key ? "bg-accent text-white" : "text-white/80 hover:bg-white/10"}`}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setScreen("account")}
            aria-label="Account settings"
            className="flex items-center gap-2 rounded-full border border-line bg-panel py-1.5 pl-1.5 pr-3 text-sm"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/10 font-semibold text-brand">
              {name ? name.slice(0, 1).toUpperCase() : "↗"}
            </span>
            <span className="max-w-24 truncate">{name || "Demo profile"}</span>
          </button>
        </div>
      </header>
      <div className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-1 px-4 py-2 text-xs md:px-8">
          <span className="font-medium text-brand">
            Interactive walkthrough · no wallet transactions
          </span>
          <span className="text-muted">
            US CPI case study · PLAY has no cash value
          </span>
        </div>
      </div>
      <main
        id="demo-main"
        ref={titleRef}
        tabIndex={-1}
        className="mx-auto max-w-6xl space-y-6 px-4 pb-16 pt-7 outline-none md:px-8 md:pt-10"
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
            Loading your demo…
          </div>
        ) : !name || screen === "account" ? (
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
                  "Review your result and demo wallet",
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
                A local demo profile for this browser. No password or real
                account is needed.
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
                  {name ? "Save profile" : "Enter demo →"}
                </button>
              </form>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                Only your display name and demo history are saved locally.
                Wallet identity and real transaction signing are separate.
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
                  Leave demo profile
                </button>
              ) : null}
            </Card>
          </div>
        ) : (
          <>
            {screen === "home" ? (
              <>
                <section className="reveal relative overflow-hidden rounded-3xl bg-night px-7 py-9 text-white md:px-10 md:py-12">
                  <div
                    className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full bg-accent/20 blur-3xl"
                    aria-hidden
                  />
                  <div className="relative grid gap-8 md:grid-cols-[1.5fr_1fr] md:items-center">
                    <div>
                      <p className="text-sm font-medium text-[#ffb489]">
                        YOUR EXPOSURE. YOUR CHOICE.
                      </p>
                      <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
                        A position on the path.
                        <br />
                        <span className="text-[#ff9a5c]">
                          Not just the endpoint.
                        </span>
                      </h1>
                      <p className="mt-5 max-w-xl leading-relaxed text-white/75">
                        Inflation can run hot, stay high or cool sharply. Choose
                        which movement matters to you, then follow the payout
                        rule through a historical case study.
                      </p>
                      <div className="mt-7 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => setScreen(nextStep)}
                          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white"
                        >
                          {deposited
                            ? "Continue your walkthrough →"
                            : "Choose your goal →"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setScreen("explore")}
                          className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white"
                        >
                          Explore the history ↗
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3 rounded-2xl border border-white/15 bg-white/5 p-5">
                      <p className="text-xs font-medium uppercase tracking-widest text-white/50">
                        Hello, {name}
                      </p>
                      <p className="mt-2 text-sm text-white/70">
                        Your demo balance
                      </p>
                      <p className="num text-4xl font-semibold">
                        {fmt(balance)}
                        <span className="ml-2 text-sm font-normal text-white/60">
                          PLAY
                        </span>
                      </p>
                      <div className="border-t border-white/10 pt-4 text-sm text-white/70">
                        <p>
                          {runs.length} completed walkthrough
                          {runs.length === 1 ? "" : "s"}
                        </p>
                        <p className="mt-1">
                          {deposited && !claimed
                            ? `${fmt(total)} PLAY in this demo position`
                            : "Ready when you are"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setScreen("wallet")}
                        className="text-sm font-medium text-[#ffb489]"
                      >
                        Open demo wallet →
                      </button>
                    </div>
                  </div>
                </section>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">
                      Two ways to follow inflation
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      You choose the side. We explain the rule.
                    </p>
                  </div>
                  <Tag>US CPI · More / Less</Tag>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  {[
                    {
                      n: "01",
                      title: "Inflation Cooling",
                      text: "Pays on the largest fall in inflation from an earlier peak.",
                      rule: "More cooling → a higher More-side score",
                      stat: "8 point",
                      sub: "fall reaches the score cap",
                    },
                    {
                      n: "02",
                      title: "Excess Inflation",
                      text: "Pays on how long and how far inflation stays above 4%.",
                      rule: "More excess → a higher More-side score",
                      stat: "80 point-month",
                      sub: "excess reaches the score cap",
                    },
                  ].map((p) => (
                    <Card key={p.n}>
                      <div className="flex items-center justify-between">
                        <span className="num text-sm text-brand">
                          {p.n} / PATH PRODUCT
                        </span>
                        <span className="text-2xl text-accent" aria-hidden>
                          ↗
                        </span>
                      </div>
                      <h3 className="mt-5 text-2xl font-semibold">{p.title}</h3>
                      <p className="mt-2 max-w-md text-muted">{p.text}</p>
                      <p className="mt-5 text-sm font-medium">{p.rule}</p>
                      <div className="mt-5 border-t border-line pt-4">
                        <span className="num text-xl font-semibold">
                          {p.stat}
                        </span>
                        <span className="ml-2 text-xs text-muted">{p.sub}</span>
                      </div>
                    </Card>
                  ))}
                </div>
                <Card className="!py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">
                        Four years of history. Twelve seconds to understand it.
                      </h2>
                      <p className="mt-1 max-w-3xl text-sm text-muted">
                        This case study compresses Jan 2021–Dec 2024. The
                        historical dates describe the dataset, not a new
                        four-year commitment. Future terms are outside this
                        demo.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScreen("choose")}
                      className="shrink-0 text-sm font-semibold text-brand"
                    >
                      See how it works →
                    </button>
                  </div>
                </Card>
                <Proof />
              </>
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
                    Your demo ledger is full.
                  </h1>
                  <p className="mt-3 text-sm text-muted">
                    You have completed 100 walkthroughs. Reset the demo ledger
                    in Wallet to start again with 1,000 PLAY.
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
                  <Tag tone="accent">
                    Historical replay · 12-second walkthrough
                  </Tag>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                    Every month changes the path.
                  </h1>
                  <p className="mt-2 max-w-2xl text-muted">
                    Your {fmt(total)} demo PLAY follows the 2021–24 case study.
                    The scores update from the recorded monthly readings.
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
                          {(p.s * 100).toFixed(2)}%
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
                          See illustrative result →
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
                <Proof />
              </>
            ) : null}
            {screen === "claim" ? (
              <>
                <div>
                  <Tag tone={claimed ? "up" : "accent"}>
                    {claimed
                      ? "Saved to demo history"
                      : "Historical case study complete"}
                  </Tag>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                    {claimed
                      ? "Your walkthrough, complete."
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
                        {fmt(payout, 6)}
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        PLAY on {fmt(total)} demo PLAY put in
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
                            View demo history →
                          </Button>
                        ) : (
                          <Button onClick={finishRun} disabled={!done}>
                            Complete demo claim →
                          </Button>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {claimed
                          ? "Result saved in this browser."
                          : "Updates your local demo ledger and history."}
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
                        {(p.s * 100).toFixed(2)}%
                      </p>
                      <p className="mt-2 text-xs text-muted">{p.text}</p>
                    </Card>
                  ))}
                </div>
                <Proof />
              </>
            ) : null}
            {screen === "explore" ? <ExploreScreen /> : null}
            {screen === "history" ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <Tag>Local demo history</Tag>
                    <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                      Your choices. Your results.
                    </h1>
                    <p className="mt-2 max-w-2xl text-muted">
                      Completed walkthroughs saved in this browser. Every run
                      uses the same recorded path; changing sides changes the
                      result.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      claimed || !deposited ? startNew() : setNewRunPrompt(true)
                    }
                    className="rounded-full bg-night px-5 py-3 text-sm font-semibold text-white"
                  >
                    New walkthrough →
                  </button>
                </div>
                {newRunPrompt ? (
                  <Card>
                    <p>
                      Start a new walkthrough? Your unfinished local position
                      will be reset.
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
                      Complete a demo claim to save your result here.
                    </p>
                    <div className="mx-auto mt-5 max-w-56">
                      <Button onClick={() => setScreen(nextStep)}>
                        Continue walkthrough →
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
                              Walkthrough {runs.length - i}{" "}
                              <span className="ml-2 text-xs font-normal text-muted">
                                Demo complete
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
                  <Tag>Demo ledger · stored in this browser</Tag>
                  <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                    Everything in one place.
                  </h1>
                  <p className="mt-2 max-w-2xl text-muted">
                    Track the walkthrough’s PLAY balance, position and results.
                    A real Solana wallet is not connected.
                  </p>
                </div>
                <section className="rounded-3xl bg-night p-7 text-white md:p-9">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div>
                      <p className="text-sm text-white/60">
                        Available demo balance
                      </p>
                      <p className="num mt-3 text-4xl font-semibold sm:text-5xl">
                        {fmt(balance)}{" "}
                        <span className="text-lg font-normal text-white/50">
                          PLAY
                        </span>
                      </p>
                      <p className="mt-4 text-xs text-white/60">
                        Started with 1,000 demo PLAY · no cash value
                      </p>
                    </div>
                    <span className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/70">
                      No wallet connected
                    </span>
                  </div>
                  <div className="mt-7 grid gap-5 border-t border-white/15 pt-5 sm:grid-cols-3">
                    {[
                      {
                        l: "In demo position",
                        v: deposited && !claimed ? total : 0,
                      },
                      {
                        l: "Completed payouts",
                        v: runs.reduce((s, r) => s + r.back, 0),
                      },
                      { l: "Net demo result", v: historyDelta },
                    ].map((p) => (
                      <div key={p.l}>
                        <p className="text-xs text-white/60">{p.l}</p>
                        <p className="num mt-2 text-xl">{fmt(p.v)} PLAY</p>
                      </div>
                    ))}
                  </div>
                </section>
                <Card>
                  <h2 className="text-xl font-semibold">Demo activity</h2>
                  <p className="mt-1 text-sm text-muted">
                    Local records only. For actual on-chain activity, open the
                    proof below.
                  </p>
                  {!runs.length && !deposited ? (
                    <p className="py-8 text-sm text-muted">
                      Your walkthrough activity will appear here.
                    </p>
                  ) : (
                    <ul className="mt-5 divide-y divide-line">
                      {deposited && !claimed ? (
                        <li className="flex justify-between gap-3 py-4 text-sm">
                          <span>
                            Current demo position
                            <span className="mt-1 block text-xs text-muted">
                              {running
                                ? "Historical replay running"
                                : done
                                  ? "Ready for demo claim"
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
                            <p className="font-medium">Completed demo run</p>
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
                    Demo controls
                  </summary>
                  <p className="mt-3 text-xs text-muted">
                    Reset removes this browser’s demo history and restores 1,000
                    PLAY. Your profile is kept.
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
                      Reset demo ledger
                    </button>
                  )}
                </details>
              </>
            ) : null}
          </>
        )}
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 border-t border-line px-4 py-6 text-xs text-muted md:px-8">
        <p>MacroPaths · OxHack ’26 · US BLS / FRED data</p>
        <p>Historical transparency. Your decision.</p>
      </footer>
    </div>
  );
}
