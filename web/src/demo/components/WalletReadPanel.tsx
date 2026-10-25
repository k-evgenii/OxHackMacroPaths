"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pubkey } from "@macropaths/client/types";
import { fmtPlay } from "@macropaths/client/format";
import { sumAmounts } from "@macropaths/client/presentation";
import { walletOverviewQuery } from "@/lib/queries";
import { explorerUrl, USE_FIXTURES } from "@/lib/api-client";
import { Card, Tag } from "./ui";

const short = (address: string) =>
  `${address.slice(0, 5)}…${address.slice(-5)}`;

export default function WalletReadPanel() {
  const [input, setInput] = useState("");
  const [owner, setOwner] = useState("");
  const [error, setError] = useState("");
  const wallet = useQuery({ ...walletOverviewQuery(owner), enabled: !!owner });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Pubkey.safeParse(input.trim());
    if (!parsed.success) {
      setError("Enter a valid Solana public address.");
      return;
    }
    setError("");
    setOwner(parsed.data);
  }

  async function sample() {
    const { FIXTURE_OWNER } = await import("@/lib/queries/fixture-router");
    setInput(FIXTURE_OWNER);
    setOwner(FIXTURE_OWNER);
    setError("");
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Wallet lookup
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            View registered PLAY balances and holdings by public address. This
            does not connect a signing wallet or move tokens.
          </p>
        </div>
        <Tag>{USE_FIXTURES ? "Sample data" : "Devnet · Read only"}</Tag>
      </div>
      {USE_FIXTURES ? (
        <p className="mt-4 rounded-xl bg-forecast/8 p-3 text-xs leading-relaxed text-muted">
          This build uses saved test data. Lookups do not show current wallet
          balances; only the sample address has example holdings.
        </p>
      ) : null}
      <form onSubmit={submit} className="mt-5 flex flex-wrap items-end gap-3">
        <label
          className="min-w-0 flex-1 basis-64 text-xs font-semibold"
          htmlFor="wallet-address"
        >
          Public address
          <input
            id="wallet-address"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={44}
            placeholder="Enter a Solana address"
            aria-invalid={!!error}
            aria-describedby={error ? "wallet-address-error" : undefined}
            className="mt-2 block h-12 w-full rounded-xl border border-line bg-panel-2 px-3 text-sm font-normal"
          />
        </label>
        <button
          type="submit"
          className="h-12 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink"
        >
          Look up wallet
        </button>
        {USE_FIXTURES ? (
          <button
            type="button"
            onClick={sample}
            className="h-12 rounded-xl border border-line px-4 text-sm font-semibold"
          >
            Use sample address
          </button>
        ) : null}
      </form>
      {error ? (
        <p
          role="alert"
          id="wallet-address-error"
          className="mt-3 text-sm text-down"
        >
          {error}
        </p>
      ) : null}
      {owner && wallet.isPending ? (
        <p role="status" className="mt-5 text-sm text-muted">
          Reading wallet…
        </p>
      ) : null}
      {wallet.error ? (
        <div role="alert" className="mt-5 text-sm text-down">
          <p>Wallet data is unavailable. {wallet.error.message}</p>
          <button
            type="button"
            onClick={() => wallet.refetch()}
            className="mt-2 underline"
          >
            Retry wallet lookup
          </button>
        </div>
      ) : null}
      {wallet.data ? (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
            <a
              href={explorerUrl("address", wallet.data.owner)}
              target="_blank"
              rel="noreferrer"
              className="text-brand underline"
            >
              {short(wallet.data.owner)} ↗
            </a>
            <span>
              {wallet.data.meta.source === "fixture"
                ? "Saved test snapshot"
                : "Read from devnet"}{" "}
              ·{" "}
              {new Date(wallet.data.meta.fetchedAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {wallet.data.balances.map(({ mint, read }) => (
              <div
                key={mint}
                className="rounded-xl border border-line bg-panel-2 p-4"
              >
                <p className="text-xs text-muted">
                  {USE_FIXTURES ? "Sample balance" : "Wallet balance"}
                </p>
                <p className="num mt-2 text-2xl font-semibold">
                  {read.status === "ok"
                    ? fmtPlay(read.data.amount, 6)
                    : "Unavailable"}
                </p>
                <a
                  href={explorerUrl("address", mint)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-muted underline"
                >
                  Token mint {short(mint)} ↗
                </a>
              </div>
            ))}
          </div>
          <div>
            <h3 className="text-sm font-semibold">
              Registered session holdings
            </h3>
            <ul className="mt-2 divide-y divide-line">
              {wallet.data.holdings.map(({ sessionAddress, read }) => (
                <li
                  key={sessionAddress}
                  className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm"
                >
                  <a
                    href={explorerUrl("address", sessionAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand underline"
                  >
                    Session {short(sessionAddress)} ↗
                  </a>
                  <div className="space-y-1 text-right">
                    {read.status === "unavailable" ? (
                      <p className="text-muted">Holdings unavailable</p>
                    ) : (
                      <>
                        {!read.data.position && !read.data.cover ? (
                          <p className="text-muted">
                            No holdings in this session
                          </p>
                        ) : null}
                        {read.data.position ? (
                          <>
                            <p className="num">
                              Pool deposits ·{" "}
                              {fmtPlay(
                                sumAmounts(read.data.position.deposited),
                                6,
                              )}
                            </p>
                            <p className="text-xs text-muted">
                              {read.data.position.claimed
                                ? "Payout recorded as claimed"
                                : "Position recorded · not claimed"}
                            </p>
                          </>
                        ) : null}
                        {read.data.cover ? (
                          <>
                            <p className="num">
                              Cover paid ·{" "}
                              {fmtPlay(
                                sumAmounts(read.data.cover.premiumPaid),
                                6,
                              )}
                            </p>
                            <p className="text-xs text-muted">
                              {read.data.cover.claimed
                                ? "Cover recorded as claimed"
                                : "Cover recorded · not claimed"}
                            </p>
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
