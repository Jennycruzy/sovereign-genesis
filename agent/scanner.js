/**
 * scanner.js — GitHub Diagnostic Scanner
 *
 * Polls the configured repository for issues labelled with bounty-related tags.
 * Parses the bounty amount from the issue body or uses configured label mappings.
 * Calls postBounty() on the smart contract for any new (unseen) bounties.
 */
const { ethers } = require("ethers");
const { Octokit } = require("@octokit/rest");
const contract = require("./contract");
const financial = require("./financial");
const logger = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split(
  "/"
);

/**
 * BOUNTY_LABELS configuration.
 * Format: LABEL:AMOUNT,LABEL2:AMOUNT2
 * Example: Bounty:Small:0.5,Bounty:Large:5.0
 * If an issue has multiple matching labels, the largest amount is chosen.
 */
const BOUNTY_LABEL_MAP = (process.env.BOUNTY_LABELS || "Bounty")
  .split(",")
  .reduce((acc, part) => {
    const [label, amountStr] = part.split(":");
    // Support simple "Bounty" label with no amount (fallback to parsing body)
    if (!amountStr) {
      acc[label.trim()] = null;
    } else {
      acc[label.trim()] = parseFloat(amountStr);
    }
    return acc;
  }, {});

const SCAN_LABELS = Object.keys(BOUNTY_LABEL_MAP).join(",");

// In-memory set of issue numbers already posted on-chain.
const postedIssues = new Set();

/**
 * Parse a bounty amount (XTZ) from an issue body.
 */
function parseBountyAmountFromBody(body = "") {
  const match = body.match(/bounty[:\s]+([0-9]+(?:\.[0-9]+)?)\s*xtz/i);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Determine the bounty amount based on labels and/or body parsing.
 */
function getBountyAmount(issue) {
  let labelAmount = 0;
  let hasLabelMatch = false;

  const issueLabels = (issue.labels || []).map((l) =>
    typeof l === "string" ? l : l.name
  );

  for (const label of issueLabels) {
    if (label in BOUNTY_LABEL_MAP) {
      hasLabelMatch = true;
      const amt = BOUNTY_LABEL_MAP[label];
      if (amt !== null && amt > labelAmount) {
        labelAmount = amt;
      }
    }
  }

  // If we found a label with an associated amount, return it
  if (labelAmount > 0) return labelAmount;

  // Fallback to body parsing if we matched a label but it had no hardcoded amount
  if (hasLabelMatch) {
    return parseBountyAmountFromBody(issue.body || "");
  }

  return null;
}

/**
 * Parse a GitHub PR reference from an issue body.
 */
function parsePrId(body = "", issueNumber) {
  const match = body.match(/PR[:\s]+([^\s\n]+)/i);
  if (match) return match[1].trim();
  return `${REPO_OWNER}/${REPO_NAME}#${issueNumber}`;
}

/**
 * Single scan pass.
 */
async function scan() {
  logger.info(`Scanner: checking for issues with labels: ${SCAN_LABELS}…`);

  let issues = [];
  try {
    // We scan for all configured labels
    for (const label of Object.keys(BOUNTY_LABEL_MAP)) {
      const { data } = await octokit.issues.listForRepo({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        labels: label,
        state: "open",
        per_page: 100,
      });
      issues.push(...data);
    }

    // Deduplicate issues by number
    issues = Array.from(
      new Map(issues.map((item) => [item.number, item])).values()
    );
  } catch (err) {
    logger.error(`Scanner: GitHub API error — ${err.message}`);
    return;
  }

  for (const issue of issues) {
    if (postedIssues.has(issue.number)) continue;

    const amount = getBountyAmount(issue);
    if (!amount) {
      logger.warn(
        `Scanner: issue #${issue.number} has no parseable bounty amount (via labels or body), skipping`
      );
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
        logger.info(
          `Scanner: bounty adjusted by financial advisor: ${amount} → ${advisedAmount} XTZ`
        );
      }
      postedIssues.add(issue.number);
      logger.info(
        `Scanner: bounty posted for issue #${issue.number} (${prId}) — ${amount} XTZ`
      );
    } catch (err) {
      logger.error(
        `Scanner: failed to post bounty for ${prId} — ${err.message}`
      );
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
