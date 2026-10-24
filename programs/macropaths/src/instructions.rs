// Every instruction module exports a `handler`; lib.rs calls them by module path
// (`claim::handler`), so the clashing glob names are never used directly.
#![allow(ambiguous_glob_reexports)]

pub mod claim;
pub mod create_session;
pub mod deposit;
pub mod expire_incomplete;
pub mod initialize;
pub mod lock_and_start;
pub mod observe;
pub mod settle;
pub mod sweep_dust;

pub use claim::*;
pub use create_session::*;
pub use deposit::*;
pub use expire_incomplete::*;
pub use initialize::*;
pub use lock_and_start::*;
pub use observe::*;
pub use settle::*;
pub use sweep_dust::*;
