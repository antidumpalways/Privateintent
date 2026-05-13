/*!
 * PrismDwallet — Private Intent SOL Escrow Program (native, no Anchor)
 *
 * Colosseum Frontier Hackathon 2026 — Ika + Encrypt track
 *
 * Speaks the Anchor wire-format (8-byte discriminators + borsh args) so the
 * existing TypeScript frontend/API server works unchanged.
 *
 * Instructions (Anchor discriminators):
 *   deposit(intent_id, deadline, amount) — 0xf223c68952e1f2b6
 *   release(intent_id, solver)           — 0xfdf90fce1c7fc1f1
 *   refund(intent_id)                    — 0x0260b7fb3fd02e2e
 *
 * PDA seeds: [b"escrow", intent_id.to_le_bytes()]
 * Account layout: 8 (anchor disc) + 8 + 32 + 32 + 8 + 8 + 1 + 1 = 98 bytes
 */

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};

entrypoint!(process_instruction);

// ─── Discriminators ───────────────────────────────────────────────────────────

/// sha256("global:deposit")[0..8]
const DISC_DEPOSIT: [u8; 8] = [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6];
/// sha256("global:release")[0..8]
const DISC_RELEASE: [u8; 8] = [0xfd, 0xf9, 0x0f, 0xce, 0x1c, 0x7f, 0xc1, 0xf1];
/// sha256("global:refund")[0..8]
const DISC_REFUND: [u8; 8] = [0x02, 0x60, 0xb7, 0xfb, 0x3f, 0xd0, 0x2e, 0x2e];
/// sha256("account:EscrowAccount")[0..8]
const DISC_ACCOUNT: [u8; 8] = [0x24, 0x45, 0x30, 0x12, 0x80, 0xe1, 0x7d, 0x87];

// ─── Constants ────────────────────────────────────────────────────────────────

const OPERATOR: Pubkey = Pubkey::new_from_array([
    133, 14, 97, 232, 73, 104, 110, 69, 44, 52, 99, 24, 182, 252, 135, 80,
    39, 70, 54, 59, 249, 48, 43, 135, 79, 174, 96, 185, 6, 152, 249, 22,
]);

/// On-chain account layout (bytes after the 8-byte discriminator prefix).
/// Total account space = 8 + ESCROW_DATA_LEN = 98 bytes.
const ESCROW_DATA_LEN: usize = 8 + 32 + 32 + 8 + 8 + 1 + 1; // 90 bytes
const ACCOUNT_SPACE: usize = 8 + ESCROW_DATA_LEN; // 98 bytes

const SEED_PREFIX: &[u8] = b"escrow";

// ─── Entrypoint ───────────────────────────────────────────────────────────────

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 8 {
        msg!("Error: instruction data too short");
        return Err(ProgramError::InvalidInstructionData);
    }

    let disc = &data[0..8];
    let args = &data[8..];

    if disc == DISC_DEPOSIT {
        process_deposit(program_id, accounts, args)
    } else if disc == DISC_RELEASE {
        process_release(program_id, accounts, args)
    } else if disc == DISC_REFUND {
        process_refund(program_id, accounts, args)
    } else {
        msg!("Error: unknown discriminator {:?}", disc);
        Err(ProgramError::InvalidInstructionData)
    }
}

// ─── deposit ─────────────────────────────────────────────────────────────────

