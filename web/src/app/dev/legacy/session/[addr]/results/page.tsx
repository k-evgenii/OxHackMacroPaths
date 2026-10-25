import { PositionsResponse, SessionView } from "@macropaths/client";
import { USE_FIXTURES, fetchJson } from "@/lib/api-client";
import { ResultsView } from "./ResultsView";

export default async function Page({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  const [session, positions] = USE_FIXTURES
    ? await Promise.all([
        fetchJson(`/api/sessions/${addr}`, SessionView).catch(() => undefined),
        fetchJson(`/api/sessions/${addr}/positions`, PositionsResponse).catch(() => undefined),
      ])
    : [undefined, undefined];
  return <ResultsView addr={addr} initialSession={session} initialPositions={positions} />;
}
