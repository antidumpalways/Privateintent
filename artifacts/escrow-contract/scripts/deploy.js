const hre = require("hardhat");

async function main() {
  const sentinelAddress = process.env.SENTINEL_ETH_ADDRESS;
  if (!sentinelAddress) {
    console.error("❌ SENTINEL_ETH_ADDRESS not set in .env");
    process.exit(1);
  }

  console.log(`📡 Deploying PrivateIntentEscrow to Sepolia...`);
  console.log(`🔑 Sentinel address: ${sentinelAddress}`);

  const Escrow = await hre.ethers.getContractFactory("PrivateIntentEscrow");
  const escrow = await Escrow.deploy(sentinelAddress);

  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  const txHash = escrow.deploymentTransaction()?.hash;

  console.log(`\n✅ PrivateIntentEscrow deployed!`);
  console.log(`   Contract: ${address}`);
  console.log(`   Tx:       ${txHash}`);
  console.log(`   Sentinel: ${sentinelAddress}`);
  console.log(`\n📋 Add this to backend .env:`);
  console.log(`   ETH_ESCROW_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});