use anchor_lang::prelude::*;

/// Session PDA: ['session', creator, nonce as u64 little-endian].
#[constant]
pub const SESSION_SEED: &[u8] = b"session";

/// Position PDA: ['position', session, owner].
#[constant]
pub const POSITION_SEED: &[u8] = b"position";

/// Vault PDA: ['vault', session, product index as one byte]. Authority = the Session PDA.
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

/// Product index byte for vault 0 and vault 1. Named constants keep the vault
/// addresses resolvable from the IDL; a raw `&[0u8]` literal is not.
#[constant]
pub const VAULT_0: &[u8] = &[0];

#[constant]
pub const VAULT_1: &[u8] = &[1];

/// Most observations a session holds (48 monthly rows). `Session::values` is sized to this.
#[constant]
pub const MAX_OBS: u8 = 48;

/// Scores are in millionths: 1_000_000 = 1.0.
#[constant]
pub const SCALE: u64 = 1_000_000;
