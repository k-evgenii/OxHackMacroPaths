# @macropaths/client

Shared read client for the web app (and later the keeper). Source-only TypeScript package, consumed by
Next.js via `transpilePackages` and by vitest directly.

- `src/types.ts`: the frozen API contract (zod schemas + types). Integrator-owned.
- `src/index.ts`: public surface. Constants are final; functions are stubs until agent 1 implements them.
- `fixtures/`: real devnet data for reference session A (`B89zLL…`), decoded by an independent Python
  decoder. `session-B89z.base64` is the raw account; `*.view.json` are the expected contract outputs.
  Note: session A was created with the test caps (d_cap 80000, a_cap 800000), not the demo manifest caps.
