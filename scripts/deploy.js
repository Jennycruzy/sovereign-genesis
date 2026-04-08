const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "XTZ");

  // ── Configuration ────────────────────────────────────────────────────────
  // Agent address: the EOA that the Node.js service will use to sign txs.
  // In production, set AGENT_ADDRESS in .env before deploying.
  const agentAddress = process.env.AGENT_ADDRESS || deployer.address;

  // Life-support buffer: minimum XTZ the contract keeps (default 1 XTZ).
  const lifeSupportBuffer = ethers.parseEther(
    process.env.LIFE_SUPPORT_BUFFER_XTZ || "1"
  );

  console.log(
    "\n─── Deploy parameters ───────────────────────────────────────"
  );
  console.log("  Agent address      :", agentAddress);
  console.log(
    "  Life-support buffer:",
    ethers.formatEther(lifeSupportBuffer),
    "XTZ"
  );
  console.log("────────────────────────────────────────────────────────────\n");

  // ── Deploy ────────────────────────────────────────────────────────────────
  const SovereignAgent = await ethers.getContractFactory("SovereignAgent");
  const contract = await SovereignAgent.deploy(agentAddress, lifeSupportBuffer);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log("SovereignAgent deployed to:", contractAddress);

  // ── Optionally seed the treasury ─────────────────────────────────────────
  const seedXtz = process.env.SEED_XTZ;
  if (seedXtz && parseFloat(seedXtz) > 0) {
    console.log(`\nSeeding treasury with ${seedXtz} XTZ…`);
    const tx = await deployer.sendTransaction({
      to: contractAddress,
      value: ethers.parseEther(seedXtz),
    });
    await tx.wait();
    console.log("Treasury seeded. TX:", tx.hash);
  }

  // ── Export ABI + address for agent / dashboard ───────────────────────────
  const artifact = await hre.artifacts.readArtifact("SovereignAgent");
  const deployment = {
    address: contractAddress,
    abi: artifact.abi,
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
  };

  const abiDir = path.join(__dirname, "..", "abi");
  if (!fs.existsSync(abiDir)) fs.mkdirSync(abiDir, { recursive: true });

  fs.writeFileSync(
    path.join(abiDir, "SovereignAgent.json"),
    JSON.stringify(deployment, null, 2)
  );
  console.log("\nABI + address written to abi/SovereignAgent.json");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  SOVEREIGN-GENESIS CONTRACT DEPLOYED");
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Address  :", contractAddress);
  console.log("  Agent    :", agentAddress);
  console.log("  Buffer   :", ethers.formatEther(lifeSupportBuffer), "XTZ");
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
