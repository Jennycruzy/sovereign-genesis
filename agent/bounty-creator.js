/**
 * bounty-creator.js — Autonomous Bounty Generation
 *
 * When the agent has spendable funds and not enough open bounties,
 * it uses an LLM to analyse the repository and create GitHub issues
 * with meaningful improvement tasks. The scanner then picks them up
 * and posts them on-chain in its normal polling loop.
 *
 * Guardrails:
 *   - Won't create bounties if spendable < MIN_BOUNTY_XTZ
 *   - Won't create more than MAX_OPEN_BOUNTIES total
 *   - Creates at most MAX_PER_RUN per funding event
 *   - Deduplicates against existing open issue titles
 */
const { ethers }  = require("ethers");
const { Octokit } = require("@octokit/rest");
const OpenAI      = require("openai");
const contract    = require("./contract");
const logger      = require("./logger");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPO || "owner/repo").split("/");

// ── Tuneable limits ──────────────────────────────────────────────────────────

const MAX_OPEN_BOUNTIES = parseInt(process.env.MAX_OPEN_BOUNTIES || "5", 10);
const MAX_PER_RUN       = parseInt(process.env.MAX_BOUNTIES_PER_RUN || "2", 10);
const MIN_BOUNTY_XTZ    = parseFloat(process.env.MIN_BOUNTY_XTZ || "0.5");
const MAX_BOUNTY_XTZ    = parseFloat(process.env.MAX_BOUNTY_XTZ || "5.0");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getOpenBountyIssues() {
  try {
    const { data } = await octokit.issues.listForRepo({
      owner:    REPO_OWNER,
      repo:     REPO_NAME,
      labels:   "Bounty",
      state:    "open",
      per_page: 100,
    });
    return data.filter((i) => !i.pull_request);
  } catch (err) {
    logger.error(`BountyCreator: failed to list open bounties — ${err.message}`);
    return [];
  }
}

/**
 * Gather lightweight repo context for the LLM to reason about.
 */
async function getRepoContext() {
  const parts = [];

  // README
  try {
    const { data } = await octokit.repos.getReadme({
      owner: REPO_OWNER, repo: REPO_NAME,
      mediaType: { format: "raw" },
    });
    const readme = typeof data === "string" ? data : "";
    parts.push(`## README (first 2000 chars)\n${readme.slice(0, 2000)}`);
  } catch { /* no readme */ }

  // Recent commits
  try {
    const { data } = await octokit.repos.listCommits({
      owner: REPO_OWNER, repo: REPO_NAME, per_page: 10,
    });
    const commits = data.map((c) => `- ${c.commit.message.split("\n")[0]}`).join("\n");
    parts.push(`## Recent commits\n${commits}`);
  } catch { /* skip */ }

  // Open issues (all labels)
  try {
    const { data } = await octokit.issues.listForRepo({
      owner: REPO_OWNER, repo: REPO_NAME, state: "open", per_page: 20,
    });
    const issues = data
      .filter((i) => !i.pull_request)
      .map((i) => `- #${i.number}: ${i.title} [${i.labels.map((l) => l.name).join(", ")}]`)
      .join("\n");
    if (issues) parts.push(`## Open issues\n${issues}`);
  } catch { /* skip */ }

  // Top-level file listing
  try {
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER, repo: REPO_NAME, path: "",
    });
    if (Array.isArray(data)) {
      const tree = data.map((f) => `${f.type === "dir" ? "📁" : "📄"} ${f.name}`).join("\n");
      parts.push(`## Repository structure\n${tree}`);
    }
  } catch { /* skip */ }

  return parts.join("\n\n");
}

// ── LLM-powered idea generation ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the autonomous brain of SOVEREIGN-GENESIS, an AI treasury agent that manages on-chain bounties on Etherlink. Your job is to create meaningful, actionable GitHub bounty issues that improve the project.

