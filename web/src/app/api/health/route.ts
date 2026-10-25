import { Health, PROGRAM_ID } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { cached, rpc } from "@/server/rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(async () => {
    // Every open tab polls this every 5 s; share one pair of RPC calls between them.
    const body = await cached("health", 4_000, async () => {
      const [slot, info] = await Promise.all([
        rpc("getSlot", (c) => c.getSlot()),
        rpc("getAccountInfo", (c) => c.getAccountInfo(PROGRAM_ID)),
      ]);
      return {
        cluster: process.env.NEXT_PUBLIC_CLUSTER ?? "devnet",
        slot,
        programId: PROGRAM_ID.toBase58(),
        executable: info?.executable ?? false,
      };
    }, { stale: false }); // a stale slot would misreport liveness
    return okJson(Health, body);
  });
}
