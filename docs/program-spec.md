# MacroPaths program specification

Single source of truth for every agent. Section numbers are what the briefs cite. Decisions not written here do not exist; ask the orchestrator, who adds a sentence here.

### 1.1 Constants (`constants.rs`)

```rust
pub const N_OBS: u8 = 48;            // observations per session
pub const PRODUCTS: usize = 2;       // 0 = Inflation Cooling, 1 = Excess Inflation
pub const SIDES: usize = 4;          // index j = product*2 + side; side 0 = "more", side 1 = "less"
pub const ONE: u64 = 1_000_000;      // millionths: scores, prices
pub const PLAY_DECIMALS: u8 = 6;
pub const QUOTE_MIN: u64 = 50_000;   // 0.05
pub const QUOTE_MAX: u64 = 950_000;  // 0.95
pub const SEED_SESSION: &[u8] = b"session";
pub const SEED_VAULT: &[u8] = b"vault";
pub const SEED_POSITION: &[u8] = b"position";
pub const SEED_SELLER: &[u8] = b"seller";
pub const SEED_SELLER_TA: &[u8] = b"seller_ta";
pub const SEED_QUOTE: &[u8] = b"quote";
pub const SEED_COVER: &[u8] = b"cover";
```

Units: `x_t`, `k`, `peak`, `max_decline`, `d_cap` in 1e-4 percentage points (`32500` = 3.25%); `excess_acc`, `a_cap` in 1e-4 pp-months; token amounts in PLAY base units (6 decimals, so 10 PLAY = `10_000_000`); scores and prices in millionths.

### 1.2 Accounts (`state.rs`)

All accounts use `#[account]` + `#[derive(InitSpace)]`; space = `8 + T::INIT_SPACE`. No `Vec`, no `String`.

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SessionState { Open = 0, Running = 1, Settled = 2, Refunding = 3 }

#[account] #[derive(InitSpace)]
pub struct Session {
    pub authority: Pubkey,          // creator; signs lock_and_start, set_entry_quote, sweep_dust
    pub session_id: u64,            // seed component
    pub play_mint: Pubkey,
    pub vaults: [Pubkey; 2],        // token accounts, one per product, authority = this PDA
    pub dataset_id: [u8; 32],
    pub commitment: [u8; 32],       // current C_i; starts at C_0; after 48 observes equals terminal
    pub terminal: [u8; 32],         // C_48
    pub n_obs: u8,                  // always N_OBS; stored for the explorer
    pub next_index: u8,             // 0..=48
    pub last_period_id: u32,        // YYYYMM of the last accepted observation, 0 before any
    pub state: SessionState,
    pub k: i64, pub d_cap: i64, pub a_cap: i64,
    pub deposit_deadline: i64,      // unix seconds
    pub replay_deadline: i64,
    pub side_totals: [u64; 4],      // S_j
    pub matched: [u64; 2],          // M_i, set at lock
    pub peak: i64,                  // M_t; i64::MIN before the first observation
    pub max_decline: i64,           // D_t
    pub excess_acc: i64,            // A_t
    pub values: [i64; 48],          // x_t
    pub scores: [u64; 2],           // s_i millionths, set at settle
    pub p_budget: [u64; 4],         // P_j
    pub r_budget: [u64; 4],         // R_j
    pub position_count: u32,
    pub claimed_count: u32,
    pub cover_count: u32,           // extension; 0 in base
    pub cover_claimed_count: u32,
    pub seller_products_open: u8,   // products with n_sold>0 not yet seller_settled; 0 in base
    pub bump: u8,
    pub vault_bumps: [u8; 2],
}

#[account] #[derive(InitSpace)]
pub struct Position { pub session: Pubkey, pub owner: Pubkey, pub deposited: [u64; 4], pub claimed: bool, pub bump: u8 }

#[account] #[derive(InitSpace)]
pub struct Seller {
    pub session: Pubkey, pub seller: Pubkey,
    pub free_cash: u64,             // F
    pub escrow: [u64; 2],           // E_i
    pub n_sold: [u64; 2],
    pub premium: [u64; 2],
    pub settled: [bool; 2],
    pub bump: u8, pub ta_bump: u8,
}

#[account] #[derive(InitSpace)]
pub struct EntryQuote { pub session: Pubkey, pub p: [u64; 2], pub is_set: bool, pub frozen: bool, pub bump: u8 }

