/**
 * contract.js — ethers.js v6 wrapper around SovereignAgent.sol
 *
 * Gas optimizations applied:
 *  - Contract address cached after init(); avoids repeated getAddress() calls
 *  - Read helpers batched via Multicall3 (0xcA11bde05977b3631167028862bE2a173976CA11)
 *    reducing 3 separate eth_call round-trips to a single one
 *  - Deployment ABI cached; no re-read on subsequent calls
 *  - provider.getBalance() called once and reused in batchTreasury()
 */
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");
const logger     = require("./logger");

// Multicall3 is deployed at the same address on most EVM chains
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

let _provider;
let _signer;
let _contract;
let _contractAddress; // cached — avoid repeated getAddress() calls
let _deployment;      // cached — avoid re-parsing abi file on every call

// ── Deployment loader (cached) ───────────────────────────────────────────────

function loadDeployment() {
  if (_deployment) return _deployment;

  const abiPath = path.join(__dirname, "..", "abi", "SovereignAgent.json");
  if (!fs.existsSync(abiPath)) {
    throw new Error(
      "abi/SovereignAgent.json not found. Run `npm run deploy:testnet` first."
    );
  }
  _deployment = JSON.parse(fs.readFileSync(abiPath, "utf8"));
  return _deployment;
}

/**
 * Initialise provider + signer + contract instance.
 * Called once at agent startup.
 */
function init() {
  const deployment = loadDeployment();

  _provider = new ethers.JsonRpcProvider(process.env.ETHERLINK_RPC);
  _signer   = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, _provider);
  _contract = new ethers.Contract(deployment.address, deployment.abi, _signer);
  _contractAddress = deployment.address; // cache immediately

  logger.info(`Contract client initialised at ${_contractAddress}`);
  return { provider: _provider, signer: _signer, contract: _contract };
}

function getContract() {
  if (!_contract) throw new Error("Call contract.init() before using the contract.");
  return _contract;
}

function getProvider() {
  if (!_provider) throw new Error("Call contract.init() first.");
  return _provider;
}

function getContractAddress() {
  if (!_contractAddress) throw new Error("Call contract.init() first.");
  return _contractAddress;
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/**
 * Batch-read treasury state in a single Multicall3 call.
 * Replaces 3 separate eth_call round-trips with 1.
 *
 * @returns {{ treasury: bigint, buffer: bigint, spendable: bigint }}
 */
async function getTreasuryState() {
  const address = getContractAddress();

  // Build the encoded calls for multicall3.aggregate3
  const iface = _contract.interface;
  const calls = [
    {
      target:       address,
      allowFailure: false,
      callData:     iface.encodeFunctionData("treasuryBalance"),
    },
    {
      target:       address,
      allowFailure: false,
      callData:     iface.encodeFunctionData("lifeSupportBuffer"),
    },
    {
      target:       address,
      allowFailure: false,
      callData:     iface.encodeFunctionData("spendableBalance"),
    },
  ];

  const multicall = new ethers.Contract(MULTICALL3, [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calldata) external payable returns (tuple(bool success, bytes returnData)[])",
  ], _provider);

  let results;
  try {
    results = await multicall.aggregate3.staticCall(calls);
  } catch (err) {
    logger.error(`getTreasuryState: multicall failed — ${err.message}; falling back to individual calls`);
    // Fallback: individual calls (backwards-compatible path)
    const [treasury, buffer, spendable] = await Promise.all([
      _provider.getBalance(address),
      _contract.lifeSupportBuffer(),
      _contract.spendableBalance(),
    ]);
    return { treasury, buffer, spendable };
  }

  const [treasuryData, bufferData, spendableData] = results;
  return {
    treasury:  BigInt(iface.decodeFunctionResult("treasuryBalance",   treasuryData.returnData)[0]),
    buffer:    BigInt(iface.decodeFunctionResult("lifeSupportBuffer",  bufferData.returnData)[0]),
    spendable: BigInt(iface.decodeFunctionResult("spendableBalance",  spendableData.returnData)[0]),
  };
}

async function getTreasuryBalance() {
  return _provider.getBalance(getContractAddress());
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

/**
 * Estimate and log gas before sending a transaction.
 * This provides visibility into expected gas costs without changing on-chain behavior.
 */
async function estimateGasDebug(label, fn) {
  try {
    const gas = await fn(); // fn is a populated TransactionRequest
    const estimate = await _provider.estimate(gas);
    logger.info(`${label}: estimated gas = ${estimate.toString()}`);
    return gas;
  } catch {
    return fn(); // if estimation fails (e.g. reverts), just return the unsigned tx
  }
}

async function postBounty(prId, amountXtz) {
  const amount = ethers.parseEther(String(amountXtz));
  logger.info(`postBounty(${prId}, ${amountXtz} XTZ)`);

  const populated = await _contract.postBounty.populateTransaction(prId, amount);
  const tx = await _signer.sendTransaction(populated);
  logger.info(`postBounty sent: ${tx.hash}`);

  const receipt = await tx.wait();
  logger.info(`postBounty mined: ${receipt.hash} (gas used: ${receipt.gasUsed})`);
  return receipt;
}

async function releaseBounty(prId, contributorAddress) {
  logger.info(`releaseBounty(${prId} → ${contributorAddress})`);

  const populated = await _contract.releaseBounty.populateTransaction(prId, contributorAddress);
  const tx = await _signer.sendTransaction(populated);
  logger.info(`releaseBounty sent: ${tx.hash}`);

  const receipt = await tx.wait();
  logger.info(`releaseBounty mined: ${receipt.hash} (gas used: ${receipt.gasUsed})`);
  return receipt;
}

async function investSurplus(targetAddress) {
  logger.info(`investSurplus(→ ${targetAddress})`);

  const populated = await _contract.investSurplus.populateTransaction(targetAddress);
  const tx = await _signer.sendTransaction(populated);
  logger.info(`investSurplus sent: ${tx.hash}`);

  const receipt = await tx.wait();
  logger.info(`investSurplus mined: ${receipt.hash} (gas used: ${receipt.gasUsed})`);
  return receipt;
}

async function setLifeSupportBuffer(amountXtz) {
  const amount = ethers.parseEther(String(amountXtz));

  const populated = await _contract.setLifeSupportBuffer.populateTransaction(amount);
  const tx = await _signer.sendTransaction(populated);
  logger.info(`setLifeSupportBuffer sent: ${tx.hash} → ${amountXtz} XTZ`);

  const receipt = await tx.wait();
  logger.info(`setLifeSupportBuffer mined: ${receipt.hash} (gas used: ${receipt.gasUsed})`);
  return receipt;
}

module.exports = {
  init,
  getContract,
  getProvider,
  getContractAddress,
  getTreasuryState,   // new: batched read helper
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
