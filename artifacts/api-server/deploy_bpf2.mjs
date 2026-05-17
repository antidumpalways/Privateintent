import { readFileSync } from 'fs';
import {
  Connection, Keypair, PublicKey, Transaction,
  SystemProgram, sendAndConfirmTransaction, TransactionInstruction,
} from '@solana/web3.js';

const BPF_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const SYSVAR_RENT      = new PublicKey('SysvarRent111111111111111111111111111111111');
const SYSVAR_CLOCK     = new PublicKey('SysvarC1ock11111111111111111111111111111111');
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

const deployerArr = JSON.parse(readFileSync('/home/runner/.config/solana/id.json', 'utf8'));
const deployer    = Keypair.fromSecretKey(Uint8Array.from(deployerArr));

const programArr  = JSON.parse(readFileSync('/home/runner/workspace/contracts/program-keypair.json', 'utf8'));
const programKp   = Keypair.fromSecretKey(Uint8Array.from(programArr));

const elfBytes    = readFileSync('/home/runner/workspace/contracts/deploy/private_intent_escrow.so');

console.log(`Program ID : ${programKp.publicKey.toBase58()}`);
console.log(`ELF size   : ${elfBytes.length} bytes`);
const bal = await conn.getBalance(deployer.publicKey);
console.log(`Balance    : ${(bal/1e9).toFixed(6)} SOL\n`);

// ── Bincode-compatible encoders ─────────────────────────────
// Bincode: u32 → 4 bytes LE, u64 → 8 bytes LE, Vec<u8> → u64 len + bytes
function encodeInitializeBuffer() {
  const b = Buffer.alloc(4); b.writeUInt32LE(0, 0); return b; // variant 0
}
function encodeWrite(offset, chunk) {
  const b = Buffer.alloc(4 + 4 + 8 + chunk.length);
  b.writeUInt32LE(1, 0);                    // variant Write = 1
  b.writeUInt32LE(offset, 4);               // offset: u32
  b.writeBigUInt64LE(BigInt(chunk.length), 8); // len:    u64 (bincode Vec)
  chunk.copy(b, 16);
  return b;
}
function encodeDeployWithMaxDataLen(maxLen) {
  const b = Buffer.alloc(4 + 8);
  b.writeUInt32LE(2, 0);                    // variant DeployWithMaxDataLen = 2
  b.writeBigUInt64LE(BigInt(maxLen), 4);    // max_data_len: usize → u64
  return b;
}

// ── 1. Create buffer account ────────────────────────────────
const bufferKp       = Keypair.generate();
const bufferDataSize = 48 + elfBytes.length; // UpgradeableLoader state header + ELF
const bufferRent     = await conn.getMinimumBalanceForRentExemption(bufferDataSize);
console.log(`Creating buffer: ${bufferKp.publicKey.toBase58()}`);
console.log(`  size=${bufferDataSize}, rent=${(bufferRent/1e9).toFixed(4)} SOL`);

const sig1 = await sendAndConfirmTransaction(conn,
  new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: deployer.publicKey,
      newAccountPubkey: bufferKp.publicKey,
      lamports: bufferRent, space: bufferDataSize,
      programId: BPF_UPGRADEABLE_ID,
    }),
    new TransactionInstruction({
      keys: [
        { pubkey: bufferKp.publicKey,  isSigner: false, isWritable: true  },
        { pubkey: deployer.publicKey,  isSigner: true,  isWritable: false },
      ],
      programId: BPF_UPGRADEABLE_ID,
      data: encodeInitializeBuffer(),
    }),
  ),
  [deployer, bufferKp], { commitment: 'confirmed' }
);
console.log(`Buffer created: ${sig1}\n`);

// ── 2. Write ELF in 900-byte chunks ─────────────────────────
const CHUNK = 900;
for (let off = 0; off < elfBytes.length; off += CHUNK) {
  const chunk = elfBytes.slice(off, Math.min(off + CHUNK, elfBytes.length));
  await sendAndConfirmTransaction(conn,
    new Transaction().add(new TransactionInstruction({
      keys: [
        { pubkey: bufferKp.publicKey, isSigner: false, isWritable: true  },
        { pubkey: deployer.publicKey, isSigner: true,  isWritable: false },
      ],
      programId: BPF_UPGRADEABLE_ID,
      data: encodeWrite(off, chunk),
    })),
    [deployer], { commitment: 'confirmed' }
  );
  process.stdout.write(`\r  Written ${Math.min(off+CHUNK, elfBytes.length)}/${elfBytes.length}`);
}
console.log('\nAll bytes written to buffer.\n');

// ── 3. Deploy program ────────────────────────────────────────
const [programDataPDA] = PublicKey.findProgramAddressSync(
  [programKp.publicKey.toBytes()], BPF_UPGRADEABLE_ID
);
const programRent = await conn.getMinimumBalanceForRentExemption(36);
console.log(`Program data PDA: ${programDataPDA.toBase58()}`);

try {
  const deploySig = await sendAndConfirmTransaction(conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: deployer.publicKey,
        newAccountPubkey: programKp.publicKey,
        lamports: programRent, space: 36,
        programId: BPF_UPGRADEABLE_ID,
      }),
      new TransactionInstruction({
        keys: [
          { pubkey: deployer.publicKey,    isSigner: true,  isWritable: true  }, // payer
          { pubkey: programDataPDA,        isSigner: false, isWritable: true  }, // program data
          { pubkey: programKp.publicKey,   isSigner: true,  isWritable: true  }, // program account
          { pubkey: bufferKp.publicKey,    isSigner: false, isWritable: true  }, // buffer
          { pubkey: SYSVAR_RENT,           isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK,          isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: deployer.publicKey,    isSigner: true,  isWritable: false }, // upgrade auth
        ],
        programId: BPF_UPGRADEABLE_ID,
        data: encodeDeployWithMaxDataLen(elfBytes.length),
      }),
    ),
    [deployer, programKp], { commitment: 'confirmed' }
  );
  console.log(`\n✅ DEPLOYED!`);
  console.log(`Program ID  : ${programKp.publicKey.toBase58()}`);
  console.log(`Deploy sig  : ${deploySig}`);
} catch(e) {
  console.error('Deploy error:', e.message);
  const logs = e.transactionLogs || [];
  logs.forEach(l => console.error(' ', l));
}
