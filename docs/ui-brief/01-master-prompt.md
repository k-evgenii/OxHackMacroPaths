# Master prompt: MacroPaths client UI

You are a senior product designer and front-end engineer. Redesign and implement the client-facing UI of **MacroPaths**, a Solana devnet app. The current UI is a database viewer: it shows every raw on-chain field, it has no hierarchy, and its charts are ugly. Make it minimal, premium and readable for a non-technical client. Move everything technical to a hidden developer console.

## Stack (fixed, do not change)
- Next.js 15 (app router), React 19, TypeScript strict, Tailwind 4, TanStack Query v5, zod 3.
- Recharts 2 is installed. Hand-rolled SVG is fine and preferred for the glowing chart.
- Solana: `@solana/web3.js` 1.x and `@anchor-lang/core` 1.0.2. **No** `@solana/kit`, **no** Codama.
- Wallets (later step): `@solana/wallet-adapter-react` with Phantom and Solflare.
- Data comes only from our API through `fetchJson(path, ZodSchema)` (see file 03). Never call RPC from the browser.

## Visual direction
- **Mood:** a dark crypto dashboard crossed with a calm banking app.
- **Palette:**
  - Warm near-black background, about `#0f0b09`.
  - Surfaces about `#1a1310` with a 1px `rgba(255,255,255,0.06)` border.
  - One orange accent, a `#ff6a1a` → `#ff8c3a` gradient.
  - Green `#2ee6a6` for up, red `#ff3b4a` for down.
  - Muted text about `#8a7f78`.
- **Shape:** radius 20px for cards and 999px for pills.
- **Type:** Inter or Geist via `next/font`. Hero numbers 40–56px with tight tracking. Labels 12–13px and muted. Lots of whitespace, and a 4/8px spacing scale.
- **Hierarchy:** one hero number per card, at most three stats in a row, and no tables on client screens except the transaction list.
- **Charts, all of them:**
  - One line 1.5px thick with a glow, made with an SVG `feGaussianBlur` copy (stdDeviation 4–6) under the crisp line.
  - A gradient area fill from 0 to 8% opacity.
  - No gridlines, three to five muted tick labels, and a dashed threshold line.
  - A hover crosshair with a value bubble.
  - Draw-in animation (stroke-dashoffset) on mount.
  - Responsive down to 375px wide.
- **Motion:** subtle, 150–250ms, with `prefers-reduced-motion` respected.
- **Accessibility:** WCAG AA contrast, visible focus rings, and chart values also available as text.

## Client screens
1. **Dashboard** (`/`).
   - Before connecting: a hero line ("Contracts on the path of US inflation, settled on Solana") and two product cards.
   - After connecting: a wallet card (PLAY balance, short address with copy, "Get test PLAY" on devnet), the user's positions (stake, expected payout, status pill), and one sparkline tile per product.
2. **Session** (`/session/[addr]`), a single page with no tabs.
   - The hero glowing path chart of 48 monthly inflation readings, with the 4% threshold line and the shaded excess above it.
   - Three key numbers: latest inflation, each product's score (as %), and months left or "Settled".
   - A **Vault** card: total locked, a composition bar of the four sides, and replay progress n/48.
   - A **Your position** card: stake per side, expected payout tagged "illustration until settlement", and a Claim button (disabled until the wallet step).
3. **Activity** (`/activity`).
   - A transaction-history list in the style of a banking app, grouped Today, Yesterday, then by date. Each row has an icon, a title ("Deposit", "Claim"), a date, a right-aligned amount coloured +/−, and an Explorer link.
   - A "Market" toggle shows plain-language session events, for example "Mar 2023 recorded: 4.98%" and "Session settled".
4. **Products and Planner** (`/products`).
   - Two product cards showing price per unit, maximum payout and what it pays for, in one sentence each.
   - Planner: two inputs (gallons per month, budget) give **one recommendation sentence** and a small glowing comparison chart. The full 21-row table sits behind "See all options".
5. **Developer console** (`/dev/*`).
   - Enabled only when `NEXT_PUBLIC_DEV_CONSOLE=1` or `?dev=1`, and not linked from client nav.
   - The current raw pages move here unchanged.

## Copy rules
- Never write "bet", "option", "insurance" or "fair value". Say "position", "cover", "forecast".
- Use plain units: "5.0%", "69 point-months above 4%", "148.93 PLAY". Never show raw integers like 691184 to clients.
- Projected numbers carry "illustration until settlement".
- Products:
  - **Inflation Cooling** pays on the largest fall of inflation from its peak.
  - **Excess Inflation** pays on how long and how far inflation stayed above 4%.

## How to work
- File 02 (handover) covers what exists, what is broken and the work order. File 03 has the data contract and real numbers.
- Deliver in small steps, each as full files with their paths. Order:
  1. Design tokens and fonts.
  2. The `GlowLineChart` component.
  3. The app shell and nav.
  4. The Session page.
  5. Dashboard.
  6. Activity.
  7. Products and Planner.
  8. Moving the old pages to `/dev`.
- Use the existing hooks and `fetchJson`. Do not invent API fields. If you need one, propose the exact zod change.
- Every screen needs loading (skeleton), empty and error states, and must work at 375px and 1440px.