/// deposit(intent_id: u64, deadline: i64, amount: u64)
/// Accounts: [escrow_pda (writable, new), depositor (signer, writable), system_program]
fn process_deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: &[u8],
) -> ProgramResult {
    // parse args: u64 intent_id | i64 deadline | u64 amount
    if args.len() < 24 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let intent_id = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let deadline = i64::from_le_bytes(args[8..16].try_into().unwrap());
    let amount = u64::from_le_bytes(args[16..24].try_into().unwrap());

    let iter = &mut accounts.iter();
    let escrow_info = next_account_info(iter)?;
    let depositor_info = next_account_info(iter)?;
    let system_program_info = next_account_info(iter)?;

    if !depositor_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if amount == 0 {
        msg!("Error: ZeroAmount");
        return Err(ProgramError::InvalidArgument);
    }

    let clock = Clock::get()?;
    if deadline <= clock.unix_timestamp {
        msg!("Error: DeadlinePassed");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify PDA
    let id_bytes = intent_id.to_le_bytes();
    let seeds = &[SEED_PREFIX, id_bytes.as_ref()];
    let (pda, bump) = Pubkey::find_program_address(seeds, program_id);
    if pda != *escrow_info.key {
        msg!("Error: invalid PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Check account is not already initialised (idempotent guard)
    if escrow_info.lamports() > 0 && escrow_info.data_len() == ACCOUNT_SPACE {
        let d = escrow_info.try_borrow_data()?;
        if d[0..8] == DISC_ACCOUNT && d[96] == 1u8 {
            msg!("Error: AlreadyReleased");
            return Err(ProgramError::InvalidArgument);
        }
    }

    // Create the PDA account
    let rent = Rent::get()?;
    let lamports_needed = rent.minimum_balance(ACCOUNT_SPACE) + amount;

    let signer_seeds: &[&[&[u8]]] = &[&[SEED_PREFIX, id_bytes.as_ref(), &[bump]]];

    invoke_signed(
        &system_instruction::create_account(
            depositor_info.key,
            escrow_info.key,
            lamports_needed,
            ACCOUNT_SPACE as u64,
            program_id,
        ),
        &[
            depositor_info.clone(),
            escrow_info.clone(),
            system_program_info.clone(),
        ],
        signer_seeds,
    )?;

    // Write account data
    let mut data = escrow_info.try_borrow_mut_data()?;
    data[0..8].copy_from_slice(&DISC_ACCOUNT);
    data[8..16].copy_from_slice(&intent_id.to_le_bytes());
    data[16..48].copy_from_slice(depositor_info.key.as_ref());
    data[48..80].copy_from_slice(&[0u8; 32]); // solver = default
    data[80..88].copy_from_slice(&amount.to_le_bytes());
    data[88..96].copy_from_slice(&deadline.to_le_bytes());
    data[96] = 0u8; // released = false
    data[97] = bump;

    msg!(
        "PrismDwallet: deposit intent_id={} amount={} deadline={}",
        intent_id,
        amount,
        deadline
    );
    Ok(())
}

// ─── release ─────────────────────────────────────────────────────────────────

/// release(intent_id: u64, solver: Pubkey)
/// Accounts: [escrow_pda (writable), operator (signer, writable), solver_account (writable)]
fn process_release(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: &[u8],
) -> ProgramResult {
    if args.len() < 40 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let intent_id = u64::from_le_bytes(args[0..8].try_into().unwrap());
    let solver_key = Pubkey::from(<[u8; 32]>::try_from(&args[8..40]).unwrap());

    let iter = &mut accounts.iter();
    let escrow_info = next_account_info(iter)?;
    let operator_info = next_account_info(iter)?;
    let solver_info = next_account_info(iter)?;

    if !operator_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *operator_info.key != OPERATOR {
        msg!("Error: Unauthorized");
        return Err(ProgramError::IllegalOwner);
    }

    // Verify PDA
    let id_bytes = intent_id.to_le_bytes();
    let (pda, _bump) = Pubkey::find_program_address(&[SEED_PREFIX, id_bytes.as_ref()], program_id);
    if pda != *escrow_info.key {
        msg!("Error: invalid PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Read and validate state
    {
        let data = escrow_info.try_borrow_data()?;
        if data.len() < ACCOUNT_SPACE {
            return Err(ProgramError::UninitializedAccount);
        }
        if data[96] == 1u8 {
            msg!("Error: AlreadyReleased");
            return Err(ProgramError::InvalidArgument);
        }
    }

    // Mark released and set solver
    {
        let mut data = escrow_info.try_borrow_mut_data()?;
        data[48..80].copy_from_slice(solver_key.as_ref());
        data[96] = 1u8;
    }

    // Transfer lamports (leave rent-exempt minimum)
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(ACCOUNT_SPACE);
    let to_send = escrow_info.lamports().saturating_sub(rent_exempt);
    if to_send == 0 {
        msg!("Error: InsufficientFunds");
        return Err(ProgramError::InsufficientFunds);
    }

    **escrow_info.try_borrow_mut_lamports()? -= to_send;
    **solver_info.try_borrow_mut_lamports()? += to_send;

    msg!(
        "PrismDwallet: release intent_id={} solver={} amount={}",
        intent_id,
        solver_key,
        to_send
    );
    Ok(())
}

// ─── refund ──────────────────────────────────────────────────────────────────

/// refund(intent_id: u64)
/// Accounts: [escrow_pda (writable), depositor (signer, writable)]
fn process_refund(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: &[u8],
) -> ProgramResult {
    if args.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let intent_id = u64::from_le_bytes(args[0..8].try_into().unwrap());

    let iter = &mut accounts.iter();
    let escrow_info = next_account_info(iter)?;
    let depositor_info = next_account_info(iter)?;

    if !depositor_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA
    let id_bytes = intent_id.to_le_bytes();
    let (pda, _bump) = Pubkey::find_program_address(&[SEED_PREFIX, id_bytes.as_ref()], program_id);
    if pda != *escrow_info.key {
        msg!("Error: invalid PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Read and validate state
    let (deadline, depositor_key, to_send) = {
        let data = escrow_info.try_borrow_data()?;
        if data.len() < ACCOUNT_SPACE {
            return Err(ProgramError::UninitializedAccount);
        }
        if data[96] == 1u8 {
            msg!("Error: AlreadyReleased");
            return Err(ProgramError::InvalidArgument);
        }
        let deadline = i64::from_le_bytes(data[88..96].try_into().unwrap());
        let depositor_key = Pubkey::from(<[u8; 32]>::try_from(&data[16..48]).unwrap());

        let rent = Rent::get()?;
        let rent_exempt = rent.minimum_balance(ACCOUNT_SPACE);
        let to_send = escrow_info.lamports().saturating_sub(rent_exempt);
        (deadline, depositor_key, to_send)
    };

    // Enforce deadline
    let clock = Clock::get()?;
    if clock.unix_timestamp < deadline {
        msg!("Error: DeadlineNotReached");
        return Err(ProgramError::InvalidArgument);
    }

    // Enforce depositor matches
    if *depositor_info.key != depositor_key {
        msg!("Error: Unauthorized");
        return Err(ProgramError::IllegalOwner);
    }

    if to_send == 0 {
        msg!("Error: InsufficientFunds");
        return Err(ProgramError::InsufficientFunds);
    }

    // Mark released
    {
        let mut data = escrow_info.try_borrow_mut_data()?;
        data[96] = 1u8;
    }

    // Transfer
    **escrow_info.try_borrow_mut_lamports()? -= to_send;
    **depositor_info.try_borrow_mut_lamports()? += to_send;

    msg!(
        "PrismDwallet: refund intent_id={} depositor={} amount={}",
        intent_id,
        depositor_key,
        to_send
    );
    Ok(())
}
