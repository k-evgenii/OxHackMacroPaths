# Demo v16 integration

Plan: preserve the supplied light/orange visual system and existing typed API. Ship a local demo profile, Play, Explore, History and Wallet. Keep yearly charts in Explore and separate the local walkthrough from recorded Solana proof. Preserve the existing technical routes for the team.

Scope: historical replay, two CPI products, exact shared bigint payout formula, local demo ledger, source dates, explicit evidence links. No program or keeper changes. No new authentication service, password storage, bank integration, wallet transactions, seller extension, AI assistant, roadmap, bells or confetti.

Source: supplied macropaths-web-v16 (1).zip layered on dev/web-config-congruence f42704f. Implementation branch dev/demo-v16.

Acceptance: complete profile → goal/sides → review amount → compressed replay → illustrative result → history → wallet. Verify 33.827340 PLAY for the 10+10 example, fixture path equality, browser persistence, prevention of duplicate results, mobile and desktop, error states for proof reads. Existing client/API tests and build must pass.

The profile is a local display name, not authentication. Wallet figures are a local demo ledger. No transaction is signed, deposited or claimed by browser actions. The keeper's recorded reference session is separately linked. Live proof reads go through the existing server API; RPC credentials stay server-side.

## Run

Use Node 20 or the repository's pixi runtime. From the repository root:

```sh
cd packages/client
npm ci
cd ../../web
npm ci
cp .env.demo.example .env.local
npm run build
npm start -- --port 3101
```

Open http://localhost:3101. Fixture mode supports the complete offline walkthrough. Its proof check says "Fixture checked". To read the reference account from devnet instead, set `NEXT_PUBLIC_USE_FIXTURES=0` and server-only `RPC_URL`, then rebuild. The walkthrough remains local in either mode.

Technical routes (`/dev`, `/session/*`, `/forecast`, `/planner`) return 404 unless server-only `DEV_CONSOLE=1`. A query string or public flag does not enable them. This environment gate is for demo scope, not account authentication.

## Verification

- Client: 14 tests, typecheck passed.
- Web: 95 tests passed; 1 optional live RPC test skipped; typecheck, lint and production build passed.
- Browser: profile entry, review/keyboard focus/Escape, compressed replay, exact 33.827340 PLAY result, local claim, history persistence after reload, wallet balance, Explore period selector and 48 readable observations, saved-fixture proof check.
- Responsive checks at 375×812, 768×1024 and 1440×900 CSS pixels; no horizontal overflow on inspected screens.
- Technical routes, including `/dev?dev=1`, returned 404 with the console disabled.
- Next.js and matching lint configuration updated from 15.5.4 to 15.5.28.

The supplied CPI archive contains 1,351 months ending July 2026, despite its original header saying August. The UI derives the date from the data. The program, keeper and existing API/client semantics were preserved. No live wallet transaction or public deployment was performed.
