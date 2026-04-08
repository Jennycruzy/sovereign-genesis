/**
 * executor.js — Auto-Merge + Bounty Release
 *
 * After the Judge issues a PASS verdict:
 *   1. Merge the PR via GitHub API
 *   2. Resolve the contributor's wallet address from a PR comment or label
 *   3. Call releaseBounty() on-chain
 */
const { Octokit } = require("@octokit/rest");
const contract = require("./contract");
const logger = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split(
  "/"
);

/**
 * Attempt to extract a wallet address from PR comments.
 * Convention: contributor posts a comment containing:
 *   Wallet: 0xABCDEF...
 */
async function resolveContributorWallet(prNumber) {
  const { data: comments } = await octokit.issues.listComments({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    issue_number: prNumber,
    per_page: 100,
  });

  for (const comment of comments.reverse()) {
    const match = comment.body?.match(/wallet[:\s]+(0x[a-fA-F0-9]{40})/i);
    if (match) return match[1];
  }

  // Fall back to the PR description
  const { data: pr } = await octokit.pulls.get({
    owner: REPO_OWNER,
    repo: REPO_NAME,
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
 * Merge a PR and release its bounty.
 *
 * @param {number} prNumber
 * @returns {{ merged: boolean, txHash: string | null, error: string | null }}
 */
async function executeApprovedPr(prNumber) {
  const prId = buildPrId(prNumber);
  logger.info(`Executor: processing approved PR #${prNumber} (${prId})`);

  // ── 1. Merge the PR ───────────────────────────────────────────────────────
  try {
    const { data: mergeResult } = await octokit.pulls.merge({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      pull_number: prNumber,
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

  // ── 2. Resolve contributor wallet ─────────────────────────────────────────
  const wallet = await resolveContributorWallet(prNumber);
  if (!wallet) {
    logger.warn(
      `Executor: PR #${prNumber} merged but no wallet address found. ` +
        "Bounty NOT released. Contributor must claim manually."
    );
    return { merged: true, txHash: null, error: "No contributor wallet found" };
  }

  // ── 3. Release bounty on-chain ────────────────────────────────────────────
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
 * Post a review comment on the PR with the judge verdict.
 */
async function postJudgeComment(prNumber, verdict, reason) {
  const icon = verdict === "PASS" ? "✅" : "❌";
  const body = `### SOVEREIGN-GENESIS AI Review\n\n${icon} **Verdict: ${verdict}**\n\n> ${reason}`;
  try {
    await octokit.issues.createComment({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      issue_number: prNumber,
      body,
    });
  } catch (err) {
    logger.warn(`Executor: could not post review comment — ${err.message}`);
  }
}

module.exports = { executeApprovedPr, postJudgeComment, buildPrId };
