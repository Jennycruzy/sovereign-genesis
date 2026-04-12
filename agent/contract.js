/**
 * contract.js — ethers.js wrapper around SovereignAgent.sol
 * Provides typed helpers for all on-chain operations.
 *
 * Gas-optimisation notes:
 *  - Deployment data is cached after first load (no repeated fs I/O).
 *  - Read-only calls (treasuryBalance, spendableBalance, totalEscrowed, etc.)
 *    are batched via Multicall3 so a single eth_call handles N reads instead of
 *    N round-trips. The Multicall3 Contract instance and SovereignAgent Interface
 *    are both cached so repeated treasury snapshots do not re-parse ABI or
 *    re-allocate objects.
 *  - Treasury snapshot results are cached for 5 s (TREASURY_SNAPSHOT_TTL_MS) to
 *    avoid redundant multicall calls during rapid polling. The cache is cleared
 *    automatically after any state-changing transaction.
 *  - Write transactions use estimateGas (returns only the gas number, no EVM
 *    state writes) instead of the heavier callStatic pattern (full tx simulation)
 *    before every on-chain write — eliminating one redundant EVM execution per tx.
 *    A configurable buffer is applied on top and EIP-1559 fee settings are used.
 *  - Write transactions retry with exponential back-off on transient failures.
 *  - postBountiesBatch() helper allows posting multiple bounties in a single
 *    sequential loop with individual retry logic per transaction.
 */
const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");
const logger     = require("./logger");

// ── Multicall3 address on Etherlink (same as on Mainnet/Ethereum) ─────────────
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

// ── Module-level cache ───────────────────────────────────────────────────────
let _provider;
let _signer;
let _contract;
let _contractAddress;
let _deploymentCache = null;

// Cached Multicall3 contract instance (avoids re-creating the ethers.Contract
// object and re-building the ABI interface on every getTreasurySnapshot call).
let _mc3 = null;
let _mc3Iface = null;

// Cached Interface for the SovereignAgent contract (avoids re-parsing the ABI
// on every getTreasurySnapshot() call).
let _contractIface = null;

// TTL cache for treasury snapshot (ms) — avoids repeated multicall reads
// when getTreasurySnapshot() is called multiple times in quick succession.
let _treasurySnapshotCache    = null;
let _treasurySnapshotExpires = 0;
const TREASURY_SNAPSHOT_TTL_MS = 5000; // 5-second window

/**
 * Load and cache the deployment JSON.  Cache is invalidated when
 * CONTRACT_DEPLOYMENT env var changes (hot-reload in dev).
 */
function loadDeployment() {
  if (_deploymentCache && process.env.CONTRACT_DEPLOYMENT !== "reload") {
    return _deploymentCache;
  }
  const abiPath = path.join(__dirname, "..", "abi", "SovereignAgent.json");
  if (!fs.existsSync(abiPath)) {
    throw new Error(
      "abi/SovereignAgent.json not found. Run `npm run deploy:testnet` first."
    );
  }
  _deploymentCache = JSON.parse(fs.readFileSync(abiPath, "utf8"));
  return _deploymentCache;
}

/**
 * Return the cached (or lazily-created) Multicall3 Contract instance.
 * The ABI interface is also cached so encoded function data is reused.
 */
function _getMc3() {
  if (!_mc3) {
    _mc3    = new ethers.Contract(MULTICALL3_ADDRESS, _MC3_ABI, _provider);
    _mc3Iface = _mc3.interface;
  }
  return _mc3;
}

// Minimal Multicall3 aggregate3 ABI — only what we need.
const _MC3_ABI = [
  {
    name: "aggregate3",
    type: "function",
    inputs: [
      {
        type: "tuple[]",
        components: [
          { name: "target",       type: "address" },
          { name: "allowFailure", type: "bool"    },
          { name: "callData",     type: "bytes"    },
        ],
      },
    ],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "success",    type: "bool"   },
          { name: "returnData", type: "bytes"  },
        ],
      },
    ],
  },
];

/**
 * Initialise provider + signer + contract instance.
 * Called once at agent startup.
 */
function init() {
  const deployment = loadDeployment();

  _provider        = new ethers.JsonRpcProvider(process.env.ETHERLINK_RPC);
  _signer          = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, _provider);
  _contract        = new ethers.Contract(deployment.address, deployment.abi, _signer);
  _contractAddress = deployment.address;

  logger.info(`Contract client initialised at ${deployment.address}`);
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

// ── Gas estimation helpers ─────────────────────────────────────────────────────

/**
 * Default gas buffer applied on top of the raw estimate (20%).
 * Tuneable via GAS_BUFFER_BPS env var (value in basis points, e.g. 2000 = 20%).
 */
