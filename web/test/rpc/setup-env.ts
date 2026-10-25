// Vitest setup: live-mode tests need an explicit server RPC_URL now that the public-devnet fallback is gone.
// A non-routable placeholder; tests mock Connection/fetch, so nothing is ever contacted.
process.env.RPC_URL ||= "https://example.invalid/rpc";
