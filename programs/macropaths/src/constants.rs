pub const N_OBS: u8 = 48; // observations per session
pub const PRODUCTS: usize = 2; // 0 = Inflation Cooling, 1 = Excess Inflation
pub const SIDES: usize = 4; // index j = product*2 + side; side 0 = "more", side 1 = "less"
pub const ONE: u64 = 1_000_000; // millionths: scores, prices
pub const PLAY_DECIMALS: u8 = 6;
pub const QUOTE_MIN: u64 = 50_000; // 0.05
pub const QUOTE_MAX: u64 = 950_000; // 0.95
pub const SEED_SESSION: &[u8] = b"session";
pub const SEED_VAULT: &[u8] = b"vault";
pub const SEED_POSITION: &[u8] = b"position";
pub const SEED_SELLER: &[u8] = b"seller";
pub const SEED_SELLER_TA: &[u8] = b"seller_ta";
pub const SEED_QUOTE: &[u8] = b"quote";
pub const SEED_COVER: &[u8] = b"cover";
