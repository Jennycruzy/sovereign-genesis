/**
 * executor.js — Auto-Merge + Bounty Release
 *
 * After the Judge issues a PASS verdict:
 *   1. Merge the PR via GitHub API
 *   2. Resolve the contributor's wallet address from a PR comment or label
 *   3. Call releaseBounty() on-chain
 */
const { Octokit } = require("@octokit/rest");
const contract    = require("./contract");
const logger      = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

/**
 * Attempt to extract a wallet address from PR comments.
 * Convention: contributor posts a comment containing:
 *   Wallet: 0xABCDEF...
 */
async function resolveContributorWallet(prNumber) {
  const { data: comments } = await octokit.issues.listComments({
    owner:       REPO_OWNER,
    repo:        REPO_NAME,
    issue_number: prNumber,
    per_page:    100,
  });

  for (const comment of comments.reverse()) {
    const match = comment.body?.match(/wallet[:\s]+(0x[a-fA-F0-9]{40})/i);
    if (match) return match[1];
  }

  // Fall back to the PR description
  const { data: pr } = await octokit.pulls.get({
    owner:       REPO_OWNER,
    repo:        REPO_NAME,
    pull_number: prNumber,
  });
  const match = pr.body?.match(/wallet[:\s]+(0x[a-fA-F0-9]{40})/i);
  if (match) return match[1];

  return null;
}

/**
 * Build the canonical PR ID string used as the mapping key in the contract.
 */
function buildPrId(prNumber) {
  return `${REPO_OWNER}/${REPO_NAME}#${prNumber}`;
}

/**
 * Post a comment asking the contributor to add their wallet address.
 * Used as a blocking step before merge.
 */
async function postWalletRequestComment(prNumber) {
  const body =
    `### SOVEREIGN Payment Setup Required\n\n` +
    `❌ **No wallet address found — cannot process bounty payment**\n\n` +
    `To receive your XTZ bounty, add your Etherlink wallet address to this PR description ` +
    `or as a comment in exactly this format:\n\n` +
    `\`\`\`\nWallet: 0xYourEtherlinkAddress\n\`\`\`\n\n` +
    `Once added, push a new commit or re-request review — ` +
    `the agent will pick it up automatically and process payment.\n\n` +
    `<!-- SOVEREIGN:WALLET_MISSING prNumber=${prNumber} -->`;
  try {
    await octokit.issues.createComment({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      issue_number: prNumber,
      body,
    });
  } catch (err) {
    logger.warn(`Executor: could not post wallet request comment — ${err.message}`);
  }
}

/**
 * Post a comment on a PR that was merged externally with no wallet found.
 * The contributor can still reply with their wallet to trigger late payment.
 */
async function postMergedNoWalletComment(prNumber) {
  const body =
    `### SOVEREIGN No Payout\n\n` +
    `⚠️ **This PR was merged but no wallet address was found — bounty has NOT been released**\n\n` +
    `If you are the contributor, add your Etherlink wallet address as a comment:\n\n` +
    `\`\`\`\nWallet: 0xYourEtherlinkAddress\n\`\`\`\n\n` +
    `The agent monitors this PR and will attempt to release the bounty once a wallet is provided.\n\n` +
    `<!-- SOVEREIGN:MERGED_NO_WALLET prNumber=${prNumber} -->`;
  try {
    await octokit.issues.createComment({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      issue_number: prNumber,
      body,
    });
  } catch (err) {
    logger.warn(`Executor: could not post no-wallet comment — ${err.message}`);
  }
}

/**
 * Merge a PR and release its bounty.
 * Checks for wallet address BEFORE merging — if missing, blocks merge and
 * asks the contributor to provide one.
 *
 * @param {number} prNumber
 * @returns {{ merged: boolean, txHash: string | null, error: string | null }}
 */
