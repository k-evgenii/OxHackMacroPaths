import { readFile } from "node:fs/promises";
import path from "node:path";
import { handle, notFound } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAMES = new Set(["manifest", "forecast", "planner"]);

/** Directory holding the research artifacts (written by the data pipeline into web/public/data). */
const artifactsDir = () => process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), "public", "data");

export function GET(_req: Request, ctx: { params: Promise<{ name: string }> }): Promise<Response> {
  return handle(async () => {
    const { name } = await ctx.params;
    if (!NAMES.has(name)) throw notFound(`unknown artifact ${name}`);
    let text: string;
    try {
      text = await readFile(path.join(artifactsDir(), `${name}.json`), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw notFound(`artifact ${name} not published`);
      throw e;
    }
    JSON.parse(text); // a corrupt file is a 500, not a malformed 200
    return new Response(text, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  });
}
