/**
 * contract.js — ethers.js wrapper around SovereignAgent.sol
 * Provides typed helpers for all on-chain operations.
 */
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

let _provider;
let _signer;
let _contract;

function loadDeployment() {
  const abiPath = path.join(__dirname, "..", "abi", "SovereignAgent.json");
  if (!fs.existsSync(abiPath)) {
    throw new Error(
      "abi/SovereignAgent.json not found. Run `npm run deploy:testnet` first."
    );
  }
  return JSON.parse(fs.readFileSync(abiPath, "utf8"));
}

/**
 * Initialise provider + signer + contract instance.
 * Called once at agent startup.
 */
function init() {
  const deployment = loadDeployment();

  _provider = new ethers.JsonRpcProvider(process.env.ETHERLINK_RPC);
  _signer = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, _provider);
  _contract = new ethers.Contract(deployment.address, deployment.abi, _signer);

  logger.info(`Contract client initialised at ${deployment.address}`);
  return { provider: _provider, signer: _signer, contract: _contract };
}

function getContract() {
  if (!_contract)
    throw new Error("Call contract.init() before using the contract.");
  return _contract;
}

function getProvider() {
  if (!_provider) throw new Error("Call contract.init() first.");
  return _provider;
}

// ── Read helpers ──────────────────────────────────────────────────────────────

async function getTreasuryBalance() {
  return _provider.getBalance(await _contract.getAddress());
}

async function getLifeSupportBuffer() {
  return _contract.lifeSupportBuffer();
}

async function getSpendableBalance() {
  return _contract.spendableBalance();
}

async function isBountyPaid(prId) {
  return _contract.bountyPaid(prId);
}

async function getBountyAmount(prId) {
  return _contract.bounties(prId);
}

// ── Write helpers ─────────────────────────────────────────────────────────────

async function postBounty(prId, amountXtz) {
  const amount = ethers.parseEther(String(amountXtz));
  logger.info(`postBounty(${prId}, ${amountXtz} XTZ)`);
  const tx = await _contract.postBounty(prId, amount);
  const receipt = await tx.wait();
  logger.info(`postBounty mined: ${receipt.hash}`);
  return receipt;
}

async function releaseBounty(prId, contributorAddress) {
  logger.info(`releaseBounty(${prId} → ${contributorAddress})`);
  const tx = await _contract.releaseBounty(prId, contributorAddress);
  const receipt = await tx.wait();
  logger.info(`releaseBounty mined: ${receipt.hash}`);
  return receipt;
}

async function investSurplus(targetAddress) {
  logger.info(`investSurplus(→ ${targetAddress})`);
  const tx = await _contract.investSurplus(targetAddress);
  const receipt = await tx.wait();
  logger.info(`investSurplus mined: ${receipt.hash}`);
  return receipt;
}

async function setLifeSupportBuffer(amountXtz) {
  const amount = ethers.parseEther(String(amountXtz));
  const tx = await _contract.setLifeSupportBuffer(amount);
  const receipt = await tx.wait();
  logger.info(`lifeSupportBuffer updated to ${amountXtz} XTZ`);
  return receipt;
}

module.exports = {
  init,
  getContract,
  getProvider,
  getTreasuryBalance,
  getLifeSupportBuffer,
  getSpendableBalance,
  isBountyPaid,
  getBountyAmount,
  postBounty,
  releaseBounty,
  investSurplus,
  setLifeSupportBuffer,
};
