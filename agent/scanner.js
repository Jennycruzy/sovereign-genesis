/**
 * scanner.js — GitHub Diagnostic Scanner
 *
 * Polls the configured repository for issues labelled with bounty-related tags.
 * Parses the bounty amount from the issue body or uses configured label mappings.
 * Calls postBounty() on the smart contract for any new (unseen) bounties.
 *
 * Dynamic Polling Strategy:
 * - Base interval: 60 seconds (configurable via POLL_INTERVAL_MS env var)
 * - Min interval: 15 seconds  (when many open issues or high activity)
 * - Max interval: 300 seconds (5 min, when no activity and no open issues)
 * - Activity score = (open_issue_count * weight) + recent_activity_bonus
 * - Interval scales inversely with activity score
 */
const { ethers }   = require("ethers");
const { Octokit }  = require("@octokit/rest");
const contract     = require("./contract");
const financial    = require("./financial");
const logger       = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

/**
 * Dynamic polling configuration
 */
const BASE_INTERVAL_MS  = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);
const MIN_INTERVAL_MS   = parseInt(process.env.POLL_MIN_INTERVAL_MS || "15000", 10);
const MAX_INTERVAL_MS    = parseInt(process.env.POLL_MAX_INTERVAL_MS || "300000", 10);
const ACTIVITY_DECAY_MS  = parseInt(process.env.POLL_ACTIVITY_DECAY_MS || "300000", 10); // 5 min
const ISSUE_WEIGHT       = 10;   // ms discount per open issue
const ACTIVITY_BONUS     = 5000; // ms discount when recent activity detected

/**
 * Polling state for dynamic interval calculation
 */
let currentIntervalMs  = BASE_INTERVAL_MS;
let lastActivityTime    = Date.now();
let lastIssueCount     = 0;
let scanCount          = 0;
let consecutiveEmpty    = 0; // count of consecutive scans with no new bounties

/**
 * Calculate dynamic interval based on activity and open issue count.
 * Higher activity / more open issues → shorter interval.
 * No activity for a while → gradually increase interval up to MAX.
 */
function calculateDynamicInterval(openIssueCount, hasRecentActivity) {
  const now = Date.now();

  // Time since last activity (in seconds)
  const inactiveMs = now - lastActivityTime;

  // Base: start from current interval
  let interval = currentIntervalMs;

  // If we have recent activity, reduce interval (poll faster)
  if (hasRecentActivity || openIssueCount > 0) {
    const activityDiscount = Math.min(
      ACTIVITY_BONUS,
      Math.floor(inactiveMs / 1000) * 100 // 100ms discount per second of inactivity (up to ACTIVITY_BONUS)
    );
    interval = Math.max(MIN_INTERVAL_MS, interval - activityDiscount - (openIssueCount * ISSUE_WEIGHT));
  } else if (inactiveMs > ACTIVITY_DECAY_MS) {
    // No activity for a while — back off exponentially toward MAX
    const backoffMultiplier = Math.min(4, 1 + (inactiveMs / ACTIVITY_DECAY_MS));
    interval = Math.min(MAX_INTERVAL_MS, Math.round(interval * backoffMultiplier));
  }

  return interval;
}

/**
 * Update polling state after each scan.
 */
function updatePollingState(openIssueCount, foundBounty) {
  const now = Date.now();
  lastIssueCount = openIssueCount;
  scanCount++;

  if (foundBounty) {
    lastActivityTime = now;
    consecutiveEmpty = 0;
  } else {
    consecutiveEmpty++;
  }

  // Update interval for next cycle
  const hasRecentActivity = (now - lastActivityTime) < ACTIVITY_DECAY_MS;
  currentIntervalMs = calculateDynamicInterval(openIssueCount, hasRecentActivity);
}

/**
 * Get performance metrics for logging/reporting.
 */
function getPollingMetrics() {
  return {
    intervalMs:      currentIntervalMs,
    lastIssueCount,
    scanCount,
    consecutiveEmpty,
    lastActivityAge: Date.now() - lastActivityTime,
    uptime:          process.uptime(),
  };
}

/**
 * BOUNTY_LABELS configuration.
 * Format: LABEL:AMOUNT,LABEL2:AMOUNT2
 * Example: Bounty:Small:0.5,Bounty:Large:5.0
 * If an issue has multiple matching labels, the largest amount is chosen.
 */
