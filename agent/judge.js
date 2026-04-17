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

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// ── CI status check ───────────────────────────────────────────────────────────

/**
 * Fetch the combined CI status for the PR head commit.
 * Returns true if all required checks pass.
 */
async function ciPasses(prNumber) {
  const startTime = Date.now();
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
    logger.warn(`Judge: CI status is "${status.state}" for PR #${prNumber} (Duration: ${Date.now() - startTime}ms)`);
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
      logger.warn(`Judge: check "${run.name}" failed for PR #${prNumber} | Conclusion: ${run.conclusion}`);
      return false;
    }
  }

  const duration = Date.now() - startTime;
  logger.info(`Judge: CI checks passed for PR #${prNumber} | Checks Count: ${checks.total_count} | Duration: ${duration}ms`);
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
  const startTime = Date.now();
  const userMessage = `
PR #${prNumber}: ${prTitle}

Description:
${prBody || "(none)"}

Diff (truncated to 8000 chars):
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model:       process.env.OPENAI_MODEL || "gpt-4o",
      temperature: 0,
      max_tokens:  256,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    const duration = Date.now() - startTime;
    const tokens = completion.usage?.total_tokens || 0;

    try {
      const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      const result = JSON.parse(jsonStr);
      logger.info(`Judge: LLM review complete for PR #${prNumber} | Tokens: ${tokens} | Duration: ${duration}ms | Verdict: ${result.verdict}`);
      return result;
    } catch (parseErr) {
      logger.error(`Judge: LLM returned non-JSON for PR #${prNumber} | Duration: ${duration}ms | Error: ${parseErr.message} | Raw: ${raw}`);
      return { verdict: "FAIL", reason: "LLM returned unparseable response" };
    }
  } catch (apiErr) {
    logger.error(`Judge: OpenAI API error for PR #${prNumber} | Error: ${apiErr.message}`);
    throw apiErr;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full review pipeline for a PR.
 * @param {number} prNumber
 * @returns {{ verdict: "PASS"|"FAIL", reason: string, ciOk: boolean }}
 */
async function reviewPr(prNumber) {
  const startTime = Date.now();
  logger.info(`Judge: starting full review pipeline for PR #${prNumber}`);

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  } catch (err) {
    logger.error(`Judge: CI check error for PR #${prNumber} — ${err.message} | Stack: ${err.stack}`);
    return { verdict: "FAIL", reason: `CI check error: ${err.message}`, ciOk: false };
  }

  if (!ciOk) {
    logger.warn(`Judge: PR #${prNumber} review aborted: CI failed | Total Duration: ${Date.now() - startTime}ms`);
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
    logger.error(`Judge: failed to fetch PR data for PR #${prNumber} — ${err.message}`);
    return { verdict: "FAIL", reason: `Failed to fetch PR: ${err.message}`, ciOk };
  }

  try {
    const result = await llmReview(prNumber, pr.title, pr.body, diff);
    const totalDuration = Date.now() - startTime;
    logger.info(`Judge: Final verdict for PR #${prNumber} = ${result.verdict} | Reason: ${result.reason} | Total Duration: ${totalDuration}ms`);
    return { ...result, ciOk };
  } catch (err) {
    logger.error(`Judge: Critical error in LLM review for PR #${prNumber} — ${err.message}`);
    return { verdict: "FAIL", reason: `Review failed: ${err.message}`, ciOk };
  }
}

module.exports = { reviewPr };