Rules:
- Return ONLY valid JSON: an array of objects with { "title", "task", "difficulty" }
- "title": concise issue title (under 80 chars)
- "task": 2-4 sentence description of what the contributor must do, with clear acceptance criteria
- "difficulty": one of "easy", "medium", "hard"
- Tasks must be specific and implementable — not vague wishes
- Avoid duplicating any existing open issues (titles provided below)
- Focus on: bug fixes, tests, documentation, UX improvements, security hardening, new features, gas optimisation, CI/CD
- Do NOT suggest changes to the smart contract itself (it's already deployed)
- Return at most the requested number of ideas`;

async function generateBountyIdeas(repoContext, existingTitles, count, budgetPerBounty) {
  const userMessage = `
Repository context:
${repoContext}

Existing open issue titles (do NOT duplicate these):
${existingTitles.map((t) => `- ${t}`).join("\n") || "(none)"}

Generate exactly ${count} bounty idea(s). Each bounty will be worth approximately ${budgetPerBounty} XTZ.
Tailor difficulty to the bounty size — small bounties for easy tasks, larger for harder ones.
Return JSON array only.`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model:       process.env.OPENAI_MODEL || "gpt-4o",
      temperature: 0.7,
      max_tokens:  1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
    });

    const raw = completion.choices[0].message.content.trim();
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const ideas = JSON.parse(jsonStr);

    if (!Array.isArray(ideas)) throw new Error("LLM did not return an array");
    return ideas.slice(0, count);
  } catch (err) {
    logger.error(`BountyCreator: LLM generation failed — ${err.message}`);
    return [];
  }
}

// ── Issue creation ───────────────────────────────────────────────────────────

const DIFFICULTY_EMOJI = { easy: "🟢", medium: "🟡", hard: "🔴" };

async function createBountyIssue(title, task, bountyXtz, difficulty) {
  const emoji = DIFFICULTY_EMOJI[difficulty] || "🟡";
  const body =
    `## Task\n${task}\n\n` +
    `**Difficulty:** ${emoji} ${difficulty || "medium"}\n\n` +
    `Bounty: ${bountyXtz} XTZ\n` +
    `PR: ${REPO_OWNER}/${REPO_NAME}#TBD\n\n` +
    `---\n` +
    `_This bounty was autonomously created by the SOVEREIGN-GENESIS agent._\n` +
    `_Fork the repo, complete the task, and submit a PR with your wallet address._\n\n` +
    `\`\`\`\nWallet: 0xYourEtherlinkAddress\n\`\`\``;

  try {
    const { data: issue } = await octokit.issues.create({
      owner:  REPO_OWNER,
      repo:   REPO_NAME,
      title,
      body,
      labels: ["Bounty"],
    });

    // Update the PR reference now that we know the issue number
    const updatedBody = body.replace(
      `PR: ${REPO_OWNER}/${REPO_NAME}#TBD`,
      `PR: ${REPO_OWNER}/${REPO_NAME}#${issue.number}`
    );
    await octokit.issues.update({
      owner:        REPO_OWNER,
      repo:         REPO_NAME,
      issue_number: issue.number,
      body:         updatedBody,
    });

    logger.info(
      `BountyCreator: created issue #${issue.number} — "${title}" (${bountyXtz} XTZ, ${difficulty})`
    );
    return issue;
  } catch (err) {
    logger.error(`BountyCreator: failed to create issue "${title}" — ${err.message}`);
    return null;
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Check if conditions are right to create new bounties, and if so,
 * generate ideas with the LLM and post them as GitHub issues.
 * The scanner will fund them on-chain in its next polling pass.
 */
async function maybeCreateBounties() {
  // 1. Check spendable balance
  const spendableWei = await contract.getSpendableBalance();
  const spendableXtz = parseFloat(ethers.formatEther(spendableWei));

  if (spendableXtz < MIN_BOUNTY_XTZ) {
    logger.debug(`BountyCreator: spendable ${spendableXtz} XTZ below minimum — skipping`);
    return;
  }

  // 2. Check how many bounties are currently open
  const openBounties = await getOpenBountyIssues();
  if (openBounties.length >= MAX_OPEN_BOUNTIES) {
    logger.info(
      `BountyCreator: ${openBounties.length}/${MAX_OPEN_BOUNTIES} open bounties — no new ones needed`
    );
    return;
  }

  // 3. Determine budget
  const slotsAvailable = MAX_OPEN_BOUNTIES - openBounties.length;
  const count          = Math.min(slotsAvailable, MAX_PER_RUN);
  const perBountyXtz   = Math.min(
    Math.floor((spendableXtz / count) * 10) / 10,  // round down to 0.1
    MAX_BOUNTY_XTZ
  );

  if (perBountyXtz < MIN_BOUNTY_XTZ) {
    logger.debug(`BountyCreator: per-bounty budget too small (${perBountyXtz} XTZ) — skipping`);
    return;
  }

  logger.info(
    `BountyCreator: ${openBounties.length} open bounties, ${spendableXtz} XTZ spendable — ` +
    `generating ${count} new bounty idea(s) at ~${perBountyXtz} XTZ each`
  );

  // 4. Generate ideas
  const repoContext    = await getRepoContext();
  const existingTitles = openBounties.map((i) => i.title);
  const ideas          = await generateBountyIdeas(repoContext, existingTitles, count, perBountyXtz);

  if (ideas.length === 0) {
    logger.warn("BountyCreator: LLM returned no ideas");
    return;
  }

  // 5. Create issues
  for (const idea of ideas) {
    await createBountyIssue(
      idea.title,
      idea.task,
      perBountyXtz,
      idea.difficulty || "medium"
    );
  }

  logger.info(`BountyCreator: created ${ideas.length} new bounty issue(s)`);
}

module.exports = { maybeCreateBounties };
