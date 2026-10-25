import { Prefetch } from "@/components/shell/Prefetch";
import { healthQuery, sessionsQuery } from "@/lib/hooks/queries";
import { Overview } from "@/components/shell/Overview";

export default function Home() {
  return (
    <Prefetch queries={[healthQuery(), sessionsQuery()]}>
      <Overview />
    </Prefetch>
  );
}
