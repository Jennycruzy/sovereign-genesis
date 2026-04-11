/**
 * judge.js — AI Judge System
 *
 * Reviews a GitHub PR using:
 *   1. GitHub CI status check
 *   2. LLM diff analysis (OpenAI-compatible endpoint)
 *
 * All exceptions are caught and logged with full context so failures
 * can be diagnosed from logs alone.
 *
 * Returns: { verdict: "PASS" | "FAIL", reason: string }
 */
const { Octokit } = require("@octokit/rest");
const OpenAI      = require("openai");
const logger      = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// ── Contextual error helper ───────────────────────────────────────────────────

/**
 * Build and emit a richly-structured error log entry for the judge pipeline.
 *
 * Every exception is annotated with:
 *   - step name and PR number (always present)
 *   - GitHub API metadata (repo, commit sha, endpoint, HTTP status)
 *   - OpenAI API metadata (model, length hints)
 *   - full stack trace (for post-mortem diagnosis)
 *   - any caller-supplied context key/values
 *
 * @param {{ step: string, prNumber: number, context?: object, err: Error }} opts
 */
function logJudgeError({ step, prNumber, context, err }) {
  const ctx = context || {};
  const extras = {};

  if (err.message)                            extras.error               = err.message;
  if (err.code)                               extras.code                = err.code;
  if (err.status)                            extras.status              = err.status;
  if (err.stack)                              extras.stack               = err.stack;
  if (err.request?.path)                      extras.apiPath             = err.request.path;
  if (err.request?.method)                    extras.apiMethod          = err.request.method;
  if (err.response?.headers?.["x-ratelimit-remaining"]) {
                                                  extras.ratelimitRemaining = err.response.headers["x-ratelimit-remaining"];
  }
  if (err.response?.data?.message)            extras.apiMessage          = err.response.data.message;

  Object.assign(extras, ctx);

  const kvPairs = Object.entries(extras)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` | ${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("");

  logger.error(`[Judge:PR#${prNumber}] ${step} failed${kvPairs}`);
}

// ── CI status check ───────────────────────────────────────────────────────────

/**
 * Fetch the combined CI status for the PR head commit.
 * Returns true if all required checks pass.
 *
 * @param {number} prNumber
 * @returns {{ ok: boolean, skipped: boolean, reason?: string }}
 */
async function ciPasses(prNumber) {
  let prData;
  try {
    const res = await octokit.pulls.get({
      owner:       REPO_OWNER,
      repo:        REPO_NAME,
      pull_number: prNumber,
    });
    prData = res.data;
  } catch (err) {
    logJudgeError({ step: "ciPasses#fetchPr", prNumber, err });
    return { ok: false, skipped: true, reason: `fetch PR: ${err.message}` };
  }

  const sha = prData.head.sha;

  // Check "commit statuses" (older CI integration)
  let statusState;
  try {
    const { data: status } = await octokit.repos.getCombinedStatusForRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   sha,
    });
    statusState = status.state;

    if (statusState === "failure" || statusState === "error") {
      const failedContexts = (status.statuses || [])
        .filter((s) => s.state === "failure" || s.state === "error")
        .map((s) => s.context);
      logger.warn(
        `[Judge:PR#${prNumber}] CI commit-status: "${statusState}" | ` +
        `failed_contexts=[${failedContexts.join(", ")}]`
      );
      return { ok: false, skipped: false, reason: `commit status = ${statusState}` };
    }
  } catch (err) {
    logJudgeError({ step: "ciPasses#commitStatus", prNumber, err, context: { sha } });
    return { ok: false, skipped: true, reason: `commit-status check: ${err.message}` };
  }

  // Also check "check runs" (GitHub Actions)
  let checks;
  try {
    const res = await octokit.checks.listForRef({
      owner:  REPO_OWNER,
      repo:   REPO_NAME,
      ref:    sha,
      filter: "latest",
    });
    checks = res.data.check_runs || [];
  } catch (err) {
    logJudgeError({ step: "ciPasses#checkRuns", prNumber, err, context: { sha } });
    return { ok: false, skipped: true, reason: `check-runs lookup: ${err.message}` };
  }

  const incomplete = checks.filter((r) => r.status !== "completed");
  if (incomplete.length > 0) {
    logger.warn(
      `[Judge:PR#${prNumber}] CI checks not completed: [${incomplete.map((r) => r.name).join(", ")}]`
    );
    return { ok: false, skipped: false, reason: "CI checks still running" };
  }

  const failed = checks.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "cancelled"
  );
  if (failed.length > 0) {
    logger.warn(
      `[Judge:PR#${prNumber}] CI checks failed: [${failed.map((r) => `${r.name}(${r.conclusion})`).join(", ")}]`
    );
    return { ok: false, skipped: false, reason: `check(s) failed: ${failed.map((r) => r.name).join(", ")}` };
  }

  logger.info(`[Judge:PR#${prNumber}] CI passed (commit=${sha.slice(0, 7)}, checks=${checks.length})`);
  return { ok: true, skipped: false };
}

