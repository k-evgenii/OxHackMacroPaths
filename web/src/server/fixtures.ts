// Explicit fixture mode at the HTTP boundary; live failures never receive sample data.
import type { z } from "zod";
import { okJson } from "./errors";

export async function fixtureJson<S extends z.ZodTypeAny>(path: string, schema: S): Promise<Response | null> {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES !== "1") return null;
  const { fixtureResponse } = await import("@/lib/queries/fixture-router");
  const fixture = fixtureResponse(path);
  if (!fixture) return Response.json({ error: "No fixture is published for this request.", code: "not_found" }, { status: 404 });
  if (fixture.status >= 400) return Response.json(fixture.body, { status: fixture.status, headers: { "cache-control": "no-store", "x-data-mode": "fixture" } });
  const response = okJson(schema, fixture.body);
  response.headers.set("x-data-mode", "fixture");
  return response;
}
