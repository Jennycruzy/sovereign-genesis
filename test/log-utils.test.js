const { expect } = require("chai");
const sinon      = require("sinon");

// Mock winston before requiring log-utils
const stubLogger = {
  info:  sinon.stub(),
  warn:  sinon.stub(),
  error: sinon.stub(),
  debug: sinon.stub(),
};

const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "winston") {
    return {
      createLogger: () => stubLogger,
      format: {
        combine:    () => {},
        timestamp:  () => {},
        colorize:   () => {},
        printf:     () => {},
        uncolorize: () => {},
      },
      transports: { Console: class {}, File: class {} },
    };
  }
  return originalRequire.apply(this, arguments);
};

const {
  logAIReviewError,
  logReviewStart,
  logCiResult,
  logCiError,
  logLlmReviewRequest,
  logLlmReviewResult,
  logLlmReviewError,
  logReviewComplete,
} = require("../agent/log-utils");

describe("log-utils", function () {
  beforeEach(function () {
    stubLogger.info.resetHistory();
    stubLogger.warn.resetHistory();
    stubLogger.error.resetHistory();
  });

  // ── logReviewStart ──────────────────────────────────────────────────────────

  describe("logReviewStart", function () {
    it("logs PR number, title, author, sha, and base branch", function () {
      logReviewStart(42, {
        prTitle:    "feat: add dark mode",
        author:     "alice",
        headSha:    "abc123def456",
        baseBranch: "main",
      });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("PR #42");
      expect(msg).to.include('title="feat: add dark mode"');
      expect(msg).to.include("author=alice");
      expect(msg).to.include("sha=abc123d");
      expect(msg).to.include("base=main");
    });

    it("handles missing metadata gracefully", function () {
      logReviewStart(7);
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("PR #7");
      expect(msg).to.include("author=unknown");
    });
  });

  // ── logCiResult ────────────────────────────────────────────────────────────

  describe("logCiResult", function () {
    it("logs passed=false with check names and duration", function () {
      logCiResult(99, false, {
        statusState: "failure",
        checkRuns:   [{ name: "test" }, { name: "lint" }],
        durationMs:  150,
      });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("PR #99");
      expect(msg).to.include("passed=false");
      expect(msg).to.include("state=failure");
      expect(msg).to.include("checks=[test, lint]");
      expect(msg).to.include("150ms");
    });

    it("logs passed=true without duration when durationMs is absent", function () {
      logCiResult(5, true, { checkRuns: [] });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("passed=true");
      expect(msg).not.to.include("ms)");
    });
  });

  // ── logCiError ─────────────────────────────────────────────────────────────

  describe("logCiError", function () {
    it("logs error message and stack trace", function () {
      const err = new Error("network timeout");
      err.stack = "Error: network timeout\n    at test.js:10";
      logCiError(12, err);
      const msg = stubLogger.error.firstCall.args[0];
      expect(msg).to.include("PR #12");
      expect(msg).to.include("message=network timeout");
      expect(msg).to.include("stack=");
    });
  });

  // ── logLlmReviewRequest ────────────────────────────────────────────────────

  describe("logLlmReviewRequest", function () {
    it("logs model, diffLength, and promptTokens", function () {
      logLlmReviewRequest(55, {
        model:       "gpt-4o",
        diffLength:  12345,
        promptTokens: 420,
      });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("PR #55");
      expect(msg).to.include("model=gpt-4o");
      expect(msg).to.include("diffLength=12345");
      expect(msg).to.include("promptTokens=420");
    });

    it("omits promptTokens from log when null", function () {
      logLlmReviewRequest(8, { diffLength: 500 });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("diffLength=500");
      expect(msg).not.to.include("promptTokens");
    });
  });

  // ── logLlmReviewResult ─────────────────────────────────────────────────────

  describe("logLlmReviewResult", function () {
    it("logs verdict, reason, and duration", function () {
      logLlmReviewResult(77, "PASS", {
        reason:    "all checks passed",
        durationMs: 3200,
      });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("PR #77");
      expect(msg).to.include("verdict=PASS");
      expect(msg).to.include('reason="all checks passed"');
      expect(msg).to.include("3200ms");
    });

    it("truncates raw response preview to 150 chars", function () {
      const raw = "x".repeat(300);
      logLlmReviewResult(3, "FAIL", { raw, reason: "bad" });
      const msg = stubLogger.info.firstCall.args[0];
      const rawPart = msg.match(/raw="(.+)"/)?.[1] || "";
      expect(rawPart.length).to.be.at.most(155);
    });

    it("omits raw section when raw is null", function () {
      logLlmReviewResult(9, "PASS", { reason: "ok" });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).not.to.include("raw=");
    });
  });

  // ── logLlmReviewError ─────────────────────────────────────────────────────

  describe("logLlmReviewError", function () {
    it("handles Error objects with message and stack", function () {
      const err = new Error("LLM API error");
      err.stack = "Error: LLM API error\n    at llmReview";
      logLlmReviewError(88, err);
      const msg = stubLogger.error.firstCall.args[0];
      expect(msg).to.include("PR #88");
      expect(msg).to.include("message=LLM API error");
    });

    it("handles raw string (non-JSON response)", function () {
      const raw = "模型返回了非JSON内容";
      logLlmReviewError(21, raw);
      const msg = stubLogger.error.firstCall.args[0];
      expect(msg).to.include("PR #21");
      expect(msg).to.include("non-JSON response");
      expect(msg).to.include("模型返回了非JSON内容");
    });
  });

  // ── logReviewComplete ─────────────────────────────────────────────────────

  describe("logReviewComplete", function () {
    it("logs verdict, ciOk, reason, and both durations", function () {
      logReviewComplete(101, {
        verdict:         "PASS",
        ciOk:            true,
        reason:          "clean diff",
        totalDurationMs: 5500,
        llmDurationMs:   4200,
      });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("PR #101");
      expect(msg).to.include("verdict=PASS");
      expect(msg).to.include("ciOk=true");
      expect(msg).to.include('reason="clean diff"');
      expect(msg).to.include("total=5500ms");
      expect(msg).to.include("llm=4200ms");
    });

    it("handles partial metrics (totalDurationMs only)", function () {
      logReviewComplete(5, { totalDurationMs: 100 });
      const msg = stubLogger.info.firstCall.args[0];
      expect(msg).to.include("total=100ms");
      expect(msg).not.to.include("llm=");
    });
  });

  // ── logAIReviewError (legacy) ─────────────────────────────────────────────

  describe("logAIReviewError", function () {
    it("logs model, error message, and raw snippet", function () {
      const err = new Error("timeout");
      logAIReviewError(33, err, "not a json response here");
      const msg = stubLogger.error.firstCall.args[0];
      expect(msg).to.include("PR #33");
      expect(msg).to.include("model=");
      expect(msg).to.include("error=timeout");
      expect(msg).to.include("raw=not a json");
    });
  });
});
