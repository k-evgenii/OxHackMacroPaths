import { HttpError, handle, notFound } from "@/server/errors";
import { ARTIFACT_NAMES, BundleError, getArtifactText, getResearchBundle, type ArtifactName } from "@/server/research";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = (bundleId?: string) => ({
  "content-type": "application/json",
  "cache-control": "no-store",
  ...(bundleId ? { "x-research-bundle-id": bundleId, etag: `"${bundleId}"` } : {}),
});

/** Missing files are 404; any other bundle defect (malformed, inconsistent, unsupported) is a 500. */
function mapError(e: unknown): never {
  if (e instanceof BundleError) {
    if (e.code === "missing_file") throw notFound(e.message);
    console.error("[api] research bundle invalid", e.message);
    throw new HttpError("internal", "research bundle failed validation");
  }
  throw e;
}

export function GET(_req: Request, ctx: { params: Promise<{ name: string }> }): Promise<Response> {
  return handle(async () => {
    const { name } = await ctx.params;
    if (name === "bundle") {
      const bundle = await getResearchBundle().catch(mapError);
      return new Response(JSON.stringify(bundle), { headers: headers(bundle.id) });
    }
    if (!(ARTIFACT_NAMES as readonly string[]).includes(name)) throw notFound(`unknown artifact ${name}`);
    const text = await getArtifactText(name as ArtifactName).catch(mapError);
    JSON.parse(text); // a corrupt file is a 500, not a malformed 200
    return new Response(text, { headers: headers() });
  });
}
