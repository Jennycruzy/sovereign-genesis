/**
 * webhook/server.js — GitHub Webhook Listener
 *
 * Listens for GitHub PR events:
 *   - pull_request.opened      → enqueue AI review
 *   - pull_request.synchronize → re-review on new commits
 *   - pull_request.closed      → if merged externally, release bounty
 *
 * Security: verifies GitHub HMAC-SHA256 webhook signature.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express    = require("express");
const bodyParser = require("body-parser");
const crypto     = require("crypto");
const contract   = require("../agent/contract");
const logger     = require("../agent/logger");

// ── The agent module is initialised lazily to allow the webhook to start ──────
// independently from the full agent bootstrap (useful in split-process deploy).
let agentModule;
function getAgent() {
  if (!agentModule) {
    contract.init();
    agentModule = require("../agent/index");
  }
  return agentModule;
}

const app  = express();
const PORT = process.env.WEBHOOK_PORT || 3001;
const SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// ── Raw body capture (required for HMAC verification) ────────────────────────
app.use(
  bodyParser.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ── Signature verification middleware ─────────────────────────────────────────

function verifySignature(req, res, next) {
  if (!SECRET) {
    // Dev mode: skip verification if no secret configured
    logger.warn("Webhook: GITHUB_WEBHOOK_SECRET not set — skipping signature check");
    return next();
  }

  const sigHeader = req.headers["x-hub-signature-256"];
  if (!sigHeader) {
    logger.warn("Webhook: missing X-Hub-Signature-256 header");
    return res.status(401).json({ error: "Missing signature" });
  }

  const expected = "sha256=" +
    crypto.createHmac("sha256", SECRET).update(req.rawBody).digest("hex");

  const valid = crypto.timingSafeEqual(
    Buffer.from(sigHeader),
    Buffer.from(expected)
  );

  if (!valid) {
    logger.warn("Webhook: invalid GitHub signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  next();
}

// ── Health endpoint ───────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "sovereign-genesis-webhook" });
});

// ── Webhook endpoint ──────────────────────────────────────────────────────────

app.post("/webhook", verifySignature, async (req, res) => {
  const event   = req.headers["x-github-event"];
  const payload = req.body;

  logger.info(`Webhook: received event "${event}" action "${payload?.action}"`);

  // Acknowledge immediately (GitHub requires < 10 s response)
  res.status(202).json({ received: true });

  // Process asynchronously
  handleEvent(event, payload).catch((err) => {
    logger.error(`Webhook: event handler error — ${err.message}`);
  });
});

// ── Event handler ─────────────────────────────────────────────────────────────

async function handleEvent(event, payload) {
  if (event !== "pull_request") return;

  const action   = payload.action;
  const pr       = payload.pull_request;
  const prNumber = pr?.number;

  if (!prNumber) return;

  const agent = getAgent();

  switch (action) {
    // New PR or new commits pushed → queue for AI review
    case "opened":
    case "synchronize":
    case "reopened":
      logger.info(`Webhook: PR #${prNumber} ${action} — queuing review`);
      await agent.enqueuePrReview(prNumber);
      break;

    // PR was merged outside the agent (e.g. manually) → attempt bounty release
    case "closed":
      if (pr.merged) {
        logger.info(`Webhook: PR #${prNumber} manually merged — attempting bounty release`);
        const { ethers } = require("ethers");
        const executor   = require("../agent/executor");
        const prId       = executor.buildPrId(prNumber);

        // Check if there is a bounty to release
        const bountyAmount = await contract.getBountyAmount(prId);
        const alreadyPaid  = await contract.isBountyPaid(prId);

        if (bountyAmount === 0n || alreadyPaid) {
          logger.info(`Webhook: no pending bounty for ${prId}`);
          break;
        }

        const result = await executor.executeApprovedPr(prNumber);
        if (result.error) {
          logger.error(`Webhook: bounty release error — ${result.error}`);
        } else {
          logger.info(`Webhook: bounty released for PR #${prNumber} tx=${result.txHash}`);
        }
      }
      break;

    default:
      logger.debug(`Webhook: ignoring PR action "${action}"`);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`Webhook server listening on port ${PORT}`);
  logger.info(`POST http://localhost:${PORT}/webhook`);
});

module.exports = app; // for testing
