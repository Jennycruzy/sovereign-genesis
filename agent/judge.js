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
const { logError } = require("./logger");

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
      pull_number:  prNumber,
    });
    sha = pr.head.sha;
  } catch (err) {
    logError("judge", "fetch_pr_for_ci", err, { prNumber });
    throw err;
  }

  // Check "commit statuses" (older CI integration)
  try {
    const { data: status } = await octokit.repos.getCombinedStatusForRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   sha,
    });

    if (status.state === "failure" || status.state === "error") {
      logger.warn("Judge: CI status check failed", {
        prNumber,
        sha: sha.substring(0, 8),
        statusState: status.state,
        totalStatuses: status.total_count,
      });
      return false;
    }
  } catch (err) {
    logError("judge", "check_commit_status", err, { prNumber, sha: sha.substring(0, 8) });
    throw err;
  }

  // Also check "check runs" (GitHub Actions)
  try {
    const { data: checks } = await octokit.checks.listForRef({
      owner:  REPO_OWNER,
      repo:   REPO_NAME,
      ref:    sha,
      filter: "latest",
    });

    for (const run of checks.check_runs) {
      if (run.status !== "completed") {
        logger.warn("Judge: check run not completed", {
          prNumber,
          checkName: run.name,
          checkStatus: run.status,
          checkConclusion: run.conclusion,
        });
        return false;
      }
      if (run.conclusion === "failure" || run.conclusion === "cancelled") {
        logger.warn("Judge: check run failed", {
          prNumber,
          checkName: run.name,
          checkConclusion: run.conclusion,
        });
        return false;
      }
    }
  } catch (err) {
    logError("judge", "check_github_actions", err, { prNumber, sha: sha.substring(0, 8) });
    throw err;
  }

  logger.info("Judge: CI checks passed", { prNumber, sha: sha.substring(0, 8) });
  return true;
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

async function getPrDiff(prNumber) {
  try {
    const { data } = await octokit.pulls.get({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      pull_number:  prNumber,
      mediaType:    { format: "diff" },
    });
    const diff = typeof data === "string" ? data : JSON.stringify(data);
    logger.info("Judge: fetched PR diff", {
      prNumber,
      diffLength: diff.length,
    });
    return diff;
  } catch (err) {
    logError("judge", "fetch_pr_diff", err, { prNumber });
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
  const truncatedDiff = diff.slice(0, 8000);
  const wasTruncated = diff.length > 8000;

  if (wasTruncated) {
    logger.warn("Judge: PR diff truncated for LLM review", {
      prNumber,
      originalLength: diff.length,
      truncatedLength: truncatedDiff.length,
    });
  }

  const userMessage = `
PR #${prNumber}: ${prTitle}

Description:
${prBody || "(none)"}

Diff (truncated to 8000 chars):
\`\`\`diff
${truncatedDiff}
\`\`\`
`.trim();

  let completion;
  try {
    const startTime = Date.now();
    completion = await openai.chat.completions.create({
      model:       process.env.OPENAI_MODEL || "gpt-4o",
      temperature: 0,
      max_tokens:  256,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
    });
    const elapsed = Date.now() - startTime;

    logger.info("Judge: LLM review completed", {
      prNumber,
      model: process.env.OPENAI_MODEL || "gpt-4o",
      elapsedMs: elapsed,
      tokensUsed: completion.usage ? completion.usage.total_tokens : null,
    });
  } catch (err) {
    logError("judge", "llm_api_call", err, {
      prNumber,
      model: process.env.OPENAI_MODEL || "gpt-4o",
    });
    return { verdict: "FAIL", reason: `LLM API error: ${err.message}` };
  }

  const raw = completion.choices[0].message.content.trim();

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const result = JSON.parse(jsonStr);
    logger.info("Judge: LLM verdict parsed", {
      prNumber,
      verdict: result.verdict,
      reason: result.reason,
    });
    return result;
  } catch (parseErr) {
    logError("judge", "parse_llm_response", parseErr, {
      prNumber,
      rawResponse: raw.substring(0, 200),
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
  logger.info("Judge: starting PR review", { prNumber });

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  } catch (err) {
    logError("judge", "ci_check_pipeline", err, { prNumber });
    return { verdict: "FAIL", reason: `CI check error: ${err.message}`, ciOk: false };
  }

  if (!ciOk) {
    logger.warn("Judge: CI checks did not pass, skipping LLM review", { prNumber });
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
    logError("judge", "fetch_pr_data", err, { prNumber });
    return { verdict: "FAIL", reason: `Failed to fetch PR: ${err.message}`, ciOk };
  }

  const result = await llmReview(prNumber, pr.title, pr.body, diff);
  logger.info("Judge: PR review complete", {
    prNumber,
    verdict: result.verdict,
    reason: result.reason,
    ciOk,
  });

  return { ...result, ciOk };
}

module.exports = { reviewPr };