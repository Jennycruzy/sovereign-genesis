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
 * All errors are caught and logged with full context.
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
    logger.info(`Judge: fetched PR #${prNumber}, head SHA: ${sha}`);
  } catch (err) {
    logger.error(`Judge: failed to fetch PR #${prNumber} details — ${err.message} (${err.status})`);
    throw err;
  }

  // Check "commit statuses" (older CI integration)
  let status;
  try {
    const { data } = await octokit.repos.getCombinedStatusForRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   sha,
    });
    status = data;
    logger.info(`Judge: combined status for SHA ${sha}: "${status.state}" (${status.total_count} checks)`);
  } catch (err) {
    logger.error(`Judge: failed to get combined status for SHA ${sha} — ${err.message} (${err.status})`);
    throw err;
  }

  if (status.state === "failure" || status.state === "error") {
    logger.warn(`Judge: CI status is "${status.state}" for PR #${prNumber} (SHA: ${sha})`);
    return false;
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
    checks = data;
    logger.info(`Judge: fetched ${checks.check_runs.length} check runs for PR #${prNumber}`);
  } catch (err) {
    logger.error(`Judge: failed to list check runs for SHA ${sha} — ${err.message} (${err.status})`);
    throw err;
  }

  try {
    for (const run of checks.check_runs) {
      if (run.status !== "completed") {
        logger.warn(`Judge: check "${run.name}" (id: ${run.id}) not completed yet for PR #${prNumber}`);
        return false;
      }
      if (run.conclusion === "failure" || run.conclusion === "cancelled") {
        logger.warn(`Judge: check "${run.name}" (id: ${run.id}) concluded "${run.conclusion}" for PR #${prNumber}`);
        return false;
      }
    }
  } catch (err) {
    logger.error(`Judge: failed to iterate check runs for PR #${prNumber} — ${err.message}`, {
      stack: err.stack,
      sha,
      checkRunsCount: checks.check_runs.length,
    });
    throw err;
  }

  logger.info(`Judge: all CI checks passed for PR #${prNumber}`);
  return true;
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

async function getPrDiff(prNumber) {
  let diff;
  try {
    const { data } = await octokit.pulls.get({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      pull_number:  prNumber,
      mediaType:    { format: "diff" },
    });
    // When requesting diff media type, data is a string
    diff = typeof data === "string" ? data : JSON.stringify(data);
    logger.info(`Judge: fetched diff for PR #${prNumber} (${diff.length} chars)`);
    return diff;
  } catch (err) {
    logger.error(`Judge: failed to fetch diff for PR #${prNumber} — ${err.message} (${err.status})`);
    throw err;
  }
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
    logger.info(`Judge: LLM responded for PR #${prNumber}, model: ${process.env.OPENAI_MODEL || "gpt-4o"}`);
  } catch (err) {
    const detail = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.error(`Judge: LLM API call failed for PR #${prNumber} — ${detail}`);
    return { verdict: "FAIL", reason: `LLM API error: ${err.message}` };
  }

  if (!completion.choices || completion.choices.length === 0) {
    logger.error(`Judge: LLM returned empty choices for PR #${prNumber}`);
    return { verdict: "FAIL", reason: "LLM returned no choices" };
  }

  const raw = completion.choices[0].message.content.trim();

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    logger.error(`Judge: LLM returned non-JSON for PR #${prNumber}: "${raw.slice(0, 200)}"`, {
      stack: parseErr.stack,
    });
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
  logger.info(`Judge: reviewing PR #${prNumber}`);

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  } catch (err) {
    logger.error(`Judge: CI check error — ${err.message}`);
    return { verdict: "FAIL", reason: `CI check error: ${err.message}`, ciOk: false };
  }

  if (!ciOk) {
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
    return { verdict: "FAIL", reason: `Failed to fetch PR: ${err.message}`, ciOk };
  }

  let result;
  try {
    result = await llmReview(prNumber, pr.title, pr.body, diff);
  } catch (err) {
    logger.error(`Judge: llmReview threw unhandled error for PR #${prNumber} — ${err.message}`, {
      stack: err.stack,
      prTitle: pr.title,
      diffLength: diff.length,
    });
    return { verdict: "FAIL", reason: `LLM review threw: ${err.message}`, ciOk };
  }
  logger.info(`Judge: PR #${prNumber} verdict = ${result.verdict} — ${result.reason}`);

  return { ...result, ciOk };
}

module.exports = { reviewPr };