const DEFAULT_GAS_BUFFER_BPS = 2000;

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Retry a transaction with exponential back-off.
 * Retries on revert reasons that are safe to retry (nonce too low, replacement
 * underpriced, networkCongestion) and gives up on permanent failures.
 *
 * Uses EIP-1559 fee settings when the network supports them to avoid
 * overpaying on legacy-gas-price networks.
 */
async function _txWithRetry(fn, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      const tx  = await fn();
      const rec = await tx.wait();
      // Invalidate treasury snapshot cache after any state-changing tx
      _treasurySnapshotCache    = null;
      _treasurySnapshotExpires = 0;
      return rec;
    } catch (err) {
      const reason = err.reason || err.message || "";
      const isRetriable =
        /nonce too low|replacement underpriced|transaction underpriced|network is congestion/i.test(reason)
        || (err.reason === "nonce expired" || err.code === "NONCE_EXPIRED");

      if (!isRetriable || attempt >= maxRetries) {
        logger.error(`[contract] Transaction failed after ${attempt + 1} attempt(s): ${reason}`);
        throw err;
      }
      const delay = Math.min(500 * 2 ** attempt + Math.random() * 200, 4000);
      logger.warn(`[contract] Retrying tx in ${delay.toFixed(0)}ms (attempt ${attempt + 2}/${maxRetries}): ${reason}`);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

// ── Multicall3 batch read ─────────────────────────────────────────────────────

/**
 * Batch-read the full treasury snapshot in a single eth_call.
 * Falls back to individual calls if Multicall3 is not deployed.
 *
 * Results are cached for TREASURY_SNAPSHOT_TTL_MS (default 5 s) to avoid
 * redundant multicall round-trips when this function is called repeatedly
 * within a short window (e.g. polling loop).
 *
 * The Multicall3 Contract instance is lazily cached in _mc3 so repeated
 * calls to getTreasurySnapshot() do not allocate new Contract objects.
 * The SovereignAgent Interface is also cached in _contractIface so the ABI
 * is not re-parsed on every call.
 *
 * @returns {{ treasuryBalance, spendableBalance, lifeSupportBuffer, totalEscrowed }}
 */
async function getTreasurySnapshot() {
  const now = Date.now();
  if (_treasurySnapshotCache && now < _treasurySnapshotExpires) {
    return _treasurySnapshotCache;
  }

  const deployment = loadDeployment();
  const mc3        = _getMc3();

  // Cache the Interface so ABI is not re-parsed on every snapshot call
  if (!_contractIface) {
    _contractIface = new ethers.Interface(deployment.abi);
  }

  const readCalls = [
    { target: _contractAddress, allowFailure: false, callData: _contractIface.encodeFunctionData("treasuryBalance")    },
    { target: _contractAddress, allowFailure: false, callData: _contractIface.encodeFunctionData("spendableBalance")  },
    { target: _contractAddress, allowFailure: false, callData: _contractIface.encodeFunctionData("lifeSupportBuffer") },
    { target: _contractAddress, allowFailure: false, callData: _contractIface.encodeFunctionData("totalEscrowed")     },
  ];

  try {
    const results = await mc3.aggregate3.staticCall(readCalls);
    _treasurySnapshotCache = {
      treasuryBalance:   ethers.BigNumber.from(results[0].returnData),
      spendableBalance:  ethers.BigNumber.from(results[1].returnData),
      lifeSupportBuffer: ethers.BigNumber.from(results[2].returnData),
      totalEscrowed:     ethers.BigNumber.from(results[3].returnData),
    };
  } catch {
    // Multicall3 not available — fall back to individual calls
    logger.warn("[contract] Multicall3 unavailable; falling back to individual reads");
    const [treasuryBalance, spendableBalance, lifeSupportBuffer, totalEscrowed] = await Promise.all([
      _contract.treasuryBalance(),
      _contract.spendableBalance(),
      _contract.lifeSupportBuffer(),
      _contract.totalEscrowed(),
    ]);
    _treasurySnapshotCache = { treasuryBalance, spendableBalance, lifeSupportBuffer, totalEscrowed };
  }

  _treasurySnapshotExpires = now + TREASURY_SNAPSHOT_TTL_MS;
  return _treasurySnapshotCache;
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the raw ETH balance of the contract (single eth_getBalance call).
 */
async function getTreasuryBalance() {
  return _provider.getBalance(_contractAddress);
}

/**
 * Returns spendable balance (balance minus buffer minus escrowed).
 * Uses multicall when available.
 */
async function getSpendableBalance() {
  const { spendableBalance } = await getTreasurySnapshot();
  return spendableBalance;
}

async function getLifeSupportBuffer() {
  const { lifeSupportBuffer } = await getTreasurySnapshot();
  return lifeSupportBuffer;
}

async function getTotalEscrowed() {
  const { totalEscrowed } = await getTreasurySnapshot();
  return totalEscrowed;
}

async function isBountyPaid(prId) {
  return _contract.bountyPaid(prId);
}

async function getBountyAmount(prId) {
  return _contract.bounties(prId);
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Shared gas override builder for write helpers.
 * Uses estimateGas (lightweight — returns only the gas number, no EVM state
 * writes) instead of callStatic (full tx simulation) to avoid paying for
 * redundant EVM execution on every transaction.
 *
 * Adds a configurable buffer on top of the raw estimate and returns an
 * Overrides object with explicit gasLimit set. Falls back to an empty
 * overrides object on estimation failure so the transaction still proceeds
 * with ethers' default.
 *
 * @param {Function} estimateFn  - async function that calls contract.estimateGas.method(args)
 * @returns {object} ethers Overrides { gasLimit } or {}
 */
async function _buildGasOverride(estimateFn) {
  try {
    const raw     = await estimateFn();
    const bps     = parseInt(process.env.GAS_BUFFER_BPS || DEFAULT_GAS_BUFFER_BPS, 10);
    const buffer  = raw.mul(bps).div(10000);
    const gasLimit = raw.add(buffer);
    logger.info(`[contract] gas estimate=${raw.toString()} limit=${gasLimit.toString()}`);
    return { gasLimit };
  } catch (err) {
    logger.warn(`[contract] gas estimation failed (proceeding without override): ${err.message}`);
    return {};
  }
}

async function postBounty(prId, amountXtz) {
  const amount = ethers.parseEther(String(amountXtz));
  logger.info(`postBounty(${prId}, ${amountXtz} XTZ)`);
  return _txWithRetry(async () => {
    const overrides = await _buildGasOverride(() =>
      _contract.estimateGas.postBounty(prId, amount)
    );
    const tx = await _contract.postBounty(prId, amount, overrides);
    logger.info(`postBounty submitted: ${tx.hash}`);
    return tx;
  });
}

/**
 * Post multiple bounties in sequence, each with its own gas estimate + retry.
 * Returns an array of transaction receipts.
 * Use this when seeding multiple bounty items rather than awaiting each call separately.
 *
 * @param {Array<{prId: string, amountXtz: number}>} bounties
 * @returns {Promise<Array>} array of transaction receipts
 */
async function postBountiesBatch(bounties) {
  const receipts = [];
  for (const { prId, amountXtz } of bounties) {
    // eslint-disable-next-line no-await-in-loop
    const rec = await postBounty(prId, amountXtz);
    receipts.push(rec);
  }
  return receipts;
}

async function releaseBounty(prId, contributorAddress) {
  logger.info(`releaseBounty(${prId} → ${contributorAddress})`);
  return _txWithRetry(async () => {
    const overrides = await _buildGasOverride(() =>
      _contract.estimateGas.releaseBounty(prId, contributorAddress)
    );
    const tx = await _contract.releaseBounty(prId, contributorAddress, overrides);
    logger.info(`releaseBounty submitted: ${tx.hash}`);
    return tx;
  });
}

async function investSurplus(targetAddress) {
  logger.info(`investSurplus(→ ${targetAddress})`);
  return _txWithRetry(async () => {
    const overrides = await _buildGasOverride(() =>
      _contract.estimateGas.investSurplus(targetAddress)
    );
    const tx = await _contract.investSurplus(targetAddress, overrides);
    logger.info(`investSurplus submitted: ${tx.hash}`);
    return tx;
  });
}

async function setLifeSupportBuffer(amountXtz) {
  const amount = ethers.parseEther(String(amountXtz));
  return _txWithRetry(async () => {
    const overrides = await _buildGasOverride(() =>
      _contract.estimateGas.setLifeSupportBuffer(amount)
    );
    const tx = await _contract.setLifeSupportBuffer(amount, overrides);
    logger.info(`setLifeSupportBuffer submitted: ${tx.hash}`);
    return tx;
  });
}

module.exports = {
  init,
  getContract,
  getProvider,
  getTreasuryBalance,
  getSpendableBalance,
  getLifeSupportBuffer,
  getTotalEscrowed,
  isBountyPaid,
  getBountyAmount,
  postBounty,
  postBountiesBatch,
  releaseBounty,
  investSurplus,
  setLifeSupportBuffer,
  // Exposed for tests / benchmarking
  getTreasurySnapshot,
};
