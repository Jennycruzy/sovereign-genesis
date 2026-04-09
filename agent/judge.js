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

const log = logger.child({ module: "Judge" });

// Validate required env vars at load time
function validateEnv() {
  const missing = [];
  if (!process.env.GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.GITHUB_REPO) missing.push("GITHUB_REPO");
  if (missing.length) {
    log.error(`Missing required environment variables: ${missing.join(", ")}`, { severity: "critical" });
  }
  return missing.length === 0;
}
validateEnv();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// ── CI status check ───────────────────────────────────────────────────────────

/**
 * Fetch the combined CI status for the PR head commit.
 * Returns true if all required checks pass.
 */
async function ciPasses(prNumber) {
  let pr;
  try {
    ({ data: pr } = await octokit.pulls.get({
      owner:       REPO_OWNER,
      repo:        REPO_NAME,
      pull_number: prNumber,
    }));
  } catch (err) {
    log.error(`Failed to fetch PR metadata for CI check`, {
      severity: "high", prNumber, error: err.message, stack: err.stack
    });
    throw err;
  }

  const sha = pr.head.sha;

  // Check "commit statuses" (older CI integration)
  try {
    const { data: status } = await octokit.repos.getCombinedStatusForRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   sha,
    });

    if (status.state === "failure" || status.state === "error") {
      log.warn(`CI status is "${status.state}"`, { prNumber, sha, total_count: status.total_count });
      return false;
    }
  } catch (err) {
    log.error(`Failed to fetch commit statuses`, {
      severity: "medium", prNumber, sha, error: err.message
    });
    // Recovery: proceed to check-runs as fallback
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
        log.warn(`Check "${run.name}" not completed yet`, { prNumber, check: run.name, status: run.status });
        return false;
      }
      if (run.conclusion === "failure" || run.conclusion === "cancelled") {
        log.warn(`Check "${run.name}" failed`, { prNumber, check: run.name, conclusion: run.conclusion });
        return false;
      }
    }
  } catch (err) {
    log.error(`Failed to fetch check runs`, {
      severity: "medium", prNumber, sha, error: err.message
    });
    // Recovery: if we can't check, treat as CI pass to let LLM review catch issues
    log.info(`Recovering: skipping check-runs, proceeding with LLM review`, { prNumber });
  }

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
    log.debug(`Fetched PR diff`, { prNumber, diffLength: diff.length });
    return diff;
  } catch (err) {
    log.error(`Failed to fetch PR diff`, {
      severity: "high", prNumber, error: err.message, stack: err.stack
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
  const userMessage = `
PR #${prNumber}: ${prTitle}

Description:
${prBody || "(none)"}

Diff (truncated to 8000 chars):
\`\`\`diff
${diff.slice(0, 8000)}
\`\`\`
`.trim();

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 256,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
    });
  } catch (err) {
    log.error(`LLM API call failed`, {
      severity: "critical", prNumber, model, error: err.message, stack: err.stack
    });
    return { verdict: "FAIL", reason: `LLM API error: ${err.message}` };
  }

  const raw = completion.choices[0].message.content.trim();
  log.debug(`LLM raw response`, { prNumber, model, responseLength: raw.length });

  try {
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    log.error(`LLM returned unparseable JSON`, {
      severity: "high", prNumber, rawResponse: raw.slice(0, 500), error: parseErr.message
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
  const startTime = Date.now();
  log.info(`Starting PR review`, { prNumber, repo: `${REPO_OWNER}/${REPO_NAME}` });

  // Step 1 — CI
  let ciOk = false;
  try {
    ciOk = await ciPasses(prNumber);
  шибка}catch (err) {
    log.error(`CI check error — returning FAIL`, {
      severity: "high", prNumber, error: err.message, stack: err.stack
    });
    return { verdict: "FAIL", reason: `CI check error: ${err.message}`, ciOk: false };
  }

  if (!ciOk) {
    log.info(`CI did not pass, skipping LLM review`, { prNumber });
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
    log.error(`Failed to fetch PR data — returning FAIL`, {
      severity: "high", prNumber, error: err.message, stack: err.stack
    });
    return { verdict: "FAIL", reason: `Failed to fetch PR: ${err.message}`, ciOk };
  }

  const result = await llmReview(prNumber, pr.title, pr.body, diff);
  const elapsed = Date.now() - startTime;
  log.info(`PR review complete`, {
    prNumber, verdict: result.verdict, reason: result.reason, ciOk, elapsedMs: elapsed
  });

  return { ...result, ciOk };
}

module.exports = { reviewPr };
