import { Prefetch } from "@/components/shell/Prefetch";
import { SessionHeader } from "@/components/shell/SessionHeader";
import { sessionQuery } from "@/lib/hooks/queries";

export default async function SessionLayout({
  params,
  children,
}: {
  params: Promise<{ addr: string }>;
  children: React.ReactNode;
}) {
  const { addr } = await params;
  return (
    <Prefetch queries={[sessionQuery(addr)]}>
      <SessionHeader addr={addr} />
      {children}
    </Prefetch>
  );
}
