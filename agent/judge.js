/**
 * judge.js — AI Judge System
 *
 * Reviews a GitHub PR using:
 *   1. GitHub CI status check
 *   2. LLM diff analysis (OpenAI-compatible endpoint)
 *
 * Returns: { verdict: "PASS" | "FAIL", reason: string }
 *
 * Enhanced logging provides:
 *   - ISO-8601 timestamps on every log entry
 *   - Per-step timing (CI, diff fetch, LLM review)
 *   - LLM token usage metrics (prompt tokens, completion tokens, total)
 *   - Full error context with stack traces and metadata
 *   - Structured review metrics exported for observability
 */
const { Octokit } = require("@octokit/rest");
const OpenAI      = require("openai");
const logger      = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

/**
 * Review metrics accumulated over a review session.
 * Exported so callers can inspect per-review statistics.
 */
const createMetrics = () => ({
  prNumber:       null,
  startedAt:      null,  // Date
  ciDurationMs:   null,  // CI check duration
  diffDurationMs: null,  // Diff fetch duration
  llmDurationMs:  null,  // LLM review duration
  totalDurationMs: null, // Total end-to-end duration
  promptTokens:   null,
  completionTokens: null,
  totalTokens:    null,
  model:          null,
  verdict:        null,
  ciChecksCount:  0,
  llmRetries:     0,
});

let metrics = createMetrics();

// ── CI status check ───────────────────────────────────────────────────────────

/**
 * Fetch the combined CI status for the PR head commit.
 * Returns true if all required checks pass.
 * All errors are caught and logged with full context.
 */
async function ciPasses(prNumber) {
  const stepStart = Date.now();
  let sha;
  try {
    const { data: pr } = await octokit.pulls.get({
      owner:       REPO_OWNER,
      repo:        REPO_NAME,
      pull_number: prNumber,
    });
    sha = pr.head.sha;
    logger.info(`[${new Date().toISOString()}] Judge: fetched PR #${prNumber}, head SHA: ${sha}`);
  } catch (err) {
    logger.error(`[${new Date().toISOString()}] Judge: failed to fetch PR #${prNumber} details — ${err.message} (${err.status})`, {
      stack: err.stack,
      prNumber,
      status: err.status,
      requestId: err.headers?.["x-github-request-id"],
    });
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
    logger.info(
      `[${new Date().toISOString()}] Judge: combined status for SHA ${sha}: "${status.state}" ` +
      `(${status.total_count} checks, ${status.branch?.name || "unknown" branch})`
    );
  } catch (err) {
    logger.error(`[${new Date().toISOString()}] Judge: failed to get combined status for SHA ${sha} — ${err.message} (${err.status})`, {
      stack: err.stack,
      sha,
      status: err.status,
    });
    throw err;
  }

  if (status.state === "failure" || status.state === "error") {
    logger.warn(`[${new Date().toISOString()}] Judge: CI status is "${status.state}" for PR #${prNumber} (SHA: ${sha})`);
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
    metrics.ciChecksCount = checks.check_runs.length;
    logger.info(
      `[${new Date().toISOString()}] Judge: fetched ${checks.check_runs.length} check runs for PR #${prNumber}`
    );
  } catch (err) {
    logger.error(`[${new Date().toISOString()}] Judge: failed to list check runs for SHA ${sha} — ${err.message} (${err.status})`, {
      stack: err.stack,
      sha,
      status: err.status,
    });
    throw err;
  }

  try {
    for (const run of checks.check_runs) {
      if (run.status !== "completed") {
        logger.warn(
          `[${new Date().toISOString()}] Judge: check "${run.name}" (id: ${run.id}, ` +
          `status: ${run.status}) not completed yet for PR #${prNumber}`
        );
        return false;
      }
      if (run.conclusion === "failure" || run.conclusion === "cancelled") {
        logger.warn(
          `[${new Date().toISOString()}] Judge: check "${run.name}" (id: ${run.id}) ` +
          `concluded "${run.conclusion}" for PR #${prNumber}`
        );
        return false;
      }
    }
  } catch (err) {
    logger.error(`[${new Date().toISOString()}] Judge: failed to iterate check runs for PR #${prNumber} — ${err.message}`, {
      stack: err.stack,
      sha,
      checkRunsCount: checks.check_runs.length,
    });
    throw err;
  }

  const stepDuration = Date.now() - stepStart;
  metrics.ciDurationMs = stepDuration;
  logger.info(
    `[${new Date().toISOString()}] Judge: all CI checks passed for PR #${prNumber} ` +
    `(${checks.check_runs.length} runs, ${stepDuration}ms)`
  );
  return true;
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

async function getPrDiff(prNumber) {
  const stepStart = Date.now();
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
    const stepDuration = Date.now() - stepStart;
    metrics.diffDurationMs = stepDuration;
    logger.info(
      `[${new Date().toISOString()}] Judge: fetched diff for PR #${prNumber} ` +
      `(${diff.length} chars, ${stepDuration}ms)`
    );
    return diff;
  } catch (err) {
    logger.error(`[${new Date().toISOString()}] Judge: failed to fetch diff for PR #${prNumber} — ${err.message} (${err.status})`, {
      stack: err.stack,
      prNumber,
      status: err.status,
    });
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
  const stepStart = Date.now();
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  metrics.model = model;

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
      model,
      temperature: 0,
      max_tokens:  256,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
    });
    const stepDuration = Date.now() - stepStart;
    metrics.llmDurationMs = stepDuration;

    // Extract token usage if available
    const usage = completion.usage;
    if (usage) {
      metrics.promptTokens     = usage.prompt_tokens;
      metrics.completionTokens = usage.completion_tokens;
      metrics.totalTokens      = usage.total_tokens;
      logger.info(
        `[${new Date().toISOString()}] Judge: LLM responded for PR #${prNumber}, ` +
        `model=${model}, tokens=(${usage.prompt_tokens} + ${usage.completion_tokens} = ${usage.total_tokens}), ` +
        `duration=${stepDuration}ms`
      );
    } else {
      logger.info(
        `[${new Date().toISOString()}] Judge: LLM responded for PR #${prNumber}, ` +
        `model=${model}, duration=${stepDuration}ms (no usage data)`
      );
    }
  } catch (err) {
    const stepDuration = Date.now() - stepStart;
    const detail = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.error(
      `[${new Date().toISOString()}] Judge: LLM API call failed for PR #${prNumber} ` +
      `after ${stepDuration}ms — ${detail}`,
      {
        stack: err.stack,
        prNumber,
        model,
        durationMs: stepDuration,
        errorResponse: err?.response?.data,
      }
    );
    return { verdict: "FAIL", reason: `LLM API error: ${err.message}` };
  }

  if (!completion.choices || completion.choices.length === 0) {
    logger.error(`[${new Date().toISOString()}] Judge: LLM returned empty choices for PR #${prNumber}`);
    return { verdict: "FAIL", reason: "LLM returned no choices" };
  }

  const raw = completion.choices[0].message.content.trim();

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    logger.error(
      `[${new Date().toISOString()}] Judge: LLM returned non-JSON for PR #${prNumber}: "${raw.slice(0, 200)}"`,
      {
        stack: parseErr.stack,
        rawLength: raw.length,
        model,
        prTitle,
      }
    );
    return { verdict: "FAIL", reason: "LLM returned unparseable response" };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full review pipeline for a PR.
 * @param {number} prNumber
 * @returns {{ verdict: "PASS"|"FAIL", reason: string, ciOk: boolean, metrics: object }}
 */
