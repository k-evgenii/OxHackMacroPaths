"use client";
import { Addr, Badge } from "@/components/ui";
import { useSession } from "@/lib/hooks";

/** Title row shared by every /session/[addr] page: address, state badge, observation progress. */
export function SessionHeader({ addr }: { addr: string }) {
  const { data } = useSession(addr);
  return (
    <div className="mb-5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <h1 className="text-xl font-semibold">Session</h1>
      <Addr value={addr} />
      {data && (
        <>
          <Badge variant={data.state} />
          <span className="num text-xs text-muted">
            {data.nextIndex}/{data.nObs} observations
          </span>
        </>
      )}
    </div>
  );
}