#[account] #[derive(InitSpace)]
pub struct Cover { pub session: Pubkey, pub owner: Pubkey, pub units: [u64; 2], pub premium_paid: [u64; 2], pub claimed: bool, pub bump: u8 }
```

PDA seeds (all with the program ID):

| Account | Seeds |
| --- | --- |
| Session | `[b"session", authority, session_id.to_le_bytes()]` |
| Vault i (SPL token account) | `[b"vault", session, [i as u8]]`, `token::mint = play_mint`, `token::authority = session` |
| Position | `[b"position", session, owner]` |
| Seller | `[b"seller", session]` |
| Seller token account | `[b"seller_ta", session]`, `token::authority = session` |
| EntryQuote | `[b"quote", session]` |
| Cover | `[b"cover", session, owner]` |

Every transfer out of a vault or the seller token account is a CPI to `anchor_spl::token::transfer` signed with `&[b"session", authority.as_ref(), &session_id.to_le_bytes(), &[bump]]`.

### 1.3 Errors (`error.rs`), one enum `MacroError`

`InvalidParams, InvalidProduct, WrongState, PastDeadline, ZeroAmount, WrongMint, WrongOwner, EmptySide, WrongIndex, BadCommitment, PeriodNotIncreasing, ChainIncomplete, AlreadyClaimed, NotExpired, NotAllClaimed, MathOverflow, QuoteOutOfRange, QuoteFrozen, QuoteNotSet, InsufficientSellerFunds, WrongSeller, SellerEscrowOutstanding, AlreadySettled`.

### 1.4 Events (`events.rs`)

```rust
#[event] pub struct Observed { pub session: Pubkey, pub index: u8, pub period_id: u32, pub value: i64, pub peak: i64, pub max_decline: i64, pub excess_acc: i64, pub commitment: [u8;32] }
#[event] pub struct Settled  { pub session: Pubkey, pub scores: [u64;2], pub matched: [u64;2], pub p_budget: [u64;4], pub r_budget: [u64;4] }
#[event] pub struct Claimed  { pub session: Pubkey, pub owner: Pubkey, pub amounts: [u64;2], pub refund: bool }
#[event] pub struct CoverBought { pub session: Pubkey, pub owner: Pubkey, pub product: u8, pub units: u64, pub buyer_paid: u64, pub seller_paid: u64 }
```

### 1.5 Pure maths (`math.rs`, no Anchor types, every function returns `Result<_, MathError>` or `Option`)

```rust
pub fn step_cooling(peak: i64, max_decline: i64, x: i64) -> (i64, i64)      // (max(peak,x), max(max_decline, newpeak - x)); use checked_sub
pub fn step_excess(acc: i64, x: i64, k: i64) -> Option<i64>                 // acc + max(x-k, 0), checked
pub fn score(stat: i64, cap: i64) -> Option<u64>                            // stat<0 -> 0; min(stat,cap) * ONE / cap, u128
pub fn side_budgets(s0: u64, s1: u64, s_millionths: u64) -> Option<(u64,u64,u64,u64)>  // (P0,P1,R0,R1): M=min; P0=floor(2*M*s/ONE) u128; P1=2M-P0; R0=S0-M; R1=S1-M
pub fn claim_amount(a: u64, r_j: u64, p_j: u64, s_j: u64) -> Option<u64>    // s_j==0 -> 0; floor(a*r/s) + floor(a*p/s), u128
pub fn cover_split(p: u64, units: u64) -> Option<(u64,u64)>                 // buyer = ceil(p*units/ONE) = (p*units + ONE-1)/ONE in u128; seller = units - buyer
pub fn cover_claim(s: u64, units: u64) -> Option<u64>                       // floor(s*units/ONE)
```

Properties that the tests pin (all from `tests/vectors.json`, never typed by hand): `final`, `running` (per-row M, D, A), `annual_slices`, `synthetic` (625000 vs 125000, through-zero path), `threshold` (39999→0, 40000→0, 40001→1), `budget_3v2` (claims 0,0,4; dust 1), `worked_example` (buyer_total 33827340). Conservation proptest: for random `S0,S1 ≤ 1e12`, `s ≤ ONE`, random partitions of each side into ≤ 8 deposits: `Σ claims ≤ S0+S1` and each side's claims `≤ R_j+P_j`.

### 1.6 Commitment chain (`chain.rs`, and docs/commitment-chain.md)

Byte encoding, identical in Rust, Python and TypeScript:

```
dataset_id = SHA256( utf8(source_url) ‖ 0x0A ‖ utf8(retrieved_at) ‖ 0x0A ‖ utf8(sha256_of_raw hex, lowercase) )
             (the three fields of data/snapshots/CPIAUCNS.json)