async function reviewPr(prNumber) {
  // Reset metrics for this review
  metrics = createMetrics();
  metrics.prNumber = prNumber;
  metrics.startedAt = new Date().toISOString();
  const overallStart = Date.now();

  logger.info(
    `[${new Date().toISOString()}] Judge: starting review pipeline for PR #${prNumber}`
  );

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  } catch (err) {
    metrics.totalDurationMs = Date.now() - overallStart;
    logger.error(
      `[${new Date().toISOString()}] Judge: CI check error for PR #${prNumber} — ${err.message}`,
      {
        stack: err.stack,
        prNumber,
        ciDurationMs: metrics.ciDurationMs,
        totalDurationMs: metrics.totalDurationMs,
      }
    );
    return {
      verdict: "FAIL",
      reason: `CI check error: ${err.message}`,
      ciOk: false,
      metrics: { ...metrics },
    };
  }

  if (!ciOk) {
    metrics.totalDurationMs = Date.now() - overallStart;
    logger.warn(
      `[${new Date().toISOString()}] Judge: CI checks did not pass for PR #${prNumber} ` +
      `(${metrics.ciChecksCount} runs, ${metrics.ciDurationMs}ms)`
    );
    return {
      verdict: "FAIL",
      reason: "CI checks did not pass",
      ciOk: false,
      metrics: { ...metrics },
    };
  }

  // Step 2 — LLM diff review
  let diff, pr;
  try {
    [diff, { data: pr }] = await Promise.all([
      getPrDiff(prNumber),
      octokit.pulls.get({ owner: REPO_OWNER, repo: REPO_NAME, pull_number: prNumber }),
    ]);
  } catch (err) {
    metrics.totalDurationMs = Date.now() - overallStart;
    logger.error(
      `[${new Date().toISOString()}] Judge: failed to fetch PR data for PR #${prNumber} — ${err.message}`,
      {
        stack: err.stack,
        prNumber,
        ciDurationMs: metrics.ciDurationMs,
        diffDurationMs: metrics.diffDurationMs,
        totalDurationMs: metrics.totalDurationMs,
      }
    );
    return {
      verdict: "FAIL",
      reason: `Failed to fetch PR: ${err.message}`,
      ciOk,
      metrics: { ...metrics },
    };
  }

  let result;
  try {
    result = await llmReview(prNumber, pr.title, pr.body, diff);
  } catch (err) {
    metrics.totalDurationMs = Date.now() - overallStart;
    logger.error(
      `[${new Date().toISOString()}] Judge: llmReview threw unhandled error for PR #${prNumber} — ${err.message}`,
      {
        stack: err.stack,
        prNumber,
        prTitle: pr.title,
        ciDurationMs: metrics.ciDurationMs,
        diffDurationMs: metrics.diffDurationMs,
        llmDurationMs: metrics.llmDurationMs,
        totalDurationMs: metrics.totalDurationMs,
      }
    );
    return {
      verdict: "FAIL",
      reason: `LLM review threw: ${err.message}`,
      ciOk,
      metrics: { ...metrics },
    };
  }

  metrics.totalDurationMs = Date.now() - overallStart;
  metrics.verdict = result.verdict;

  logger.info(
    `[${new Date().toISOString()}] Judge: PR #${prNumber} verdict = ${result.verdict} — ${result.reason} ` +
    `(ci=${metrics.ciDurationMs}ms, diff=${metrics.diffDurationMs}ms, llm=${metrics.llmDurationMs}ms, total=${metrics.totalDurationMs}ms)`
  );

  return { ...result, ciOk, metrics: { ...metrics } };
}

module.exports = { reviewPr };
