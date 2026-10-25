"use client";

import { useState } from "react";
import {
  SessionView as SessionSchema,
  type SessionView,
} from "@macropaths/client";
import reference from "@macropaths/client/fixtures/session-B89z.view.json";
import { fetchJson, USE_FIXTURES } from "@/lib/api-client";
import { Card, Tag } from "./ui";
import { PROGRAM_ID, SESSION_ADDRESS } from "../lib/demoData";

const TX = [
  [
    "Create session",
    "2Brpr2T3oEaPQqAvkFxeQBAkQEDB2UZ9r2tYF2GnPq1paC2Ct2o67SfyqCYx5sHsNQ5THkLHzMoGkAMPeVyiSaR4",
  ],
  [
    "Record a month",
    "4rrUGVz4eVjHNi23Bh2R5uCeGNpQj88L57k4uu8zVsR9NuSEhSXACgeR77h8pjB3WcTAP2HqjeBSqBAnBsSddpeA",
  ],
  [
    "Settle session",
    "3hq1yZunZwcaK6vsZgJ1ggVsQ6PS1eT57FuhBkpgXipvGgoyAaNG1JAkNua6a1j1izUWQjf5Kg58ySoxNZy7E2Xv",
  ],
];
export default function Proof() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  async function refresh() {
    setStatus("loading");
    try {
      const result = await fetchJson(
        `/api/sessions/${SESSION_ADDRESS}`,
        SessionSchema,
      );
      if (
        !result.integrityOk ||
        result.datasetId !== reference.datasetId ||
        result.nextIndex !== 48 ||
        result.state !== "Settled" ||
        result.scores.some((s, i) => s !== reference.scores[i])
      )
        throw new Error(
          "Reference-session verification did not match the recorded result.",
        );
      setSession(result);
      setStatus("ok");
    } catch (e) {
      setSession(null);
      setError(e instanceof Error ? e.message : "Unable to read devnet.");
      setStatus("error");
    }
  }
  return (
    <Card className="!p-5">
      <details>
        <summary className="cursor-pointer font-semibold">
          Settlement & verification{" "}
          <span className="ml-2 text-xs font-normal text-muted">
            Recorded reference session ↗
          </span>
        </summary>
        <div className="mt-4 space-y-4 text-sm">
          <p className="max-w-2xl text-muted">
            The keeper funded and settled this reference session on Solana
            devnet. Personal positions use the same historical path and formula
            in preview; the links below show the recorded on-chain activity.
          </p>
          <div className="flex flex-wrap gap-2">
            <Tag>
              {status === "ok"
                ? USE_FIXTURES
                  ? "Fixture checked"
                  : "Devnet read verified"
                : "Recorded devnet evidence"}
            </Tag>
            <Tag>48 readings · 380 PLAY funded</Tag>
          </div>
          <div className="flex flex-wrap gap-4">
            <a
              className="text-brand underline"
              href={`https://explorer.solana.com/address/${SESSION_ADDRESS}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              Session account ↗
            </a>
            {TX.map(([label, id]) => (
              <a
                key={id}
                className="text-brand underline"
                href={`https://explorer.solana.com/tx/${id}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                {label} ↗
              </a>
            ))}
            <a
              className="text-brand underline"
              href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              Program ↗
            </a>
          </div>
          <button
            type="button"
            disabled={status === "loading"}
            onClick={refresh}
            className="rounded-full border border-line px-4 py-2 disabled:opacity-50"
          >
            {status === "loading"
              ? "Checking…"
              : USE_FIXTURES
                ? "Check saved fixture"
                : "Check devnet now"}
          </button>
          <div aria-live="polite">
            {status === "error" ? (
              <p className="text-down">
                {error} The recorded Explorer links remain available.
              </p>
            ) : session ? (
              <p className="text-up">
                {session.state} · Cooling{" "}
                {(Number(session.scores[0]) / 10000).toFixed(2)}% · Excess{" "}
                {(Number(session.scores[1]) / 10000).toFixed(2)}%
              </p>
            ) : null}
          </div>
        </div>
      </details>
    </Card>
  );
}
