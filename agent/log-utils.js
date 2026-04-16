/**
 * log-utils.js — Structured logging helpers for the AI Judge module
 */
const logger = require("./logger");

// ── Review metrics ────────────────────────────────────────────────────────────

/**
 * Log the start of a PR review with metadata.
 * @param {number} prNumber
 * @param {object} meta  - { prTitle, author, headSha, baseBranch }
 */
function logReviewStart(prNumber, meta = {}) {
  const { prTitle = "(no title)", author = "unknown", headSha = "?", baseBranch = "?" } = meta;
  const shortSha = headSha.slice(0, 7);
  logger.info(
    `[PR #${prNumber}] Review started — ` +
    `title="${prTitle}" author=${author} sha=${shortSha} base=${baseBranch}`
  );
}

/**
 * Log CI check results for a PR.
 * @param {number} prNumber
 * @param {boolean} passed
 * @param {object} details - { statusState, checkRuns[], durationMs }
 */
function logCiResult(prNumber, passed, details = {}) {
  const { statusState = null, checkRuns = [], durationMs = null } = details;
  const runNames = checkRuns.map((r) => r.name).join(", ") || "none";
  const dur = durationMs !== null ? ` (${durationMs}ms)` : "";
  const stateStr = statusState ? ` state=${statusState}` : "";
  logger.info(
    `[PR #${prNumber}] CI check${dur} — ` +
    `passed=${passed}${stateStr} checks=[${runNames}]`
  );
}

/**
 * Log CI check error with details.
 * @param {number} prNumber
 * @param {Error} err
 */
function logCiError(prNumber, err) {
  logger.error(
    `[PR #${prNumber}] CI check error — ` +
    `message=${err.message} stack=${err.stack ? err.stack.slice(0, 300) : "none"}`
  );
}

/**
 * Log LLM review request.
 * @param {number} prNumber
 * @param {object} params - { model, diffLength, promptTokens }
 */
function logLlmReviewRequest(prNumber, params = {}) {
  const { model = process.env.OPENAI_MODEL || "gpt-4o", diffLength = 0, promptTokens = null } = params;
  const tokensStr = promptTokens !== null ? ` promptTokens=${promptTokens}` : "";
  logger.info(
    `[PR #${prNumber}] LLM review request — ` +
    `model=${model} diffLength=${diffLength}${tokensStr}`
  );
}

/**
 * Log LLM review result.
 * @param {number} prNumber
 * @param {string} verdict  - "PASS" | "FAIL"
 * @param {object} result   - { reason, raw?, durationMs? }
 */
function logLlmReviewResult(prNumber, verdict, result = {}) {
  const { reason = "", raw = null, durationMs = null } = result;
  const dur = durationMs !== null ? ` (${durationMs}ms)` : "";
  const rawPreview = raw ? ` raw="${raw.slice(0, 150).replace(/\n/g, " ")}"` : "";
  logger.info(
    `[PR #${prNumber}] LLM review result${dur} — ` +
    `verdict=${verdict} reason="${reason}"${rawPreview}`
  );
}

/**
 * Log LLM review error.
 * @param {number} prNumber
 * @param {Error|string} errOrRaw
 */
function logLlmReviewError(prNumber, errOrRaw) {
  if (errOrRaw instanceof Error) {
    logger.error(
      `[PR #${prNumber}] LLM review error — ` +
      `message=${errOrRaw.message} stack=${errOrRaw.stack ? errOrRaw.stack.slice(0, 300) : "none"}`
    );
  } else {
    logger.error(
      `[PR #${prNumber}] LLM review error — ` +
      `non-JSON response="${String(errOrRaw).slice(0, 200).replace(/\n/g, " ")}"`
    );
  }
}

/**
 * Log overall review completion with metrics summary.
 * @param {number} prNumber
 * @param {object} summary - { verdict, ciOk, reason, totalDurationMs, llmDurationMs? }
 */
function logReviewComplete(prNumber, summary = {}) {
  const {
    verdict = "UNKNOWN",
    ciOk = false,
    reason = "",
    totalDurationMs = null,
    llmDurationMs = null,
  } = summary;
  const dur = totalDurationMs !== null ? ` total=${totalDurationMs}ms` : "";
  const llmDur = llmDurationMs !== null ? ` llm=${llmDurationMs}ms` : "";
  logger.info(
    `[PR #${prNumber}] Review complete${dur}${llmDur} — ` +
    `verdict=${verdict} ciOk=${ciOk} reason="${reason}"`
  );
}

// ── AI review error (legacy helper, kept for compatibility) ──────────────────

/**
 * @deprecated Use logLlmReviewError instead.
 * Legacy helper kept for compatibility with any external callers.
 */
function logAIReviewError(prNumber, error, raw) {
  logger.error(
    `[PR #${prNumber}] AI review failed — ` +
    `model=${process.env.OPENAI_MODEL || "gpt-4o"} ` +
    `error=${error?.message || "unknown"} ` +
    `raw=${raw ? raw.slice(0, 200) : "none"}`
  );
}

module.exports = {
  logAIReviewError,
  logReviewStart,
  logCiResult,
  logCiError,
  logLlmReviewRequest,
  logLlmReviewResult,
  logLlmReviewError,
  logReviewComplete,
};
