/**
 * SOVEREIGN-GENESIS — Evolution Engine Entry Point
 *
 * Orchestrates:
 *   - Contract client initialisation
 *   - GitHub issue scanner (bounty posting)
 *   - PR review queue (judge + auto-merge)
 *   - Financial awareness loop (invest surplus, health reports)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const contract   = require("./contract");
const scanner    = require("./scanner");
const judge      = require("./judge");
const executor   = require("./executor");
const financial  = require("./financial");
const logger     = require("./logger");

// ── Startup validation ────────────────────────────────────────────────────────

function assertEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

assertEnv(
  "ETHERLINK_RPC",
  "AGENT_PRIVATE_KEY",
  "GITHUB_TOKEN",
  "GITHUB_REPO",
  "OPENAI_API_KEY"
);

// ── PR review queue ───────────────────────────────────────────────────────────

// Track PRs pending review to avoid duplicate processing
const reviewQueue = new Set();

/**
 * Triggered by the webhook server (via IPC or direct require) when a PR is
 * opened or synchronised.
 */
async function enqueuePrReview(prNumber) {
  if (reviewQueue.has(prNumber)) return;
  reviewQueue.add(prNumber);

  logger.info(`Agent: enqueued PR #${prNumber} for review`);

  try {
    const { verdict, reason, ciOk } = await judge.reviewPr(prNumber);
    await executor.postJudgeComment(prNumber, verdict, reason);

    if (verdict === "PASS") {
      const result = await executor.executeApprovedPr(prNumber);
      if (result.error) {
        logger.error(`Agent: execution error for PR #${prNumber} — ${result.error}`);
      }
    } else {
      logger.info(`Agent: PR #${prNumber} rejected — ${reason}`);
    }
  } catch (err) {
    logger.error(`Agent: unhandled error reviewing PR #${prNumber} — ${err.message}`);
  } finally {
    reviewQueue.delete(prNumber);
  }
}

// Export so webhook server can call it
module.exports = { enqueuePrReview };

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  logger.info("══════════════════════════════════════════════════");
  logger.info("  SOVEREIGN-GENESIS Evolution Engine starting…");
  logger.info("══════════════════════════════════════════════════");

  // Initialise on-chain client
  contract.init();

  // Print initial health
  await financial.printHealthReport();

  // Start GitHub scanner (polls every SCAN_INTERVAL_MS, default 60 s)
  const scanInterval = parseInt(process.env.SCAN_INTERVAL_MS || "60000", 10);
  scanner.start(scanInterval);

  // Financial awareness loop (every FINANCIAL_INTERVAL_MS, default 5 min)
  const finInterval = parseInt(process.env.FINANCIAL_INTERVAL_MS || "300000", 10);
  setInterval(async () => {
    await financial.printHealthReport();
    await financial.maybeInvest();
  }, finInterval);

  logger.info("Agent is live. Listening for GitHub events via webhook.");
}

// Only run bootstrap when this file is the entry point, not when required
if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
