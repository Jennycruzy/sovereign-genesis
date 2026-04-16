/**
 * Tests for enhanced error logging in judge.js
 *
 * Verifies that:
 * - All exceptions are caught and logged with contextual info
 * - logError produces structured error objects
 * - CI, diff fetch, and LLM failures are properly reported
 */

const assert = require("assert");
const { logError } = require("../agent/logger");

// ── logError structured output ──────────────────────────────────────────────

describe("logError", () => {
  it("should return structured error info with component and action", () => {
    const err = new Error("test failure");
    const info = logError("judge", "ci_check", err, { prNumber: 42 });

    assert.strictEqual(info.component, "judge");
    assert.strictEqual(info.action, "ci_check");
    assert.strictEqual(info.errorType, "Error");
    assert.strictEqual(info.errorMessage, "test failure");
    assert.strictEqual(info.prNumber, 42);
  });

  it("should capture HTTP status codes from GitHub API errors", () => {
    const err = new Error("Not Found");
    err.status = 404;
    const info = logError("judge", "fetch_pr", err, { prNumber: 99 });

    assert.strictEqual(info.statusCode, 404);
    assert.strictEqual(info.errorMessage, "Not Found");
  });

  it("should capture error codes (e.g., rate limit)", () => {
    const err = new Error("rate limit exceeded");
    err.code = "ECONNRESET";
    const info = logError("judge", "llm_call", err);

    assert.strictEqual(info.errorCode, "ECONNRESET");
  });

  it("should truncate stack traces to 3 lines", () => {
    const err = new Error("stack test");
    const info = logError("judge", "test", err);

    // Stack should exist and be truncated
    assert.ok(info.stack, "stack should be present");
    const lines = info.stack.split(" | ");
    assert.ok(lines.length <= 3, "stack should be truncated to 3 lines");
  });

  it("should handle non-Error objects gracefully", () => {
    const info = logError("judge", "parse", "string error", { prNumber: 1 });

    assert.strictEqual(info.errorType, "UnknownError");
    assert.strictEqual(info.errorMessage, "string error");
  });
});