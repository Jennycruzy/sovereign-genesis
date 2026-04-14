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
const { generateCorrelationId } = logger;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// ── CI status check ───────────────────────────────────────────────────────────

/**
 * Fetch the combined CI status for the PR head commit.
 * Returns true if all required checks pass.
 */
async function ciPasses(prNumber) {
  const corrId = generateCorrelationId();
  logger.logInfo("Judge: starting CI check", {
    prNumber,
    correlationId: corrId,
    operation: "ciPasses",
  });

  let sha;
  try {
    const { data: pr } = await octokit.pulls.get({
      owner:       REPO_OWNER,
      repo:        REPO_NAME,
      pull_number: prNumber,
    });
    sha = pr.head.sha;
  } catch (err) {
    logger.logError("Judge: failed to fetch PR for CI check", err, {
      prNumber,
      correlationId: corrId,
      operation: "ciPasses.fetchPR",
      statusCode: err.status,
    });
    throw new Error(`Failed to fetch PR #${prNumber} for CI check: ${err.message}`);
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
      // Collect failed status details
      const failures = (status.statuses || [])
        .filter((s) => s.state === "failure" || s.state === "error")
        .map((s) => `${s.context}: ${s.description || s.state}`);

      logger.logWarn("Judge: CI commit status failure", {
        prNumber,
        sha,
        correlationId: corrId,
        operation: "ciPasses.commitStatus",
        statusState: status.state,
        failedChecks: failures,
      });
      return false;
    }
  } catch (err) {
    logger.logError("Judge: failed to fetch commit status", err, {
      prNumber,
      sha,
      correlationId: corrId,
      operation: "ciPasses.commitStatus",
      statusCode: err.status,
    });
    throw new Error(`Failed to fetch CI status for PR #${prNumber}: ${err.message}`);
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
        logger.logWarn("Judge: check run not completed", {
          prNumber,
          sha,
          correlationId: corrId,
          operation: "ciPasses.checkRuns",
          checkName: run.name,
          checkStatus: run.status,
          checkConclusion: run.conclusion,
        });
        return false;
      }
      if (run.conclusion === "failure" || run.conclusion === "cancelled") {
        logger.logWarn("Judge: check run failed", {
          prNumber,
          sha,
          correlationId: corrId,
          operation: "ciPasses.checkRuns",
          checkName: run.name,
          checkConclusion: run.conclusion,
          checkUrl: run.html_url,
        });
        return false;
      }
    }
  } catch (err) {
    logger.logError("Judge: failed to list check runs", err, {
      prNumber,
      sha,
      correlationId: corrId,
      operation: "ciPasses.checkRuns",
      statusCode: err.status,
    });
    throw new Error(`Failed to fetch check runs for PR #${prNumber}: ${err.message}`);
  }

  logger.logInfo("Judge: CI checks passed", {
    prNumber,
    sha,
    correlationId: corrId,
    operation: "ciPasses",
  });
  return true;
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

/**
 * Fetch the raw diff for a PR.
 * @throws {Error} with descriptive message on failure
 */
async function getPrDiff(prNumber) {
  const corrId = generateCorrelationId();
  try {
    logger.logInfo("Judge: fetching PR diff", {
      prNumber,
      correlationId: corrId,
      operation: "getPrDiff",
    });

    const { data } = await octokit.pulls.get({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      pull_number:  prNumber,
      mediaType:    { format: "diff" },
    });

    const diff = typeof data === "string" ? data : JSON.stringify(data);
    const sizeKb = (diff.length / 1024).toFixed(1);

    logger.logInfo("Judge: PR diff fetched", {
      prNumber,
      correlationId: corrId,
      operation: "getPrDiff",
      diffSizeChars: diff.length,
      diffSizeKb: sizeKb,
    });

    return diff;
  } catch (err) {
    logger.logError("Judge: failed to fetch PR diff", err, {
      prNumber,
      correlationId: corrId,
      operation: "getPrDiff",
      statusCode: err.status,
      errorCode: err.code,
    });
    throw new Error(
      `Failed to fetch diff for PR #${prNumber}: ${err.message} ` +
      `[status=${err.status || "N/A"}, code=${err.code || "N/A"}]`
    );
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

/**
 * Send the diff to the LLM for review.
 * @returns {{ verdict: "PASS"|"FAIL", reason: string }}
 */
async function llmReview(prNumber, prTitle, prBody, diff) {
  const corrId = generateCorrelationId();
  const userMessage = `
PR #${prNumber}: ${prTitle}

Description:
${prBody || "(none)"}

Diff (truncated to 8000 chars):
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`
`.trim();

  logger.logInfo("Judge: sending diff to LLM", {
    prNumber,
    correlationId: corrId,
    operation: "llmReview",
    model: process.env.OPENAI_MODEL || "gpt-4o",
    diffCharsUsed: Math.min(diff.length, 8000),
  });

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
    logger.logError("Judge: LLM API call failed", err, {
      prNumber,
      correlationId: corrId,
      operation: "llmReview.apiCall",
      errorType: err.constructor.name,
      statusCode: err.status,
      errorCode: err.code,
    });
    throw new Error(`LLM API call failed for PR #${prNumber}: ${err.message}`);
  }

  const raw = completion.choices[0].message.content.trim();

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(jsonStr);

    if (!parsed.verdict || !["PASS", "FAIL"].includes(parsed.verdict)) {
      logger.logWarn("Judge: LLM returned invalid verdict value", {
        prNumber,
        correlationId: corrId,
        operation: "llmReview.parse",
        rawResponse: raw.slice(0, 500),
        parsedVerdict: parsed.verdict,
      });
      return { verdict: "FAIL", reason: "LLM returned invalid verdict format" };
    }

    logger.logInfo("Judge: LLM review completed", {
      prNumber,
      correlationId: corrId,
      operation: "llmReview",
      verdict: parsed.verdict,
    });

    return parsed;
  } catch (parseErr) {
    logger.logError("Judge: LLM returned non-JSON response", parseErr, {
      prNumber,
      correlationId: corrId,
      operation: "llmReview.parse",
      rawResponse: raw.slice(0, 500),
      responseLength: raw.length,
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
  const corrId = generateCorrelationId();
  const startTime = Date.now();

  logger.logInfo("Judge: reviewing PR", {
    prNumber,
    correlationId: corrId,
    operation: "reviewPr",
    repo: `${REPO_OWNER}/${REPO_NAME}`,
  });

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  } catch (err) {
    logger.logError("Judge: CI check failed", err, {
      prNumber,
      correlationId: corrId,
      operation: "reviewPr.ciCheck",
    });
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
    logger.logError("Judge: failed to fetch PR data for LLM review", err, {
      prNumber,
      correlationId: corrId,
      operation: "reviewPr.fetchData",
    });
    return { verdict: "FAIL", reason: `Failed to fetch PR: ${err.message}`, ciOk };
  }

  // Step 3 — LLM analysis
  let result;
  try {
    result = await llmReview(prNumber, pr.title, pr.body, diff);
  } catch (err) {
    logger.logError("Judge: LLM review failed", err, {
      prNumber,
      correlationId: corrId,
      operation: "reviewPr.llmReview",
    });
    return {
      verdict: "FAIL",
      reason: `LLM review error: ${err.message}`,
      ciOk,
    };
  }

  const elapsedMs = Date.now() - startTime;
  logger.logInfo("Judge: review completed", {
    prNumber,
    correlationId: corrId,
    operation: "reviewPr",
    verdict: result.verdict,
    elapsedMs,
  });

  return { ...result, ciOk };
}

module.exports = { reviewPr };
