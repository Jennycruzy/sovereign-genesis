/**
 * judge.test.js — Unit tests for agent/judge.js
 */
const { expect } = require("chai");
const nock = require("nock");

// Mock logger to suppress output during tests
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
require.cache[require.resolve("./logger")] = { exports: mockLogger };

// Mock fs.readFileSync used at top-level of judge.js
const fsStub = {
  readFileSync: () => "",
};
require.cache[require.resolve("fs")] = { exports: fsStub };
require.cache[require.resolve("./logger")] = { exports: mockLogger };

// Now load judge (after mocking dependencies)
const { reviewPr } = require("./judge");

// ── helpers ──────────────────────────────────────────────────────────────────

function mockGitHubPR(prNumber, overrides = {}) {
  const pr = {
    number: prNumber,
    title: `Test PR #${prNumber}`,
    body: "Test bounty PR",
    head: { sha: "abc123def456" },
    ...overrides,
  };
  return nock("https://api.github.com")
    .get(`/repos/owner/repo/pulls/${prNumber}`)
    .reply(200, pr);
}

function mockGitHubCombinedStatus(sha, state = "success") {
  return nock("https://api.github.com")
    .get(`/repos/owner/repo/statuses/${sha}`)
    .reply(200, { state });
}

function mockGitHubCheckRuns(sha, checkRuns = []) {
  return nock("https://api.github.com")
    .get(`/repos/owner/repo/commits/${sha}/check-runs`)
    .reply(200, { check_runs: checkRuns });
}

function mockGitHubDiff(prNumber, diffContent = "--- a/test.js\n+++ b/test.js\n@@ test") {
  return nock("https://api.github.com")
    .get(`/repos/owner/repo/pulls/${prNumber}`)
    .reply(200, diffContent, { "content-type": "text/plain" });
}

describe("judge.js", function () {
  beforeEach(function () {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPO = "owner/repo";
  });

  afterEach(function () {
    nock.cleanAll();
  });

  // ── getPrDiff ───────────────────────────────────────────────────────────

  describe("getPrDiff (indirect via reviewPr)", function () {
    it("returns FAIL when GitHub API returns error for PR diff", async function () {
      // PR metadata succeeds but diff endpoint fails
      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/999")
        .reply(404, { message: "Not Found" });

      // CI check uses a different PR number to isolate
      // We mock CI to pass then diff to fail
      const shaScope = nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/999")
        .reply(200, { number: 999, title: "t", body: "b", head: { sha: "abc123" } });

      nock("https://api.github.com")
        .get("/repos/owner/repo/statuses/abc123")
        .reply(200, { state: "success" });

      nock("https://api.github.com")
        .get("/repos/owner/repo/commits/abc123/check-runs")
        .reply(200, { check_runs: [{ id: 1, status: "completed", conclusion: "success", name: "test" }] });

      // Diff fetch fails
      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/999")
        .reply(500, { message: "Server Error" });

      const result = await reviewPr(999);
      expect(result.verdict).to.equal("FAIL");
      expect(result.reason).to.include("Failed to fetch PR diff");
    });
  });

  // ── ciPasses ────────────────────────────────────────────────────────────

  describe("ciPasses (indirect via reviewPr)", function () {
    it("returns FAIL when CI status is failure", async function () {
      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/1")
        .reply(200, { number: 1, title: "t", body: "b", head: { sha: "abc123" } });

      nock("https://api.github.com")
        .get("/repos/owner/repo/statuses/abc123")
        .reply(200, { state: "failure" });

      const result = await reviewPr(1);
      expect(result.verdict).to.equal("FAIL");
      expect(result.reason).to.equal("CI checks did not pass");
      expect(result.ciOk).to.equal(false);
    });

    it("returns FAIL when a check run is not completed", async function () {
      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/2")
        .reply(200, { number: 2, title: "t", body: "b", head: { sha: "abc123" } });

      nock("https://api.github.com")
        .get("/repos/owner/repo/statuses/abc123")
        .reply(200, { state: "success" });

      nock("https://api.github.com")
        .get("/repos/owner/repo/commits/abc123/check-runs")
        .reply(200, { check_runs: [{ id: 1, status: "in_progress", conclusion: null, name: "build" }] });

      const result = await reviewPr(2);
      expect(result.verdict).to.equal("FAIL");
      expect(result.ciOk).to.equal(false);
    });

    it("returns FAIL when a check run conclusion is failure", async function () {
      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/3")
        .reply(200, { number: 3, title: "t", body: "b", head: { sha: "abc123" } });

      nock("https://api.github.com")
        .get("/repos/owner/repo/statuses/abc123")
        .reply(200, { state: "success" });

      nock("https://api.github.com")
        .get("/repos/owner/repo/commits/abc123/check-runs")
        .reply(200, { check_runs: [{ id: 1, status: "completed", conclusion: "failure", name: "test" }] });

      const result = await reviewPr(3);
      expect(result.verdict).to.equal("FAIL");
      expect(result.ciOk).to.equal(false);
    });
  });

  // ── llmReview ────────────────────────────────────────────────────────────

  describe("llmReview (indirect via reviewPr)", function () {
    it("returns FAIL verdict when LLM returns non-JSON", async function () {
      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/10")
        .reply(200, { number: 10, title: "t", body: "b", head: { sha: "abc123" } });

      nock("https://api.github.com")
        .get("/repos/owner/repo/statuses/abc123")
        .reply(200, { state: "success" });

      nock("https://api.github.com")
        .get("/repos/owner/repo/commits/abc123/check-runs")
        .reply(200, { check_runs: [{ id: 1, status: "completed", conclusion: "success", name: "test" }] });

      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/10")
        .reply(200, "--- a/test.js\n+++ b/test.js");

      // Mock OpenAI
      nock("https://api.openai.com")
        .post("/v1/chat/completions")
        .reply(200, {
          choices: [{ message: { content: "This is not JSON at all" } }],
        });

      const result = await reviewPr(10);
      expect(result.verdict).to.equal("FAIL");
      expect(result.reason).to.include("LLM returned unparseable response");
    });

    it("returns parsed verdict when LLM returns valid JSON", async function () {
      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/11")
        .reply(200, { number: 11, title: "t", body: "b", head: { sha: "abc123" } });

      nock("https://api.github.com")
        .get("/repos/owner/repo/statuses/abc123")
        .reply(200, { state: "success" });

      nock("https://api.github.com")
        .get("/repos/owner/repo/commits/abc123/check-runs")
        .reply(200, { check_runs: [{ id: 1, status: "completed", conclusion: "success", name: "test" }] });

      nock("https://api.github.com")
        .get("/repos/owner/repo/pulls/11")
        .reply(200, "--- a/test.js\n+++ b/test.js");

      nock("https://api.openai.com")
        .post("/v1/chat/completions")
        .reply(200, {
          choices: [{ message: { content: '{"verdict":"PASS","reason":"Code looks good"}' } }],
        });

      const result = await reviewPr(11);
      expect(result.verdict).to.equal("PASS");
      expect(result.ciOk).to.equal(true);
    });
  });
});
