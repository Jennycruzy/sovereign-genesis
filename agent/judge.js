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
  let sha;
  try {
    const { data: pr } = await octokit.pulls.get({
      owner:       REPO_OWNER,
      repo:        REPO_NAME,
      pull_number: prNumber,
    });
    sha = pr.head.sha;
  } catch (err) {
    logger.error(`Judge: failed to fetch PR #${prNumber} metadata — ${err.message}`);
    throw err;
  }

  // Check "commit statuses" (older CI integration)
  let statusState;
  try {
    const { data: status } = await octokit.repos.getCombinedStatusForRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   sha,
    });
    statusState = status.state;

    if (status.state === "failure" || status.state === "error") {
      logger.warn(`Judge: CI status is "${status.state}" for PR #${prNumber}`);
      return false;
    }
  } catch (err) {
    logger.error(`Judge: failed to fetch combined CI status for PR #${prNumber} — ${err.message}`);
    throw err;
  }

  // Also check "check runs" (GitHub Actions)
  let checks;
  try {
    const { data } = await octokit.checks.listForRef({
      owner:  REPO_OWNER,
      repo:   REPO_NAME,
      ref:    sha,
      filter: "latest",
    });
    checks = data.check_runs;
  } catch (err) {
    logger.error(`Judge: failed to fetch check runs for PR #${prNumber} (SHA ${sha}) — ${err.message}`);
    throw err;
  }

  for (const run of checks) {
    if (run.status !== "completed") {
      logger.warn(`Judge: check "${run.name}" not completed yet (PR #${prNumber})`);
      return false;
    }
    if (run.conclusion === "failure" || run.conclusion === "cancelled") {
      logger.warn(`Judge: check "${run.name}" failed for PR #${prNumber} (conclusion: ${run.conclusion})`);
      return false;
    }
  }

  return true;
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

async function getPrDiff(prNumber) {
  let data;
  try {
    const response = await octokit.pulls.get({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      pull_number:  prNumber,
      mediaType:    { format: "diff" },
    });
    data = response.data;
  } catch (err) {
    logger.error(`Judge: failed to fetch diff for PR #${prNumber} — ${err.message} (status: ${err.status})`);
    throw err;
  }
  if (data === undefined || data === null) {
    const msg = `Judge: empty response from GitHub API for PR #${prNumber} diff`;
    logger.error(msg);
    throw new Error(msg);
  }
  // When requesting diff media type, data is a string
  const diff = typeof data === "string" ? data : JSON.stringify(data);
  logger.info(`Judge: fetched diff for PR #${prNumber} (${diff.length} chars)`);
  return diff;
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

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model:       process.env.OPENAI_MODEL || "gpt-4o",
      temperature: 0,
      max_tokens:  256,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
    });
  } catch (err) {
    logger.error(`Judge: LLM API call failed for PR #${prNumber} — ${err.message}`);
    return { verdict: "FAIL", reason: `LLM API error: ${err.message}` };
  }

  const raw = completion.choices[0].message.content.trim();

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    logger.error(`Judge: LLM returned non-JSON for PR #${prNumber} (parse error: ${parseErr.message}) — raw response: ${raw.slice(0, 200)}`);
    return { verdict: "FAIL", reason: `LLM returned unparseable response: ${parseErr.message}` };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full review pipeline for a PR.
 * @param {number} prNumber
 * @returns {{ verdict: "PASS"|"FAIL", reason: string, ciOk: boolean }}
 */
async function reviewPr(prNumber) {
  logger.info(`Judge: reviewing PR #${prNumber}`);

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  } catch (err) {
    logger.error(`Judge: CI check threw for PR #${prNumber} — ${err.message}`);
    return {
      verdict: "FAIL",
      reason:  `CI check error: ${err.message}`,
      ciOk:    false,
    };
  }

  if (!ciOk) {
    return { verdict: "FAIL", reason: "CI checks did not pass", ciOk: false };
  }

  // Step 2 — LLM diff review
  let diff, pr;
  try {
    [diff, { data: pr }] = await Promise.all([
      getPrDiff(prNumber).catch((err) => {
        throw new Error(`getPrDiff failed: ${err.message}`);
      }),
      octokit.pulls.get({ owner: REPO_OWNER, repo: REPO_NAME, pull_number: prNumber }),
    ]);
  } catch (err) {
    logger.error(`Judge: failed to fetch PR #${prNumber} data — ${err.message}`);
    return {
      verdict: "FAIL",
      reason:  `Failed to fetch PR diff: ${err.message}`,
      ciOk,
    };
  }

  const result = await llmReview(prNumber, pr.title, pr.body, diff);

  if (result.verdict === "PASS") {
    logger.info(`Judge: PR #${prNumber} PASS — ${result.reason}`);
  } else {
    logger.warn(`Judge: PR #${prNumber} FAIL — ${result.reason}`);
  }

  return { ...result, ciOk };
}

module.exports = { reviewPr };

// ── Unhandled exception / rejection guards ────────────────────────────────────
process.on("uncaughtException", (err) => {
  logger.error(`Judge: uncaughtException — ${err.message}\n${err.stack}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  const reasonStr = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  logger.error(`Judge: unhandledRejection at promise ${promise} — ${reasonStr}`);
});
