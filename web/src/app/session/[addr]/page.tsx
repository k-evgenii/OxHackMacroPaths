import { SessionPage } from "@/features/session";

export default async function Page({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  return <SessionPage addr={addr} />;
}
