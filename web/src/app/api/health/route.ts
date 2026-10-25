import { Health, PROGRAM_ID } from "@macropaths/client";
import { handle, okJson } from "@/server/errors";
import { rpc } from "@/server/rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(async () => {
    const [slot, info] = await Promise.all([
      rpc("getSlot", (c) => c.getSlot()),
      rpc("getAccountInfo", (c) => c.getAccountInfo(PROGRAM_ID)),
    ]);
    return okJson(Health, {
      cluster: process.env.NEXT_PUBLIC_CLUSTER ?? "devnet",
      slot,
      programId: PROGRAM_ID.toBase58(),
      executable: info?.executable ?? false,
    });
  });
}
