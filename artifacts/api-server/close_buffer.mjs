import { readFileSync } from 'fs';
import {
  Connection, Keypair, PublicKey, Transaction,
  sendAndConfirmTransaction, TransactionInstruction,
} from '@solana/web3.js';

const BPF_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const deployerArr = JSON.parse(readFileSync('/home/runner/.config/solana/id.json', 'utf8'));
const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerArr));

// Close instruction = variant 5 in bincode
// CloseAccount { } — accounts: [writable closed, writable recipient, signer auth, optional program]
function encodeClose() {
  const b = Buffer.alloc(4); b.writeUInt32LE(5, 0); return b;
}

// The buffer created in run 1 that has SOL locked in it
const buffers = [
  'GgGQ62ToA8ecvpjBBQe1VQYWQjBTMdwZ9PQ11jS8trA9', // run1 buffer (invalid write)
];

for (const addr of buffers) {
  const bufPub = new PublicKey(addr);
  const info = await conn.getAccountInfo(bufPub);
  if (!info) { console.log(`${addr}: not found / already closed`); continue; }
  console.log(`Closing ${addr} (${info.lamports/1e9} SOL)...`);
  try {
    const sig = await sendAndConfirmTransaction(conn,
      new Transaction().add(new TransactionInstruction({
        keys: [
          { pubkey: bufPub,             isSigner: false, isWritable: true  }, // close
          { pubkey: deployer.publicKey, isSigner: false, isWritable: true  }, // destination
          { pubkey: deployer.publicKey, isSigner: true,  isWritable: false }, // authority
        ],
        programId: BPF_UPGRADEABLE_ID,
        data: encodeClose(),
      })),
      [deployer], { commitment: 'confirmed' }
    );
    console.log(`  Closed: ${sig}`);
  } catch(e) {
    console.error(`  Error: ${e.message}`);
  }
}
