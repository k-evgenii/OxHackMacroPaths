import { SellerResponse } from "@macropaths/client";
import { USE_FIXTURES, fetchJson } from "@/lib/api-client";
import { SellerPanel } from "./SellerPanel";

export default async function Page({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  const initial = USE_FIXTURES
    ? await fetchJson(`/api/sessions/${addr}/seller`, SellerResponse).catch(() => undefined)
    : undefined;
  return <SellerPanel addr={addr} initial={initial} />;
}
