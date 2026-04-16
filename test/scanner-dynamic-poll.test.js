/**
 * scanner-dynamic-poll.test.js
 * Unit tests for the dynamic polling strategy in scanner.js
 */
const { expect } = require("chai");
const sinon      = require("sinon");

// Clear module cache so mocks apply cleanly
delete require.cache[require.resolve("../agent/scanner")];
delete require.cache[require.resolve("@octokit/rest")];
delete require.cache[require.resolve("../agent/contract")];
delete require.cache[require.resolve("../agent/financial")];
delete require.cache[require.resolve("../agent/logger")];

// Build mock instances
const mockIssuesListForRepo = sinon.stub();
const mockOctokitInstance = { issues: { listForRepo: mockIssuesListForRepo } };
function MockOctokit() { return mockOctokitInstance; }
MockOctokit.rest = mockOctokitInstance;

const mockContract = {
  getBountyAmount: sinon.stub(),
  isBountyPaid:    sinon.stub(),
  postBounty:      sinon.stub(),
};
const mockFinancial = {
  adviseBountyAmount: sinon.stub(),
};
const stubLogger = {
  info:  sinon.stub(),
  warn:  sinon.stub(),
  error: sinon.stub(),
  debug: sinon.stub(),
};

// Override require for @octokit/rest
const Module = require("module");
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "@octokit/rest") return { Octokit: MockOctokit };
  if (id === "./contract")    return mockContract;
  if (id === "./financial")   return mockFinancial;
  if (id === "./logger")      return stubLogger;
  return origRequire.apply(this, arguments);
};

// Set deterministic env before loading scanner
const origEnv = { ...process.env };
process.env.POLL_INTERVAL_MS       = "60000";
process.env.POLL_MIN_INTERVAL_MS   = "15000";
process.env.POLL_MAX_INTERVAL_MS   = "300000";
process.env.POLL_ACTIVITY_DECAY_MS = "300000";

const { scan } = require("../agent/scanner");

describe("scanner.js — dynamic polling", function () {

  beforeEach(function () {
    mockIssuesListForRepo.resetHistory();
    mockContract.getBountyAmount.resetHistory();
    mockContract.isBountyPaid.resetHistory();
    mockContract.postBounty.resetHistory();
    mockFinancial.adviseBountyAmount.resetHistory();
    stubLogger.info.resetHistory();
    stubLogger.warn.resetHistory();
    stubLogger.error.resetHistory();
  });

  after(function () {
    Object.assign(process.env, origEnv);
    Module.prototype.require = origRequire;
  });

  // ── scan() return shape ──────────────────────────────────────────────────────

  it("scan() returns { foundBounty, openCount }", async function () {
    mockIssuesListForRepo.resolves({ data: [] });
    const result = await scan();
    expect(result).to.have.keys("foundBounty", "openCount");
    expect(result.openCount).to.equal(0);
    expect(result.foundBounty).to.equal(false);
  });

  it("openCount reflects the number of deduplicated open issues", async function () {
    mockIssuesListForRepo.resolves({
      data: [
        { number: 1, labels: [], body: "Bounty: 1 XTZ" },
        { number: 2, labels: [], body: "Bounty: 2 XTZ" },
      ],
    });
    mockContract.getBountyAmount.resolves(0n);
    mockContract.isBountyPaid.resolves(false);
    mockFinancial.adviseBountyAmount.resolves({ amount: 1_000_000_000_000_000n, reason: null });
    mockContract.postBounty.resolves();

    const result = await scan();
    expect(result.openCount).to.equal(2);
    expect(result.foundBounty).to.equal(true);
  });

  it("foundBounty is true when a bounty was successfully posted", async function () {
    mockIssuesListForRepo.resolves({
      data: [{ number: 10, labels: [], body: "Bounty: 0.5 XTZ" }],
    });
    mockContract.getBountyAmount.resolves(0n);
    mockContract.isBountyPaid.resolves(false);
    mockFinancial.adviseBountyAmount.resolves({ amount: BigInt(5e17), reason: null });
    mockContract.postBounty.resolves();

    const result = await scan();
    expect(result.foundBounty).to.equal(true);
    expect(mockContract.postBounty.calledOnce).to.equal(true);
  });

  it("foundBounty is false when no bounty amount is parseable", async function () {
    mockIssuesListForRepo.resolves({
      data: [{ number: 20, labels: [], body: "No bounty here" }],
    });

    const result = await scan();
    expect(result.foundBounty).to.equal(false);
    expect(result.openCount).to.equal(1);
  });

  it("foundBounty is false when financial advisor returns null (treasury below life-support)", async function () {
    mockIssuesListForRepo.resolves({
      data: [{ number: 30, labels: [], body: "Bounty: 100 XTZ" }],
    });
    mockContract.getBountyAmount.resolves(0n);
    mockContract.isBountyPaid.resolves(false);
    mockFinancial.adviseBountyAmount.resolves(null);

    const result = await scan();
    expect(result.foundBounty).to.equal(false);
    expect(mockContract.postBounty.called).to.equal(false);
  });

  it("skips issues already posted on-chain (getBountyAmount > 0)", async function () {
    mockIssuesListForRepo.resolves({
      data: [{ number: 40, labels: [], body: "Bounty: 1 XTZ" }],
    });
    mockContract.getBountyAmount.resolves(1_000_000_000_000_000n);

    const result = await scan();
    expect(result.foundBounty).to.equal(false);
    expect(mockContract.postBounty.called).to.equal(false);
  });

  it("skips issues already paid (isBountyPaid = true)", async function () {
    mockIssuesListForRepo.resolves({
      data: [{ number: 41, labels: [], body: "Bounty: 1 XTZ" }],
    });
    mockContract.getBountyAmount.resolves(0n);
    mockContract.isBountyPaid.resolves(true);

    const result = await scan();
    expect(result.foundBounty).to.equal(false);
    expect(mockContract.postBounty.called).to.equal(false);
  });

  it("posts volatility-adjusted bounty and sets foundBounty=true", async function () {
    mockIssuesListForRepo.resolves({
      data: [{ number: 50, labels: [], body: "Bounty: 2 XTZ" }],
    });
    mockContract.getBountyAmount.resolves(0n);
    mockContract.isBountyPaid.resolves(false);
    // Financial advisor halves the bounty due to volatility
    mockFinancial.adviseBountyAmount.resolves({ amount: 1_000_000_000_000_000n, reason: "high_volatility" });
    mockContract.postBounty.resolves();

    const result = await scan();
    expect(result.foundBounty).to.equal(true);
    expect(result.openCount).to.equal(1);
  });

  it("logs a scan summary including next poll interval", async function () {
    mockIssuesListForRepo.resolves({ data: [] });

    await scan();

    const summaryCall = stubLogger.info.getCalls().find(
      (c) => c.args[0].includes("scan #") || c.args[0].includes("next poll")
    );
    expect(summaryCall).to.not.be.undefined;
  });
});
