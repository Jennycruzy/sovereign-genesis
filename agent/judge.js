/**
 * judge.js — AI Judge System
 *
 * Reviews a GitHub PR using:
 *   1. GitHub CI status check
 *   2. LLM diff analysis (OpenAI-compatible endpoint)
 *
 * Returns: { verdict: "PASS" | "FAIL", reason: string, ciOk: boolean }
 */
const { Octokit } = require("@octokit/rest");
const OpenAI      = require("openai");
const logger      = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// ── Error logging helpers ─────────────────────────────────────────────────────

/**
 * Logs a structured error with full context for easier debugging.
 * @param {string}    operation - Human-readable name of the operation that failed.
 * @param {Error}     err       - The caught error object.
 * @param {object}   [ctx]      - Optional extra key/value context (e.g. prNumber).
 */
function logError(operation, err, ctx = {}) {
  const entry = {
    operation,
    message:   err.message,
    status:    err.status   ?? err.response?.status ?? undefined,
    code:      err.code     ?? undefined,
    timestamp: new Date().toISOString(),
    context:   ctx,
    stack:     err.stack,
  };
  logger.error(`Judge [${operation}] error: ${err.message}`, entry);
}

/**
 * Logs a structured warning with context.
 */
function logWarn(operation, message, ctx = {}) {
  logger.warn(`Judge [${operation}]: ${message}`, { operation, message, context: ctx, timestamp: new Date().toISOString() });
}

// ── CI status check ───────────────────────────────────────────────────────────

/**
 * Fetch the combined CI status for the PR head commit.
 * Returns true if all required checks pass.
 */
async function ciPasses(prNumber) {
  logger.info(`Judge [ciPasses]: fetching PR #${prNumber} head SHA`);

  const { data: pr } = await octokit.pulls.get({
    owner:       REPO_OWNER,
    repo:        REPO_NAME,
    pull_number: prNumber,
  });

  const sha = pr.head.sha;
  logger.info(`Judge [ciPasses]: checking commit statuses for sha=${sha}`);

  // Check "commit statuses" (older CI integration)
  const { data: status } = await octokit.repos.getCombinedStatusForRef({
    owner: REPO_OWNER,
    repo:  REPO_NAME,
    ref:   sha,
  });

  if (status.state === "failure" || status.state === "error") {
    logWarn("ciPasses", `CI combined status is "${status.state}"`, { prNumber, sha });
    return false;
  }

  // Also check "check runs" (GitHub Actions)
  logger.info(`Judge [ciPasses]: checking GitHub Actions check-runs for sha=${sha}`);
  const { data: checks } = await octokit.checks.listForRef({
    owner:  REPO_OWNER,
    repo:   REPO_NAME,
    ref:    sha,
    filter: "latest",
  });

  for (const run of checks.check_runs) {
    if (run.status !== "completed") {
      logWarn("ciPasses", `Check "${run.name}" not completed (status=${run.status})`, { prNumber, sha, checkName: run.name });
      return false;
    }
    if (run.conclusion === "failure" || run.conclusion === "cancelled") {
      logWarn("ciPasses", `Check "${run.name}" conclusion=${run.conclusion}`, { prNumber, sha, checkName: run.name });
      return false;
    }
  }

  logger.info(`Judge [ciPasses]: all CI checks passed for PR #${prNumber}`);
  return true;
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

async function getPrDiff(prNumber) {
  logger.info(`Judge [getPrDiff]: fetching diff for PR #${prNumber}`);
  const { data } = await octokit.pulls.get({
    owner:        REPO_OWNER,
    repo:         REPO_NAME,
    pull_number:  prNumber,
    mediaType:    { format: "diff" },
  });
  // When requesting diff media type, data is a string
  const diff = typeof data === "string" ? data : JSON.stringify(data);
  logger.info(`Judge [getPrDiff]: received ${diff.length} chars of diff for PR #${prNumber}`);
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
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  logger.info(`Judge [llmReview]: sending PR #${prNumber} to ${model} (diff=${diff.length} chars)`);

  const userMessage = [
    `PR #${prNumber}: ${prTitle}`,
    "",
    "Description:",
    prBody || "(none)",
    "",
    "Diff (truncated to 8000 chars):",
    "```diff",
    diff.slice(0, 8000),
    "```",
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens:  256,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
  });

  const raw = completion.choices[0].message.content.trim();
  logger.info(`Judge [llmReview]: raw LLM response for PR #${prNumber}: ${raw.slice(0, 200)}`);

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    logError("llmReview:parse", parseErr, { prNumber, raw: raw.slice(0, 200) });
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
  logger.info(`Judge [reviewPr]: starting review for PR #${prNumber}`);

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  } catch (err) {
    logError("ciPasses", err, { prNumber });
    return { verdict: "FAIL", reason: `CI check error: ${err.message}`, ciOk: false };
  }

  if (!ciOk) {
    logger.info(`Judge [reviewPr]: CI did not pass for PR #${prNumber} — short-circuiting`);
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
    logError("getPrData", err, { prNumber });
    return { verdict: "FAIL", reason: `Failed to fetch PR data: ${err.message}`, ciOk };
  }

  let result;
  try {
    result = await llmReview(prNumber, pr.title, pr.body, diff);
  } catch (err) {
    logError("llmReview", err, { prNumber, model: process.env.OPENAI_MODEL || "gpt-4o" });
    return { verdict: "FAIL", reason: `LLM review error: ${err.message}`, ciOk };
  }

  logger.info(`Judge [reviewPr]: PR #${prNumber} final verdict=${result.verdict} — ${result.reason}`);
  return { ...result, ciOk };
}

module.exports = { reviewPr };
