import { SessionView } from "@macropaths/client";
import { USE_FIXTURES, fetchJson } from "@/lib/api-client";
import { PathView } from "./PathView";

export default async function Page({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  const initial = USE_FIXTURES ? await fetchJson(`/api/sessions/${addr}`, SessionView).catch(() => undefined) : undefined;
  return <PathView addr={addr} initial={initial} />;
}
