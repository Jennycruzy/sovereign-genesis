/**
 * financial.js — Financial Awareness Logic
 *
 * Implements the agent's self-preservation and investment rules:
 *
 *   1. If balance < lifeSupportBuffer → refuse to hire (block postBounty)
 *   2. If "volatility" high           → reduce bounty size
 *   3. If surplus high               → call investSurplus()
 */
const { ethers }  = require("ethers");
const contract    = require("./contract");
const logger      = require("./logger");

// ── Config (tuneable via env) ─────────────────────────────────────────────────

// Fraction of spendable balance beyond which "surplus is high"
const INVEST_THRESHOLD_RATIO = parseFloat(process.env.INVEST_THRESHOLD_RATIO || "0.5");

// Target investment address (e.g. a liquidity pool on Etherlink)
const YIELD_TARGET = process.env.YIELD_TARGET_ADDRESS || null;

// Volatility oracle: simple in-process tracker using recent balance changes
const balanceHistory = [];
const HISTORY_WINDOW = 10; // samples

// ── Volatility detection ──────────────────────────────────────────────────────

function recordBalance(balanceWei) {
  balanceHistory.push(BigInt(balanceWei));
  if (balanceHistory.length > HISTORY_WINDOW) balanceHistory.shift();
}

/**
 * Very lightweight volatility proxy: standard deviation of balance changes
 * expressed as a percentage of the mean.
 * Returns a number in [0, ∞). Values > 20 (%) are treated as "high volatility".
 */
function computeVolatility() {
  if (balanceHistory.length < 2) return 0;
  const diffs = [];
  for (let i = 1; i < balanceHistory.length; i++) {
    const diff = balanceHistory[i] - balanceHistory[i - 1];
    diffs.push(diff < 0n ? -diff : diff);
  }
  const mean = diffs.reduce((a, b) => a + b, 0n) / BigInt(diffs.length);
  if (mean === 0n) return 0;
  // Variance
  const variance = diffs.reduce((acc, d) => {
    const delta = d - mean;
    return acc + delta * delta;
  }, 0n) / BigInt(diffs.length);
  // Std dev (integer sqrt approximation)
  const stddev = bigIntSqrt(variance);
  // Return as % of mean
  return Number((stddev * 100n) / mean);
}

function bigIntSqrt(n) {
  if (n < 0n) throw new Error("Negative sqrt");
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

function isHighVolatility() {
  return computeVolatility() > 20;
}

// ── Bounty scaling ────────────────────────────────────────────────────────────

/**
 * Adjust a requested bounty amount based on current financial state.
 * Returns the (possibly reduced) amount in XTZ, or null if we should refuse.
 */
async function adviseBountyAmount(requestedXtz) {
  // Use batched treasury state (1 multicall instead of 3 eth_calls)
  const { treasury, buffer, spendable } = await contract.getTreasuryState();

  recordBalance(treasury);

  // Rule 1: life support
  if (treasury <= buffer) {
    logger.warn("Financial: balance below life-support — refusing to post bounty");
    return null;
  }

  // Rule 2: volatility
  const requestedWei = ethers.parseEther(String(requestedXtz));
  let advisedWei = requestedWei;

  if (isHighVolatility()) {
    // Reduce bounty by 50 % under high volatility
    advisedWei = requestedWei / 2n;
    const advisedXtz = ethers.formatEther(advisedWei);
    logger.warn(
      `Financial: high volatility detected — reducing bounty from ` +
      `${requestedXtz} XTZ to ${advisedXtz} XTZ`
    );
  }

  // Ensure we don't exceed spendable
  if (advisedWei > spendable) {
    logger.warn(
      `Financial: advised bounty (${ethers.formatEther(advisedWei)} XTZ) ` +
      `exceeds spendable (${ethers.formatEther(spendable)} XTZ) — capping`
    );
    advisedWei = spendable;
  }

  return parseFloat(ethers.formatEther(advisedWei));
}

// ── Surplus investment ────────────────────────────────────────────────────────

/**
 * If surplus exceeds the investment threshold, forward it to the yield target.
 */
async function maybeInvest() {
  if (!YIELD_TARGET) {
    logger.debug("Financial: no YIELD_TARGET_ADDRESS set, skipping investment check");
    return;
  }

  // Use batched treasury state (1 multicall instead of 3 eth_calls)
  const { treasury, buffer, spendable } = await contract.getTreasuryState();

  recordBalance(treasury);

  const threshold = BigInt(
    Math.floor(Number(buffer) * INVEST_THRESHOLD_RATIO)
  );

  if (spendable < threshold) {
    logger.debug(
      `Financial: surplus ${ethers.formatEther(spendable)} XTZ below invest ` +
      `threshold ${ethers.formatEther(threshold)} XTZ`
    );
    return;
  }

  if (isHighVolatility()) {
    logger.warn("Financial: high volatility — skipping investment this cycle");
    return;
  }

  try {
    await contract.investSurplus(YIELD_TARGET);
    logger.info(
      `Financial: invested ${ethers.formatEther(spendable)} XTZ → ${YIELD_TARGET}`
    );
  } catch (err) {
    logger.error(`Financial: investSurplus failed — ${err.message}`);
  }
}

// ── Periodic health report ────────────────────────────────────────────────────

async function printHealthReport() {
  try {
    // Use batched treasury state (1 multicall instead of 3 eth_calls)
    const { treasury, buffer, spendable } = await contract.getTreasuryState();

    const vol = computeVolatility();
    const status = treasury <= buffer ? "CRITICAL" : "HEALTHY";

    logger.info(
      `[FINANCIAL HEALTH] Status=${status} | ` +
      `Treasury=${ethers.formatEther(treasury)} XTZ | ` +
      `Buffer=${ethers.formatEther(buffer)} XTZ | ` +
      `Spendable=${ethers.formatEther(spendable)} XTZ | ` +
      `Volatility=${vol.toFixed(1)}%`
    );
  } catch (err) {
    logger.error(`Financial health report failed: ${err.message}`);
  }
}

module.exports = {
  adviseBountyAmount,
  maybeInvest,
  printHealthReport,
  isHighVolatility,
  recordBalance,
};