// ── PR diff retrieval ─────────────────────────────────────────────────────────

/**
 * @param {number} prNumber
 * @returns {{ diff: string, pr: object }}}
 */
async function getPrData(prNumber) {
  let diff, prData;

  // Fetch diff
  try {
    const res = await octokit.pulls.get({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      pull_number:  prNumber,
      mediaType:    { format: "diff" },
    });
    diff = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  } catch (err) {
    logJudgeError({ step: "getPrData#diff", prNumber, err });
    throw Object.assign(new Error(`Failed to fetch diff: ${err.message}`), { code: "DIFF_FETCH_FAILED" });
  }

  // Fetch PR metadata
  try {
    const res = await octokit.pulls.get({
      owner:       REPO_OWNER,
      repo:        REPO_NAME,
      pull_number: prNumber,
    });
    prData = res.data;
  } catch (err) {
    logJudgeError({ step: "getPrData#prMeta", prNumber, err });
    throw Object.assign(new Error(`Failed to fetch PR metadata: ${err.message}`), { code: "PR_META_FETCH_FAILED" });
  }

  return { diff, prData };
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
 * @param {number}  prNumber
 * @param {string}  prTitle
 * @param {string}  prBody
 * @param {string}  diff
 * @returns {{ verdict: string, reason: string }}
 */
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
    logJudgeError({
      step:      "llmReview#openaiCall",
      prNumber,
      err,
      context:   {
        model:       process.env.OPENAI_MODEL || "gpt-4o",
        diffLength:  diff.length,
        messageLen: userMessage.length,
      },
    });
    return { verdict: "FAIL", reason: `OpenAI API error: ${err.message}` };
  }

  const raw = (completion.choices[0].message.content || "").trim();
  logger.info(`[Judge:PR#${prNumber}] LLM raw response (${raw.length} chars): ${raw.slice(0, 120)}`);

  try {
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed  = JSON.parse(jsonStr);
    if (!parsed.verdict || !parsed.reason) {
      throw new Error(`Missing required fields: ${JSON.stringify(parsed)}`);
    }
    return parsed;
  } catch (err) {
    logJudgeError({
      step:    "llmReview#parse",
      prNumber,
      err,
      context: { rawResponse: raw.slice(0, 200) },
    });
    return { verdict: "FAIL", reason: `LLM returned unparseable response: ${err.message}` };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full review pipeline for a PR.
 *
 * Each step is independently wrapped in try/catch so a failure in one step
 * does not silently abort the whole pipeline.  Full context is logged for
 * every error to enable remote diagnosis.
 *
 * @param {number} prNumber
 * @returns {{ verdict: "PASS"|"FAIL", reason: string, ciOk: boolean, steps: string[] }}
 */
async function reviewPr(prNumber) {
  logger.info(`Judge: starting review pipeline for PR #${prNumber}`);
  const completedSteps = [];

  // ── Step 1: CI ────────────────────────────────────────────────────────────
  let ciResult;
  try {
    ciResult = await ciPasses(prNumber);
    completedSteps.push("ci");
  } catch (err) {
    // Unexpected error — wrap and log with full stack
    logJudgeError({ step: "reviewPr#ciPasses", prNumber, err });
    ciResult = { ok: false, skipped: true, reason: err.message };
  }

  if (!ciResult.ok) {
    logger.warn(
      `[Judge:PR#${prNumber}] Review failed at CI step — ${ciResult.reason} | ` +
      `skipped=${ciResult.skipped} | verdict=FAIL`
    );
    return {
      verdict: "FAIL",
      reason:  ciResult.reason || "CI checks did not pass",
      ciOk:    false,
      steps:   completedSteps,
    };
  }

  // ── Step 2: fetch PR diff + metadata ─────────────────────────────────────
  let prData;
  try {
    prData = await getPrData(prNumber);
    completedSteps.push("fetch");
  } catch (err) {
    logJudgeError({ step: "reviewPr#getPrData", prNumber, err });
    return {
      verdict: "FAIL",
      reason:  `Failed to fetch PR data: ${err.message}`,
      ciOk:    true,
      steps:   completedSteps,
    };
  }

  // ── Step 3: LLM diff review ───────────────────────────────────────────────
  let llmResult;
  try {
    llmResult = await llmReview(prNumber, prData.prData.title, prData.prData.body, prData.diff);
    completedSteps.push("llm");
  } catch (err) {
    // Defensive: llmReview should always return, but top-level catch guards against unexpected bugs
    logJudgeError({ step: "reviewPr#llmReview", prNumber, err });
    llmResult = { verdict: "FAIL", reason: `LLM review error: ${err.message}` };
  }

  logger.info(
    `[Judge:PR#${prNumber}] Review pipeline complete | ` +
    `verdict=${llmResult.verdict} | reason=${llmResult.reason} | ` +
    `steps=[${completedSteps.join(", ")}]`
  );

  return {
    verdict: llmResult.verdict,
    reason:  llmResult.reason,
    ciOk:    ciResult.ok,
    steps:   completedSteps,
  };
}

module.exports = { reviewPr };
