/**
 * judge.js — AI Judge System
 *
 * Reviews a GitHub PR using:
 *   1. GitHub CI status check
 *   2. LLM diff analysis (OpenAI-compatible endpoint)
 *
 * Returns: { verdict: "PASS" | "FAIL", reason: string }
 */
const { Octokit } = require("@octokit/rest");
const OpenAI      = require("openai");
const logger      = require("./logger");
const {
  logAIReviewError,
  logReviewStart,
  logCiResult,
  logCiError,
  logLlmReviewRequest,
  logLlmReviewResult,
  logLlmReviewError,
  logReviewComplete,
} = require("./log-utils");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// ── CI status check ───────────────────────────────────────────────────────────

/**
 * Fetch the combined CI status for the PR head commit.
 * Returns true if all required checks pass.
 */
async function ciPasses(prNumber) {
  const { data: pr } = await octokit.pulls.get({
    owner:       REPO_OWNER,
    repo:        REPO_NAME,
    pull_number: prNumber,
  });

  const sha = pr.head.sha;

  // Check "commit statuses" (older CI integration)
  const { data: status } = await octokit.repos.getCombinedStatusForRef({
    owner: REPO_OWNER,
    repo:  REPO_NAME,
    ref:   sha,
  });

  if (status.state === "failure" || status.state === "error") {
    logger.warn(`Judge: CI status is "${status.state}" for PR #${prNumber}`);
    return false;
  }

  // Also check "check runs" (GitHub Actions)
  const { data: checks } = await octokit.checks.listForRef({
    owner:  REPO_OWNER,
    repo:   REPO_NAME,
    ref:    sha,
    filter: "latest",
  });

  for (const run of checks.check_runs) {
    if (run.status !== "completed") {
      logger.warn(`Judge: check "${run.name}" not completed yet (PR #${prNumber})`);
      return false;
    }
    if (run.conclusion === "failure" || run.conclusion === "cancelled") {
      logger.warn(`Judge: check "${run.name}" failed for PR #${prNumber}`);
      return false;
    }
  }

  return true;
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

async function getPrDiff(prNumber) {
  const { data } = await octokit.pulls.get({
    owner:        REPO_OWNER,
    repo:         REPO_NAME,
    pull_number:  prNumber,
    mediaType:    { format: "diff" },
  });
  // When requesting diff media type, data is a string
  return typeof data === "string" ? data : JSON.stringify(data);
}

// ── LLM analysis ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior security-aware code reviewer for an autonomous AI treasury agent.
You must review the provided git diff and return a strict JSON verdict.

Rules:
- Return ONLY valid JSON: { "verdict": "PASS" | "FAIL", "reason": "..." }
- FAIL if: hardcoded secrets, API keys, private keys, or passwords are present
- FAIL if: unit tests are missing or clearly broken
- FAIL if: reentrancy vulnerabilities exist in Solidity
- FAIL if: the diff introduces obvious logic errors or backdoors
- FAIL if: bounty requirements from the PR description are not implemented
- PASS if: the code looks correct, tests exist, and no security issues are found
- reason must be a concise single sentence`;

async function llmReview(prNumber, prTitle, prBody, diff) {
  const userMessage = `
PR #${prNumber}: ${prTitle}

Description:
${prBody || "(none)"}

Diff (truncated to 8000 chars):
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`
`.trim();

  logLlmReviewRequest(prNumber, {
    model: process.env.OPENAI_MODEL || "gpt-4o",
    diffLength: diff.length,
  });

  const startMs = Date.now();
  const completion = await openai.chat.completions.create({
    model:       process.env.OPENAI_MODEL || "gpt-4o",
    temperature: 0,
    max_tokens:  256,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
  });
  const durationMs = Date.now() - startMs;

  const raw = completion.choices[0].message.content.trim();

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed  = JSON.parse(jsonStr);
    logLlmReviewResult(prNumber, parsed.verdict, {
      reason:     parsed.reason,
      raw,
      durationMs,
    });
    return parsed;
  } catch (err) {
    // Legacy helper kept for compatibility
    logAIReviewError(prNumber, err, raw);
    logLlmReviewError(prNumber, err);
    return { verdict: "FAIL", reason: "LLM returned unparseable response" };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full review pipeline for a PR.
 * @param {number} prNumber
 * @returns {{ verdict: "PASS"|"FAIL", reason: string, ciOk: boolean }}
 */
async function reviewPr(prNumber) {
  const totalStartMs = Date.now();
  logger.info(`Judge: reviewing PR #${prNumber}`);

  // Step 1 — CI
  let ciOk = false;
  let ciStartMs;
  try {
    ciStartMs = Date.now();
    ciOk = await ciPasses(prNumber);
    const ciDurationMs = Date.now() - ciStartMs;

    // Fetch PR details for logging metadata
    let prData;
    try {
      const { data } = await octokit.pulls.get({
        owner: REPO_OWNER, repo: REPO_NAME, pull_number: prNumber,
      });
      prData = data;
    } catch {
      prData = {};
    }

    logCiResult(prNumber, ciOk, {
      statusState: null,
      checkRuns:   [],
      durationMs:   ciDurationMs,
    });
  } catch (err) {
    logCiError(prNumber, err);
    logger.error(`Judge: CI check error — ${err.message}`);
    return {
      verdict: "FAIL",
      reason:  `CI check error: ${err.message}`,
      ciOk:    false,
    };
  }

  if (!ciOk) {
    logReviewComplete(prNumber, {
      verdict:         "FAIL",
      ciOk:            false,
      reason:          "CI checks did not pass",
      totalDurationMs: Date.now() - totalStartMs,
    });
    return { verdict: "FAIL", reason: "CI checks did not pass", ciOk: false };
  }

  // Step 2 — LLM diff review
  let diff, pr;
  try {
    [diff, { data: pr }] = await Promise.all([
      getPrDiff(prNumber),
      octokit.pulls.get({ owner: REPO_OWNER, repo: REPO_NAME, pull_number: prNumber }),
    ]);
  } catch (err) {
    logger.error(`Judge: failed to fetch PR data — ${err.message}`);
    return {
      verdict: "FAIL",
      reason:  `Failed to fetch PR: ${err.message}`,
      ciOk,
    };
  }

  // Log review start with rich metadata
  logReviewStart(prNumber, {
    prTitle:    pr.title,
    author:     pr.user?.login,
    headSha:    pr.head?.sha,
    baseBranch: pr.base?.ref,
  });

  const result = await llmReview(prNumber, pr.title, pr.body, diff);
  const llmDurationMs = null; // captured inside llmReview

  logger.info(
    `Judge: PR #${prNumber} verdict = ${result.verdict} — ${result.reason}`
  );

  logReviewComplete(prNumber, {
    verdict:         result.verdict,
    ciOk:            true,
    reason:          result.reason,
    totalDurationMs: Date.now() - totalStartMs,
  });

  return { ...result, ciOk };
}

module.exports = { reviewPr };
