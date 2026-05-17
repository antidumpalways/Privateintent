/**
 * deployEscrow.mjs — compile + deploy PrivateIntentEscrow to Sepolia
 *
 * Usage:
 *   node artifacts/api-server/scripts/deployEscrow.mjs
 */

import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { ethers } from "ethers";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require  = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, "..", "..", "escrow-contract");
const SOL_PATH  = join(ROOT, "contracts/PrivateIntentEscrow.sol");
const OUT_PATH        = join(ROOT, "build/PrivateIntentEscrow.json");
const OUT_PATH_SRC    = join(ROOT, "build/PrivateIntentEscrow.json");

// ── 1. Load solc ───────────────────────────────────────────────────────────────

const solc = require("solc");

// ── 2. Compile ─────────────────────────────────────────────────────────────────

console.log("Compiling PrivateIntentEscrow.sol …");
const source = readFileSync(SOL_PATH, "utf8");

const input = JSON.stringify({
  language: "Solidity",
  sources: { "PrivateIntentEscrow.sol": { content: source } },
  settings: {
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    optimizer: { enabled: true, runs: 200 },
  },
});

const outputRaw = solc.compile(input);
const compiled  = JSON.parse(outputRaw);

if (compiled.errors) {
  const errors = compiled.errors.filter(e => e.severity === "error");
  if (errors.length) {
    console.error("Compilation errors:\n" + errors.map(e => e.formattedMessage).join("\n"));
    process.exit(1);
  }
  compiled.errors
    .filter(e => e.severity === "warning")
    .forEach(w => console.warn("  WARN:", w.message));
}

const contractOut = compiled.contracts?.["PrivateIntentEscrow.sol"]?.["PrivateIntentEscrow"];
if (!contractOut) {
  console.error("PrivateIntentEscrow not in compiler output:", JSON.stringify(compiled).slice(0, 500));
  process.exit(1);
}

const abiObj   = contractOut.abi;
const bytecode = "0x" + contractOut.evm.bytecode.object;
console.log(`  ABI functions: ${abiObj.filter(x => x.type === "function").map(x => x.name).join(", ")}`);
console.log(`  Bytecode size: ${(bytecode.length - 2) / 2} bytes`);

// ── 3. Deploy to Sepolia ───────────────────────────────────────────────────────

const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const privateKey  = process.env.SOLVER_ETH_PRIVATE_KEY;
if (!privateKey) { console.error("SOLVER_ETH_PRIVATE_KEY not set"); process.exit(1); }

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const wallet   = new ethers.Wallet(privateKey, provider);

console.log(`\nDeploying from ${wallet.address} on Sepolia …`);
const balance = await provider.getBalance(wallet.address);
console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);
if (balance === 0n) {
  console.error("  No Sepolia ETH — fund at https://sepoliafaucet.com"); process.exit(1);
}

const factory  = new ethers.ContractFactory(abiObj, bytecode, wallet);
const contract = await factory.deploy({ gasLimit: 800_000n });
const deployTx = contract.deploymentTransaction();
console.log(`  Tx: ${deployTx?.hash}`);
console.log("  Waiting for confirmation …");
await contract.waitForDeployment();
const address = await contract.getAddress();

console.log(`\n✅  Deployed: ${address}`);
console.log(`    https://sepolia.etherscan.io/address/${address}`);

// ── 4. Save artifact ───────────────────────────────────────────────────────────
// Write to BOTH canonical locations so the artifact is found in bundled (dist/)
// and unbundled (tsx / ts-node) runtime modes without requiring ETH_ESCROW_CONTRACT.

const artifact = JSON.stringify({
  address, abi: abiObj,
  deployedAt: new Date().toISOString(),
  network: "sepolia",
  deployTxHash: deployTx?.hash ?? "",
}, null, 2);

writeFileSync(OUT_PATH, artifact);
console.log(`\nSaved → ${OUT_PATH}`);