period_id  = year*100 + month   as u32           (202101 for Jan 2021)
C_48       = SHA256( "PATH-END-v1" ‖ dataset_id[32] ‖ u32_le(48) )
C_i        = SHA256( "PATH-OBS-v1" ‖ dataset_id[32] ‖ u32_le(i) ‖ u32_le(period_id_i) ‖ i64_le(x_i) ‖ C_{i+1}[32] )   for i = 47 down to 0
```

Session stores `commitment = C_0` at creation and `terminal = C_48`. `observe(i, period, x, next)` recomputes `C_i` from its arguments and `next`, requires it equals the stored commitment, then stores `next`. After 48 accepted observations the stored commitment equals `terminal`; `settle` requires that. Rust: `anchor_lang::solana_program::hash::hashv(&[b"PATH-OBS-v1", &dataset_id, &i.to_le_bytes(), &period.to_le_bytes(), &x.to_le_bytes(), &next]).to_bytes()` with `i: u32`.

### 1.7 State machine

```
Open ──lock_and_start──▶ Running ──settle──▶ Settled
 │                          │
 └─expire_incomplete (now > deposit_deadline)        └─expire_incomplete (now > replay_deadline && next_index < 48)
                 ▼                                                   ▼
             Refunding                                           Refunding
```

`deposit`, `seller_fund`, `set_entry_quote`, `buy_cover`: Open only, and `now ≤ deposit_deadline`. `observe`: Running only, `now ≤ replay_deadline`. `claim`, `claim_cover`, `seller_settle`: Settled or Refunding. `sweep_dust`, `seller_withdraw`: see below.

### 1.8 Instructions

Common: `now = Clock::get()?.unix_timestamp`. "Transfer X from A to B" means skip if X == 0, otherwise CPI transfer; vault→user transfers are session-signed. All arithmetic `checked_*` or the `math.rs` function, mapping `None` to `MathOverflow`.

**create_session(session_id: u64, k: i64, d_cap: i64, a_cap: i64, deposit_deadline: i64, replay_deadline: i64, dataset_id: [u8;32], c0: [u8;32], terminal: [u8;32])**
Accounts: `authority` Signer (payer), `session` init PDA, `play_mint` Mint, `vault_0`, `vault_1` init token PDAs, `token_program`, `system_program`, `rent`.
Checks: `d_cap > 0`, `a_cap > 0`, `now < deposit_deadline < replay_deadline` else `InvalidParams`.
Writes: every field; `peak = i64::MIN`, `max_decline = 0`, `excess_acc = 0`, `next_index = 0`, `last_period_id = 0`, `state = Open`, `n_obs = N_OBS`, `commitment = c0`, counters 0, bumps.

**deposit(amounts: [u64;4])**
Accounts: `owner` Signer, `session` mut, `position` init_if_needed PDA (payer owner), `owner_ta` TokenAccount (mut), `vault_0`, `vault_1` mut (constraint: key == session.vaults[i]), `token_program`, `system_program`.
Checks: `state == Open` else `WrongState`; `now ≤ deposit_deadline` else `PastDeadline`; `Σ amounts > 0` else `ZeroAmount`; `owner_ta.mint == play_mint` else `WrongMint`; `owner_ta.owner == owner` else `WrongOwner`.
Writes: if `position.owner == Pubkey::default()` → set `session, owner, bump`, `position_count += 1`. For each j: `deposited[j] += amounts[j]`, `side_totals[j] += amounts[j]`. Transfer `amounts[0]+amounts[1]` owner_ta→vault_0 and `amounts[2]+amounts[3]` owner_ta→vault_1 (owner signs).

**lock_and_start()**
Accounts: `authority` Signer (= session.authority, `has_one`), `session` mut.
Checks: `state == Open`; all four `side_totals[j] > 0` else `EmptySide`.
Writes: `matched[i] = min(side_totals[2i], side_totals[2i+1])`; `state = Running`.

**observe(index: u8, period_id: u32, value: i64, next_commitment: [u8;32])**
Accounts: `session` mut. No signer requirement beyond the fee payer (permissionless; the chain gates it).
Checks in this order: `state == Running` (`WrongState`); `now ≤ replay_deadline` (`PastDeadline`); `index == next_index && index < n_obs` (`WrongIndex`); `period_id > last_period_id` (`PeriodNotIncreasing`); `chain::obs_hash(dataset_id, index as u32, period_id, value, next_commitment) == commitment` (`BadCommitment`).
Writes: `(peak, max_decline) = step_cooling(...)`; `excess_acc = step_excess(...)`; `values[index] = value`; `commitment = next_commitment`; `last_period_id = period_id`; `next_index += 1`; emit `Observed`.

**settle()**
Accounts: `session` mut. Permissionless.
Checks: `state == Running`; `next_index == n_obs && commitment == terminal` else `ChainIncomplete`.
Writes: `scores = [score(max_decline, d_cap), score(excess_acc, a_cap)]`; for i in 0..2: `(P0,P1,R0,R1) = side_budgets(side_totals[2i], side_totals[2i+1], scores[i])` (must equal `matched[i]` logic; assert `min == matched[i]`); `p_budget[2i..]`, `r_budget[2i..]`; `state = Settled`; emit `Settled`.

**claim()**
Accounts: `owner` Signer, `session` mut, `position` mut PDA (`has_one owner`, `has_one session`), `owner_ta` mut (mint/owner checks), `vault_0`, `vault_1` mut, `token_program`.
Checks: `state ∈ {Settled, Refunding}` (`WrongState`); `!position.claimed` (`AlreadyClaimed`).
Writes: Settled: for j: `c_j = claim_amount(deposited[j], r_budget[j], p_budget[j], side_totals[j])`; `pay_i = c_{2i} + c_{2i+1}`. Refunding: `pay_i = deposited[2i] + deposited[2i+1]`. Transfer `pay_i` vault_i→owner_ta. `claimed = true`; `claimed_count += 1`; emit `Claimed`. A zero payout still marks claimed.

**expire_incomplete()**
Accounts: `session` mut. Permissionless.
Checks: `(state == Open && now > deposit_deadline) || (state == Running && now > replay_deadline && next_index < n_obs)` else `NotExpired`.
Writes: `state = Refunding`.

**sweep_dust()**
Accounts: `authority` Signer (`has_one`), `session` mut, `treasury_ta` mut (mint check), `vault_0`, `vault_1` mut, `token_program`.
Checks: `state ∈ {Settled, Refunding}`; `claimed_count == position_count && cover_claimed_count == cover_count && seller_products_open == 0` else `NotAllClaimed`.
Writes: transfer full `vault_i.amount` to treasury_ta, both products.

**seller_fund(amount: u64)** (extension)
Accounts: `seller_wallet` Signer, `session`, `seller` init_if_needed PDA, `seller_ta` init_if_needed token PDA (authority session), `seller_wallet_ta` mut, `play_mint`, `token_program`, `system_program`.
Checks: `state == Open`; `amount > 0`; if `seller.seller != default` then `seller.seller == seller_wallet` else `WrongSeller`.
Writes: first call sets `session, seller, bumps`; transfer amount wallet_ta→seller_ta; `free_cash += amount`.

**set_entry_quote(p: [u64;2])**
Accounts: `authority` Signer (`has_one` on session), `session`, `quote` init_if_needed PDA, `system_program`.
Checks: `state == Open`; each `QUOTE_MIN ≤ p_i ≤ QUOTE_MAX` else `QuoteOutOfRange`; `!quote.frozen` else `QuoteFrozen`.
Writes: `p`, `is_set = true`, `session`, `bump`.

**buy_cover(product: u8, units: u64)**
Accounts: `buyer` Signer, `session` mut, `quote` mut, `seller` mut, `seller_ta` mut, `cover` init_if_needed PDA, `buyer_ta` mut, `vault` mut (= session.vaults[product]), `token_program`, `system_program`.
Checks: `product < 2` (`InvalidProduct`); `state == Open`; `now ≤ deposit_deadline`; `quote.is_set` (`QuoteNotSet`); `units > 0`; `(buyer_pays, seller_pays) = cover_split(quote.p[product], units)`; `seller_pays ≤ seller.free_cash` else `InsufficientSellerFunds`.
Writes: transfer buyer_pays buyer_ta→vault (buyer signs); transfer seller_pays seller_ta→vault (session signs); `free_cash -= seller_pays`; `escrow[product] += seller_pays`; if `n_sold[product] == 0` then `seller_products_open += 1`; `n_sold[product] += units`; `premium[product] += buyer_pays`; if cover new: `owner, session, bump`, `cover_count += 1`; `cover.units[product] += units`; `premium_paid[product] += buyer_pays`; `quote.frozen = true`; emit `CoverBought`.

**claim_cover()**
Accounts: `owner` Signer, `session` mut, `cover` mut (`has_one`), `owner_ta` mut, `vault_0`, `vault_1` mut, `token_program`.
Checks: `state ∈ {Settled, Refunding}`; `!cover.claimed`.
Writes: Settled: `pay_i = cover_claim(scores[i], units[i])`; Refunding: `pay_i = premium_paid[i]`. Transfer; `claimed = true`; `cover_claimed_count += 1`.

**seller_settle(product: u8)**
Accounts: `session` mut, `seller` mut, `seller_ta` mut, `vault` mut, `token_program`. Permissionless.
Checks: `product < 2`; `state ∈ {Settled, Refunding}`; `!seller.settled[product]` else `AlreadySettled`.
Writes: Settled: `pay = n_sold - cover_claim(scores[product], n_sold)`; Refunding: `pay = escrow[product]`. Transfer pay vault→seller_ta (session signs); `free_cash += pay`; `escrow[product] = 0`; `settled[product] = true`; if `n_sold[product] > 0` then `seller_products_open -= 1`.

**seller_withdraw(amount: u64)**
Accounts: `seller_wallet` Signer (= seller.seller), `session`, `seller` mut, `seller_ta` mut, `seller_wallet_ta` mut, `token_program`.
Checks: `escrow == [0,0]` else `SellerEscrowOutstanding`; `0 < amount ≤ free_cash`.
Writes: transfer seller_ta→wallet_ta (session signs); `free_cash -= amount`.

### 1.9 Conservation invariants (what agent 10 asserts after every step)

- Vault_i balance ≥ Σ unclaimed pool claims on product i + Σ unclaimed cover claims + unpaid seller remainder, at all times after settle.
- `Σ side_totals[j] + n_sold_total == vault_0 + vault_1` before any claim.
- After everyone claimed: vault balance = dust ≥ 0, and `sweep_dust` empties it.

### 1.10 Test harness (`programs/macropaths/tests/common/mod.rs`, built by agent 01, used by all)

```rust
pub struct Env { pub svm: LiteSVM, pub payer: Keypair, pub mint: Pubkey, pub authority: Keypair }
pub fn env() -> Env                                     // loads target/deploy/macropaths.so, airdrops payer+authority, creates PLAY mint (6 dp) with litesvm_token::CreateMint
pub fn ata_with(env: &mut Env, owner: &Pubkey, amount: u64) -> Pubkey   // create ATA and mint `amount`
pub fn session_pda(authority: &Pubkey, id: u64) -> (Pubkey, u8)
pub fn vault_pda(session: &Pubkey, i: u8) -> (Pubkey, u8)
pub fn position_pda(session: &Pubkey, owner: &Pubkey) -> (Pubkey, u8)   // plus seller/seller_ta/quote/cover equivalents
pub fn send(env: &mut Env, ix: Instruction, signers: &[&Keypair]) -> Result<TransactionMetadata, FailedTransactionMetadata>
pub fn read<T: AccountDeserialize>(env: &Env, key: &Pubkey) -> T
pub fn token_balance(env: &Env, ta: &Pubkey) -> u64
pub fn set_time(env: &mut Env, unix: i64)              // writes Clock sysvar via svm.set_sysvar
pub fn assert_err(res, MacroError::X)                   // matches the custom error code in the failure
pub fn vectors() -> serde_json::Value                   // reads ../../tests/vectors.json
pub fn create_session_default(env, id) -> Pubkey        // k=40000, d_cap=80000, a_cap=800000, deadlines now+3600/now+7200, dataset_id/c0/terminal from vectors chain block
pub fn seed_sides(env, session, [u64;4]) -> Keypair     // one seeder wallet deposits the given four amounts
pub fn observe_all(env, session, rows: &[(u8,u32,i64,[u8;32])])
```

Instructions are built as in the existing `test_initialize.rs`: `macropaths::accounts::X { .. }.to_account_metas(None)` and `macropaths::instruction::X { .. }.data()`.