async function executeApprovedPr(prNumber) {
  const prId = buildPrId(prNumber);
  logger.info(`Executor: processing approved PR #${prNumber} (${prId})`);

  // ── 0. Pre-flight: wallet check BEFORE merging ────────────────────────────
  // We refuse to merge without a wallet so the PR stays open for the contributor
  // to add their address — no merge means no irreversible state change.
  const wallet = await resolveContributorWallet(prNumber);
  if (!wallet) {
    logger.warn(
      `Executor: PR #${prNumber} has no wallet address — blocking merge, ` +
      `posting instructions for contributor`
    );
    await postWalletRequestComment(prNumber);
    return { merged: false, txHash: null, error: "No wallet address — merge blocked, contributor notified" };
  }

  // ── 1. Merge the PR ───────────────────────────────────────────────────────
  try {
    const { data: mergeResult } = await octokit.pulls.merge({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      pull_number:  prNumber,
      merge_method: "squash",
      commit_title: `[SOVEREIGN] Auto-merge PR #${prNumber}`,
    });

    if (!mergeResult.merged) {
      logger.error(`Executor: GitHub merge rejected — ${mergeResult.message}`);
      return { merged: false, txHash: null, error: mergeResult.message };
    }

    logger.info(`Executor: PR #${prNumber} merged — ${mergeResult.sha}`);
  } catch (err) {
    logger.error(`Executor: merge failed — ${err.message}`);
    return { merged: false, txHash: null, error: err.message };
  }

  // ── 2. Release bounty on-chain ────────────────────────────────────────────
  const alreadyPaid = await contract.isBountyPaid(prId);
  if (alreadyPaid) {
    logger.warn(`Executor: bounty for ${prId} already paid`);
    return { merged: true, txHash: null, error: "Bounty already paid" };
  }

  try {
    const receipt = await contract.releaseBounty(prId, wallet);
    logger.info(
      `Executor: bounty released for PR #${prNumber} → ${wallet} | tx ${receipt.hash}`
    );
    return { merged: true, txHash: receipt.hash, error: null };
  } catch (err) {
    logger.error(`Executor: releaseBounty failed — ${err.message}`);
    return { merged: true, txHash: null, error: err.message };
  }
}

/**
 * Attempt to release a bounty for a PR that was already merged externally.
 * Does NOT attempt to merge (PR is already closed). If no wallet is found,
 * posts a comment so the contributor knows what to do.
 *
 * @param {number} prNumber
 * @returns {{ txHash: string | null, error: string | null }}
 */
async function releaseExternallyMergedPr(prNumber) {
  const prId = buildPrId(prNumber);
  logger.info(`Executor: attempting bounty release for externally merged PR #${prNumber} (${prId})`);

  const wallet = await resolveContributorWallet(prNumber);
  if (!wallet) {
    logger.warn(`Executor: externally merged PR #${prNumber} has no wallet — posting no-payout note`);
    await postMergedNoWalletComment(prNumber);
    return { txHash: null, error: "No wallet — contributor notified via comment" };
  }

  const alreadyPaid = await contract.isBountyPaid(prId);
  if (alreadyPaid) {
    logger.warn(`Executor: bounty for ${prId} already paid`);
    return { txHash: null, error: "Bounty already paid" };
  }

  try {
    const receipt = await contract.releaseBounty(prId, wallet);
    logger.info(
      `Executor: bounty released for externally merged PR #${prNumber} → ${wallet} | tx ${receipt.hash}`
    );
    return { txHash: receipt.hash, error: null };
  } catch (err) {
    logger.error(`Executor: releaseBounty failed — ${err.message}`);
    return { txHash: null, error: err.message };
  }
}

/**
 * Post a review comment on the PR with the judge verdict.
 */
async function postJudgeComment(prNumber, verdict, reason) {
  const icon   = verdict === "PASS" ? "✅" : "❌";
  const body   = `### SOVEREIGN-GENESIS AI Review\n\n${icon} **Verdict: ${verdict}**\n\n> ${reason}`;
  try {
    await octokit.issues.createComment({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      issue_number: prNumber,
      body,
    });
  } catch (err) {
    logger.warn(`Executor: could not post review comment — ${err.message}`);
  }
}

module.exports = { executeApprovedPr, releaseExternallyMergedPr, postJudgeComment, buildPrId };
