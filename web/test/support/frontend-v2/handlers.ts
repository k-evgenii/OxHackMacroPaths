// TEST-ONLY fixture-backed endpoint handlers for the frontend v2 routes. Never imported by production
// code (guarded by harness.test.ts). Use `createFixtureFetch()` as a fake global fetch in vitest, or
// `fixtureMswHandlers()` with msw's setupServer.
import { http, HttpResponse } from "msw";
import type {
  EventsResponse,
  SessionOverviewResponse,
  WalletActivityResponse,
  WalletOverviewResponse,
} from "@macropaths/client";
import { scenarios } from "../../../../packages/client/fixtures/frontend-v2";

export type FixtureOptions = {
  /** wallet overview scenario served for any owner (default: owner-specific lookup, else emptyOwner) */
  wallet?: keyof typeof scenarios.wallet;
  activity?: keyof typeof scenarios.activity;
  events?: keyof typeof scenarios.events;
  /** catalog variant */
  catalog?: "reference" | "multi";
  /** force a route to fail with this status (502 rpc_error by default) */
  fail?: Partial<Record<"catalog" | "overview" | "wallet" | "activity" | "events" | "bundle", number>>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiError = (status: number) =>
  json(
    {
      error: status === 404 ? "not found" : status === 400 ? "bad request" : "upstream RPC failed",
      code: status === 404 ? "not_found" : status === 400 ? "bad_request" : status === 502 ? "rpc_error" : "internal",
    },
    status,
  );

const overviews = (): SessionOverviewResponse[] => Object.values(scenarios.overview);

/** Route a request to its fixture, or undefined when the path is not a frontend v2 route. */
export function handleFixtureRequest(input: string | URL | Request, opts: FixtureOptions = {}): Response | undefined {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://fixture");
  const p = url.pathname;
  const fail = (k: keyof NonNullable<FixtureOptions["fail"]>) => (opts.fail?.[k] ? apiError(opts.fail[k]!) : undefined);
  let m: RegExpMatchArray | null;

  if (p === "/api/catalog") return fail("catalog") ?? json(opts.catalog === "multi" ? scenarios.catalogMulti : scenarios.catalog);
  if (p === "/api/artifacts/bundle") return fail("bundle") ?? json(scenarios.research.bundle);
  if ((m = p.match(/^\/api\/sessions\/([^/]+)\/overview$/))) {
    const o = overviews().find((x) => x.session.address === m![1]);
    return fail("overview") ?? (o ? json(o) : apiError(404));
  }
  if ((m = p.match(/^\/api\/sessions\/([^/]+)\/events$/))) {
    const e: EventsResponse = scenarios.events[opts.events ?? "sessionAPage"];
    return fail("events") ?? json(e);
  }
  if ((m = p.match(/^\/api\/wallet\/([^/]+)\/activity$/))) {
    const a: WalletActivityResponse = scenarios.activity[opts.activity ?? "full"];
    return fail("activity") ?? json(a);
  }
  if ((m = p.match(/^\/api\/wallet\/([^/]+)$/))) {
    const owner = m[1];
    let w: WalletOverviewResponse;
    if (opts.wallet) w = { ...scenarios.wallet[opts.wallet], owner };
    else w = Object.values(scenarios.wallet).find((x) => x.owner === owner) ?? { ...scenarios.wallet.emptyOwner, owner };
    return fail("wallet") ?? json(w);
  }
  return undefined;
}

/** A fetch replacement answering frontend v2 routes from fixtures; other paths reject loudly. */
export function createFixtureFetch(opts: FixtureOptions = {}): typeof fetch {
  return async (input, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const res = handleFixtureRequest(input as string | URL | Request, opts);
    if (!res) throw new Error(`fixture harness: no handler for ${String(input instanceof Request ? input.url : input)}`);
    return res;
  };
}

/** msw request handlers for the same routes (use with setupServer from "msw/node"). */
export function fixtureMswHandlers(opts: FixtureOptions = {}) {
  const route = ({ request }: { request: Request }) => {
    const res = handleFixtureRequest(request, opts);
    return res ?? HttpResponse.json({ error: "no fixture", code: "not_found" }, { status: 404 });
  };
  return [
    http.get("*/api/catalog", route),
    http.get("*/api/artifacts/bundle", route),
    http.get("*/api/sessions/:addr/overview", route),
    http.get("*/api/sessions/:addr/events", route),
    http.get("*/api/wallet/:owner/activity", route),
    http.get("*/api/wallet/:owner", route),
  ];
}
