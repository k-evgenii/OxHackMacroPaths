import { Prefetch } from "@/components/shell/Prefetch";
import { eventsQuery } from "@/lib/hooks/queries";
import { ActivityFeed } from "./ActivityFeed";

export default async function ActivityPage({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  return (
    <Prefetch infinite={[eventsQuery(addr)]}>
      <ActivityFeed addr={addr} />
    </Prefetch>
  );
}
