const solc = require("solc");
const fs = require("fs");
const path = require("path");

const CONTRACT_PATH = path.resolve(__dirname, "../contracts/PrivateIntentEscrow.sol");
const OUTPUT_DIR = path.resolve(__dirname, "../build");

function compile() {
  const source = fs.readFileSync(CONTRACT_PATH, "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "PrivateIntentEscrow.sol": {
        content: source,
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const hasError = output.errors.some((e) => e.severity === "error");
    for (const err of output.errors) {
      console.error(`[${err.severity}] ${err.message}`);
    }
    if (hasError) process.exit(1);
  }

  const contractFile = output.contracts["PrivateIntentEscrow.sol"]["PrivateIntentEscrow"];
  const abi = contractFile.abi;
  const bytecode = contractFile.evm.bytecode.object;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "PrivateIntentEscrow.abi.json"), JSON.stringify(abi, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, "PrivateIntentEscrow.bin"), bytecode);

  const deploymentData = {
    abi,
    bytecode: "0x" + bytecode,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "PrivateIntentEscrow.json"), JSON.stringify(deploymentData, null, 2));

  console.log("✅ Compiled successfully!");
  console.log(`   ABI:      ${path.join(OUTPUT_DIR, "PrivateIntentEscrow.abi.json")}`);
  console.log(`   Bytecode: ${path.join(OUTPUT_DIR, "PrivateIntentEscrow.bin")}`);
  console.log(`   Full:     ${path.join(OUTPUT_DIR, "PrivateIntentEscrow.json")}`);
}

compile();