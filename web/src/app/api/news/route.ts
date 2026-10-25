import { getInflationNews } from "@/server/news";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getInflationNews(), {
    headers: {
      "cache-control": "public, max-age=60, stale-while-revalidate=120",
    },
  });
}
