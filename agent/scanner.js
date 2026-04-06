/**
 * scanner.js — GitHub Diagnostic Scanner
 *
 * Polls the configured repository for issues labelled "Bounty".
 * Parses the bounty amount from the issue body and calls postBounty()
 * on the smart contract for any new (unseen) bounties.
 */
const { ethers }   = require("ethers");
const { Octokit }  = require("@octokit/rest");
const contract     = require("./contract");
const financial    = require("./financial");
const logger       = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// In-memory set of issue numbers already posted on-chain (avoids duplicates
// between polling cycles; the contract itself is the source of truth).
const postedIssues = new Set();

/**
 * Parse a bounty amount (XTZ) from an issue body.
 * Expected format anywhere in the body:
 *   Bounty: 5 XTZ
 *   bounty: 2.5 xtz
 */
function parseBountyAmount(body = "") {
  const match = body.match(/bounty[:\s]+([0-9]+(?:\.[0-9]+)?)\s*xtz/i);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Parse a GitHub PR reference from an issue body.
 * Expected format:
 *   PR: #42
 *   PR: owner/repo#42
 */
function parsePrId(body = "", issueNumber) {
  const match = body.match(/PR[:\s]+([^\s\n]+)/i);
  if (match) return match[1].trim();
  // Fall back to issue number as identifier
  return `${REPO_OWNER}/${REPO_NAME}#${issueNumber}`;
}

/**
 * Single scan pass.
 */
async function scan() {
  logger.info("Scanner: checking for new Bounty issues…");

  let issues;
  try {
    const { data } = await octokit.issues.listForRepo({
      owner:  REPO_OWNER,
      repo:   REPO_NAME,
      labels: "Bounty",
      state:  "open",
      per_page: 100,
    });
    issues = data;
  } catch (err) {
    logger.error(`Scanner: GitHub API error — ${err.message}`);
    return;
  }

  for (const issue of issues) {
    if (postedIssues.has(issue.number)) continue;

    const amount = parseBountyAmount(issue.body || "");
    if (!amount) {
      logger.warn(`Scanner: issue #${issue.number} has no parseable bounty amount, skipping`);
      continue;
    }

    const prId = parsePrId(issue.body || "", issue.number);

    // Check whether it's already on-chain
    const existing = await contract.getBountyAmount(prId);
    const alreadyPaid = await contract.isBountyPaid(prId);
    if (existing > 0n || alreadyPaid) {
      postedIssues.add(issue.number);
      continue;
    }

    // Consult financial awareness before posting
    const advisedAmount = await financial.adviseBountyAmount(amount);
    if (advisedAmount === null) {
      logger.warn(
        `Scanner: financial advisor refused bounty for ${prId} — treasury below life-support`
      );
      continue;
    }

    if (advisedAmount <= 0) {
      logger.warn(`Scanner: advised bounty amount is 0 for ${prId}, skipping`);
      continue;
    }

    try {
      await contract.postBounty(prId, advisedAmount);
      if (advisedAmount !== amount) {
        logger.info(`Scanner: bounty adjusted by financial advisor: ${amount} → ${advisedAmount} XTZ`);
      }
      postedIssues.add(issue.number);
      logger.info(`Scanner: bounty posted for issue #${issue.number} (${prId}) — ${amount} XTZ`);
    } catch (err) {
      logger.error(`Scanner: failed to post bounty for ${prId} — ${err.message}`);
    }
  }
}

/**
 * Start the polling loop.
 */
function start(intervalMs = 60_000) {
  logger.info(`Scanner: starting poll every ${intervalMs / 1000}s`);
  scan(); // immediate first pass
  return setInterval(scan, intervalMs);
}

module.exports = { start, scan };