const BOUNTY_LABEL_MAP = (process.env.BOUNTY_LABELS || "Bounty").split(",").reduce((acc, part) => {
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

  const issueLabels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name);

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

  // Fallback to body parsing — either no label matched at all,
  // or the matched label had no hardcoded amount (null)
  const bodyAmount = parseBountyAmountFromBody(issue.body || "");
  if (bodyAmount !== null) return bodyAmount;

  // No amount found anywhere
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
 * Post a comment on the bounty issue explaining a volatility-driven reduction.
 */
async function postVolatilityComment(issueNumber, originalXtz, advisedXtz) {
  try {
    const body =
      `### ⚡ SOVEREIGN Financial Alert — Bounty Adjusted\n\n` +
      `The treasury balance showed **high volatility** when this bounty was posted. ` +
      `To protect the treasury, the bounty has been reduced by 50%:\n\n` +
      `| | Amount |\n|---|---|\n` +
      `| Requested | **${originalXtz} XTZ** |\n` +
      `| Posted on-chain | **${advisedXtz} XTZ** |\n\n` +
      `_This is an autonomous decision by the SOVEREIGN agent. ` +
      `Once volatility normalises the full amount may be available for future bounties._\n\n` +
      `<!-- SOVEREIGN:VOLATILITY_REDUCED originalXtz=${originalXtz} advisedXtz=${advisedXtz} -->`;

    await octokit.issues.createComment({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      issue_number: issueNumber,
      body,
    });
    logger.info(`Scanner: posted volatility note on issue #${issueNumber}`);
  } catch (err) {
    logger.warn(`Scanner: could not post volatility comment — ${err.message}`);
  }
}

/**
 * Single scan pass.
 * Returns { foundBounty: boolean, openCount: number }
 */
async function scan() {
  const scanStart = Date.now();
  logger.info(`Scanner: checking for issues with labels: ${SCAN_LABELS}…`);

  let issues = [];
  try {
    // We scan for all configured labels
    for (const label of Object.keys(BOUNTY_LABEL_MAP)) {
      const { data } = await octokit.issues.listForRepo({
        owner:  REPO_OWNER,
        repo:   REPO_NAME,
        labels: label,
        state:  "open",
        per_page: 100,
      });
      issues.push(...data);
    }

    // Deduplicate issues by number
    issues = Array.from(new Map(issues.map(item => [item.number, item])).values());

  } catch (err) {
    logger.error(`Scanner: GitHub API error — ${err.message}`);
    return { foundBounty: false, openCount: 0 };
  }

  let foundBounty = false;
  const openCount = issues.length;

  for (const issue of issues) {
    if (postedIssues.has(issue.number)) continue;

    const amount = getBountyAmount(issue);
    if (!amount) {
      logger.warn(`Scanner: issue #${issue.number} has no parseable bounty amount (via labels or body), skipping`);
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
    const advised = await financial.adviseBountyAmount(amount);
    if (advised === null) {
      logger.warn(
        `Scanner: financial advisor refused bounty for ${prId} — treasury below life-support`
      );
      continue;
    }

    const { amount: advisedAmount, reason: adjustReason } = advised;

    if (advisedAmount <= 0) {
      logger.warn(`Scanner: advised bounty amount is 0 for ${prId}, skipping`);
      continue;
    }

    try {
      await contract.postBounty(prId, advisedAmount);
      postedIssues.add(issue.number);
      foundBounty = true;

      if (adjustReason === "high_volatility") {
        logger.info(`Scanner: bounty reduced by financial advisor (volatility): ${amount} → ${advisedAmount} XTZ`);
        await postVolatilityComment(issue.number, amount, advisedAmount);
      } else if (adjustReason === "capped") {
        logger.info(`Scanner: bounty capped to spendable balance: ${amount} → ${advisedAmount} XTZ`);
      } else {
        logger.info(`Scanner: bounty posted for issue #${issue.number} (${prId}) — ${advisedAmount} XTZ`);
      }
    } catch (err) {
      logger.error(`Scanner: failed to post bounty for ${prId} — ${err.message}`);
    }
  }

  const scanDuration = Date.now() - scanStart;
  logger.info(
    `Scanner: scan #${scanCount + 1} complete in ${scanDuration}ms — ` +
    `${openCount} open issues, foundBounty=${foundBounty}, ` +
    `nextInterval=${(currentIntervalMs / 1000).toFixed(1)}s`
  );

  return { foundBounty, openCount };
}

/**
 * Dynamic polling loop.
 * Adjusts interval after each scan based on activity and open issue count.
 */
let pollTimer = null;

async function pollCycle() {
  const { foundBounty, openCount } = await scan();
  updatePollingState(openCount, foundBounty);

  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  pollTimer = setTimeout(pollCycle, currentIntervalMs);
  logger.info(`Scanner: next poll in ${(currentIntervalMs / 1000).toFixed(1)}s (intervalMs=${currentIntervalMs})`);
}

/**
 * Start the dynamic polling loop.
 * @param {number} initialIntervalMs - Override the starting interval (uses BASE_INTERVAL_MS otherwise)
 */
function start(initialIntervalMs) {
  if (initialIntervalMs) {
    currentIntervalMs = initialIntervalMs;
  }

  const metrics = getPollingMetrics();
  logger.info(
    `Scanner: starting dynamic poll — baseInterval=${BASE_INTERVAL_MS}ms, ` +
    `min=${MIN_INTERVAL_MS}ms, max=${MAX_INTERVAL_MS}ms, ` +
    `initialInterval=${currentIntervalMs}ms`
  );

  // Immediate first pass
  pollCycle();

  return {
    stop: () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
        logger.info("Scanner: stopped");
      }
    },
    getMetrics: getPollingMetrics,
  };
}

module.exports = { start, scan };
