import { readFileSync } from 'fs';
import {
  Connection, Keypair, PublicKey, Transaction,
  SystemProgram, sendAndConfirmTransaction, TransactionInstruction,
} from '@solana/web3.js';

const BPF_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const SYSVAR_RENT  = new PublicKey('SysvarRent111111111111111111111111111111111');
const SYSVAR_CLOCK = new PublicKey('SysvarC1ock11111111111111111111111111111111');
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

const deployerArr = JSON.parse(readFileSync('/home/runner/.config/solana/id.json', 'utf8'));
const deployer    = Keypair.fromSecretKey(Uint8Array.from(deployerArr));
const programArr  = JSON.parse(readFileSync('/home/runner/workspace/contracts/program-keypair.json', 'utf8'));
const programKp   = Keypair.fromSecretKey(Uint8Array.from(programArr));

// Existing buffer from previous run that has all bytes written
const BUFFER_PUBKEY = new PublicKey('zyYrYvTJ5ASQLDf9e5vSoBi5fLrrt5ZdraPR5Bej2CH');

// Check what's actually in the buffer account
const bufInfo = await conn.getAccountInfo(BUFFER_PUBKEY);
console.log(`Buffer: ${BUFFER_PUBKEY.toBase58()}`);
console.log(`  data len: ${bufInfo?.data?.length}`);
console.log(`  lamports: ${bufInfo?.lamports}`);

// The BPF Loader Upgradeable header for buffer is 37 bytes (bincode-serialized)
const BUFFER_HEADER = 37;
const bufferDataLen = bufInfo.data.length - BUFFER_HEADER; // 7760 - 37 = 7723
console.log(`  buffer data len: ${bufferDataLen}`);

const bal = await conn.getBalance(deployer.publicKey);
console.log(`Deployer balance: ${(bal/1e9).toFixed(6)} SOL`);

// Derive ProgramData PDA
const [programDataPDA] = PublicKey.findProgramAddressSync(
  [programKp.publicKey.toBytes()], BPF_UPGRADEABLE_ID
);
console.log(`Program ID  : ${programKp.publicKey.toBase58()}`);
console.log(`ProgramData : ${programDataPDA.toBase58()}`);

// Check if program account already exists (from failed tx - should be rolled back)
const progInfo = await conn.getAccountInfo(programKp.publicKey);
console.log(`Program account exists: ${!!progInfo}`);

function encodeDeployWithMaxDataLen(maxLen) {
  const b = Buffer.alloc(4 + 8);
  b.writeUInt32LE(2, 0);
  b.writeBigUInt64LE(BigInt(maxLen), 4);
  return b;
}

// max_data_len must be >= bufferDataLen
const MAX_DATA_LEN = bufferDataLen;

// Program account space: UpgradeableLoaderState::size_of_program() = 4 + 32 = 36
const PROGRAM_SPACE = 36;
const programRent = await conn.getMinimumBalanceForRentExemption(PROGRAM_SPACE);
console.log(`Program account rent: ${(programRent/1e9).toFixed(6)} SOL`);

// Build deploy transaction
const txInstructions = [];

// Create program account (if it doesn't already exist)
if (!progInfo) {
  txInstructions.push(SystemProgram.createAccount({
    fromPubkey: deployer.publicKey,
    newAccountPubkey: programKp.publicKey,
    lamports: programRent,
    space: PROGRAM_SPACE,
    programId: BPF_UPGRADEABLE_ID,
  }));
}

// Deploy with correct max_data_len
txInstructions.push(new TransactionInstruction({
  keys: [
    { pubkey: deployer.publicKey,    isSigner: true,  isWritable: true  }, // payer
    { pubkey: programDataPDA,        isSigner: false, isWritable: true  }, // programdata
    { pubkey: programKp.publicKey,   isSigner: true,  isWritable: true  }, // program
    { pubkey: BUFFER_PUBKEY,         isSigner: false, isWritable: true  }, // buffer
    { pubkey: SYSVAR_RENT,           isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK,          isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: deployer.publicKey,    isSigner: true,  isWritable: false }, // upgrade authority
  ],
  programId: BPF_UPGRADEABLE_ID,
  data: encodeDeployWithMaxDataLen(MAX_DATA_LEN),
}));

console.log(`\nDeploying with max_data_len=${MAX_DATA_LEN}...`);

try {
  const signers = [deployer];
  if (!progInfo) signers.push(programKp);

  const deploySig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(...txInstructions),
    signers,
    { commitment: 'confirmed' }
  );
  console.log(`\n✅ DEPLOYED SUCCESSFULLY!`);
  console.log(`Program ID : ${programKp.publicKey.toBase58()}`);
  console.log(`Signature  : ${deploySig}`);
  console.log(`Explorer   : https://explorer.solana.com/address/${programKp.publicKey.toBase58()}?cluster=devnet`);
} catch(e) {
  console.error('\nDeploy failed:', e.message);
  const logs = e.transactionLogs || [];
  logs.forEach(l => console.error(' ', l));
}
