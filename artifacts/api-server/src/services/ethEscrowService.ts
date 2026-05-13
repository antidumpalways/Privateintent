/**
 * ETH Escrow Service — Sepolia Escrow Contract Integration
 *
 * Handles on-chain ETH escrow via PrivateIntentEscrow smart contract on Sepolia.
 * After deployment, set ETH_ESCROW_CONTRACT_ADDRESS in .env.
 *
 * Flow:
 *   1. User calls createIntent() with ETH → Escrow contract holds the funds
 *   2. Solver delivers on destination chain
 *   3. Sentinel (live solver) calls settleIntent() → ETH released to solver
 *   4. OR sentinel calls refundIntent() → ETH returned to user
 */

import { ethers } from "ethers";

// ─── ABI ──────────────────────────────────────────────────────────────────────
const ESCROW_ABI = [
  "function createIntent(string calldata fromChain, string calldata toChain, string calldata fromToken, string calldata toToken, uint256 releaseAfter, string calldata proofHash) external payable returns (uint256 intentId)",
  "function settleIntent(uint256 intentId, address payable solverAddress, string calldata deliveryTxHash) external",
  "function refundIntent(uint256 intentId) external",
  "function disputeIntent(uint256 intentId) external",
  "function getIntent(uint256 intentId) external view returns (tuple(uint256 id, address user, address solver, uint256 amount, string fromChain, string toChain, string fromToken, string toToken, uint256 releaseAfter, uint8 status, string deliveryTxHash, string proofHash, uint256 createdAt, uint256 updatedAt))",
  "function getIntentCount() external view returns (uint256)",
  "function sentinel() external view returns (address)",
];

const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CONTRACT_ADDRESS = process.env.ETH_ESCROW_CONTRACT_ADDRESS ?? "";

// Sentinel ETH private key from .env
function getSentinelSigner(): ethers.Wallet | null {
  const pk = process.env.ETH_SOLVER_PRIVATE_KEY || process.env.SOLVER_ETH_PRIVATE_KEY || "";
  if (!pk) return null;
  try {
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    return new ethers.Wallet(pk.trim(), provider);
  } catch {
    return null;
  }
}

function getContract(): ethers.Contract | null {
  if (!CONTRACT_ADDRESS || !ethers.isAddress(CONTRACT_ADDRESS)) return null;
  const signer = getSentinelSigner();
  if (!signer) return null;
  return new ethers.Contract(CONTRACT_ADDRESS, ESCROW_ABI, signer);
}

export interface EthEscrowIntent {
  intentId: number;
  user: string;
  solver: string;
  amount: string;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  status: number;
  deliveryTxHash: string;
}

export async function getSentinelAddress(): Promise<string | null> {
  const signer = getSentinelSigner();
  return signer?.address ?? null;
}

/**
 * Create an escrow intent on Sepolia.
 * @returns The on-chain intent ID
 */
export async function createEthEscrow(
  fromChain: string,
  toChain: string,
  fromToken: string,
  toToken: string,
  amountWei: bigint,
  proofHash: string,
  releaseAfter: number = 0,
): Promise<number> {
  if (!CONTRACT_ADDRESS) throw new Error("ETH_ESCROW_CONTRACT_ADDRESS not set");
  
  const signer = getSentinelSigner();
  if (!signer) throw new Error("No signer available for ETH escrow");
  
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ESCROW_ABI, signer);
  
  const tx = await contract.createIntent(
    fromChain,
    toChain,
    fromToken,
    toToken,
    releaseAfter,
    proofHash,
    { value: amountWei },
  );
  const receipt = await tx.wait(1);
  
  // Parse logs to get intentId
  const parsedLog = contract.interface.parseLog({
    topics: receipt.logs[0].topics,
    data: receipt.logs[0].data,
  });
  
  const intentId = Number(parsedLog?.args?.intentId ?? 0);
  console.log(`[EthEscrow] Intent #${intentId} created — tx=${receipt.hash}`);
  
  return intentId;
}

/**
 * Settle intent — release ETH to solver (sentinel-only).
 */
export async function settleEthEscrow(
  intentId: number,
  solverAddress: string,
  deliveryTxHash: string,
): Promise<string | null> {
  const contract = getContract();
  if (!contract) return null;
  
  try {
    const tx = await contract.settleIntent(intentId, solverAddress, deliveryTxHash);
    const receipt = await tx.wait(1);
    console.log(`[EthEscrow] Intent #${intentId} settled — tx=${receipt.hash}`);
    return receipt.hash;
  } catch (err) {
    console.error(`[EthEscrow] settleIntent #${intentId} failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Refund intent — return ETH to user (sentinel-only).
 */
export async function refundEthEscrow(intentId: number): Promise<string | null> {
  const contract = getContract();
  if (!contract) return null;
  
  try {
    const tx = await contract.refundIntent(intentId);
    const receipt = await tx.wait(1);
    console.log(`[EthEscrow] Intent #${intentId} refunded — tx=${receipt.hash}`);
    return receipt.hash;
  } catch (err) {
    console.error(`[EthEscrow] refundIntent #${intentId} failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Get intent details from chain.
 */
export async function getEthEscrowIntent(intentId: number): Promise<EthEscrowIntent | null> {
  const contract = getContract();
  if (!contract) return null;
  
  try {
    const intent = await contract.getIntent(intentId);
    return {
      intentId: Number(intent.id),
      user: intent.user,
      solver: intent.solver,
      amount: ethers.formatEther(intent.amount),
      fromChain: intent.fromChain,
      toChain: intent.toChain,
      fromToken: intent.fromToken,
      toToken: intent.toToken,
      status: Number(intent.status),
      deliveryTxHash: intent.deliveryTxHash,
    };
  } catch {
    return null;
  }
}

export { CONTRACT_ADDRESS as ETH_ESCROW_CONTRACT_ADDRESS };