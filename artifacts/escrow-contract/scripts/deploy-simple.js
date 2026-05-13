const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.ETH_SOLVER_PRIVATE_KEY;
  const sentinelAddress = process.env.SENTINEL_ETH_ADDRESS;

  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  if (!sentinelAddress) throw new Error("SENTINEL_ETH_ADDRESS not set");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey.trim(), provider);

  // Load compiled contract
  const buildPath = path.resolve(__dirname, "../build/PrivateIntentEscrow.json");
  const { abi, bytecode } = JSON.parse(fs.readFileSync(buildPath, "utf8"));

  console.log(`📡 Deploying to Sepolia...`);
  console.log(`   Deployer: ${wallet.address}`);
  console.log(`   Sentinel: ${sentinelAddress}`);
  console.log(`   Balance:  ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(sentinelAddress);
  
  console.log(`   Deploy tx submitted: ${contract.deploymentTransaction()?.hash}`);

  const receipt = await contract.deploymentTransaction()?.wait(2);
  const contractAddress = await contract.getAddress();

  console.log(`\n✅ PrivateIntentEscrow deployed!`);
  console.log(`   Contract: ${contractAddress}`);
  console.log(`   Block:    ${receipt?.blockNumber}`);
  console.log(`   Gas used: ${receipt?.gasUsed?.toString()}`);
  
  // Save deployment info
  const deployInfo = {
    contractAddress,
    deployer: wallet.address,
    sentinel: sentinelAddress,
    network: "sepolia",
    txHash: contract.deploymentTransaction()?.hash,
    blockNumber: receipt?.blockNumber,
    timestamp: new Date().toISOString(),
  };
  const infoPath = path.resolve(__dirname, "../build/deploy-info.json");
  fs.writeFileSync(infoPath, JSON.stringify(deployInfo, null, 2));
  console.log(`   Info saved to: ${infoPath}`);

  console.log(`\n📋 Add this to backend .env:`);
  console.log(`   ETH_ESCROW_CONTRACT_ADDRESS=${contractAddress}`);
}

main().catch((err) => {
  console.error("❌ Deploy failed:", err.message);
  process.exit(1);
});