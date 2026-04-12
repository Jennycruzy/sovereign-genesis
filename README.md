# SOVEREIGN-GENESIS

**A financially sovereign, self-evolving AI agent on Tezos Etherlink (EVM)**

SOVEREIGN-GENESIS is an autonomous AI system that manages its own on-chain XTZ treasury, posts development bounties, reviews pull requests using AI, auto-merges approved code, pays contributors directly in XTZ, and invests surplus funds — all without human intervention.

**Live Dashboard:** https://sovereign-genesis.duckdns.org

---

## What It Does

The agent runs a continuous loop:

1. Watches a GitHub repository for issues labelled **`Bounty`**
2. Locks XTZ into a smart contract escrow for each bounty
3. When a developer submits a matching PR, the AI judge reviews the code
4. If the PR passes review: it is auto-merged and the contributor is paid in XTZ on-chain
5. Any surplus treasury balance above a safety threshold is forwarded to a DeFi yield protocol
6. A live dashboard displays treasury health, open bounties, and the full payment history

The agent is designed to sustain itself: it won't post bounties if the treasury is too low, it reduces payouts during high volatility, and it grows its balance through yield.

---

## Architecture

```
sovereign-genesis/
├── contracts/
│   └── SovereignAgent.sol          # Treasury + bounty escrow + yield investment
├── scripts/
│   └── deploy.js                   # Hardhat deployment script
├── agent/
│   ├── index.js                    # Entry point — starts all loops
│   ├── contract.js                 # ethers.js wrapper for the smart contract
│   ├── scanner.js                  # Polls GitHub for Bounty issues, calls postBounty()
│   ├── judge.js                    # AI PR review (CI status + LLM diff analysis)
│   ├── executor.js                 # Auto-merges PRs, reads wallet, calls releaseBounty()
│   ├── financial.js                # Volatility detection, bounty scaling, surplus investment
│   ├── bounty-creator.js           # AI-powered autonomous bounty generation on new funds
│   └── logger.js                   # Winston logger
├── webhook/
│   └── server.js                   # GitHub webhook receiver (Express, port 3001)
├── dashboard/                      # Next.js 14 + TailwindCSS live dashboard
│   ├── app/
│   │   ├── page.jsx                # Main dashboard page
│   │   └── api/
│   │       ├── contract/route.js   # Polls on-chain state + event history
│   │       └── bounties/route.js   # GitHub issues + on-chain bounty status
│   └── components/
│       ├── Header.jsx              # Site header + last-updated indicator
│       ├── AgentHealth.jsx         # Treasury balance, buffer, health status
│       ├── TreasuryFeed.jsx        # Real-time on-chain event stream
│       ├── OpenBounties.jsx        # Bounty cards with status + payout verification
│       └── DevLog.jsx              # Full bounty history table with tx links
├── abi/
│   └── SovereignAgent.json         # Auto-generated after deploy (address + ABI)
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── hardhat.config.js
└── package.json
```

---

## How It Works — Full Execution Flow

```
1.  XTZ is deposited into the contract (anyone can fund it)
2.  Scanner polls GitHub every 60s for open issues with label "Bounty"
3.  Financial advisor checks treasury health + volatility
        → If balance ≤ lifeSupportBuffer: bounty is blocked
        → If volatility > 20%: bounty amount is halved
4.  Agent calls postBounty(prId, amount) — XTZ is locked in escrow
5.  Developer forks the repo, completes the task, opens a Pull Request
6.  Developer includes their payout wallet in the PR:
        Wallet: 0xYourEtherlinkAddress
7.  GitHub sends a webhook event to the agent (port 3001)
8.  Judge checks GitHub CI status for the PR
9.  Judge sends the PR diff to an LLM → verdict: PASS or FAIL
10. Agent posts the verdict as a review comment on the PR
11. If PASS:
        a. Agent merges the PR via GitHub API (squash merge)
        b. Agent reads wallet address from PR comments/description
        c. Agent calls releaseBounty(prId, wallet) on-chain
        d. XTZ is transferred directly to the contributor's wallet
12. Dashboard polls every 5s and updates all panels live
13. If surplus > investThreshold: agent calls investSurplus(yieldTarget)
14. BountyReleased event is indexed — tx hash is surfaced in the dashboard
        for public verification
```

---

## AI Reasoning — How OpenAI Powers the Agent

SOVEREIGN-GENESIS uses OpenAI (GPT-4o by default) in two places where the agent needs genuine reasoning, not just rule-following:

### 1. PR Review — Deciding Whether a Merge Is Accepted

When a developer submits a pull request, the agent cannot simply check if files changed — it needs to understand *whether the code is correct, secure, and actually solves the bounty task*. This is where the LLM is called.

**`agent/judge.js`** sends the full PR diff to GPT-4o with a security-aware system prompt. The model reasons about the code and returns a structured verdict:

```json
{ "verdict": "PASS", "reason": "All requirements implemented, tests present, no security issues." }
```

The LLM is instructed to **FAIL** a PR if it finds any of:
- Hardcoded secrets, API keys, or private keys
- Missing or broken unit tests
- Reentrancy vulnerabilities in Solidity
- Logic errors or backdoors
- The bounty requirements from the PR description were not implemented

Only a **PASS** verdict triggers the auto-merge and on-chain payment. A **FAIL** posts the reason as a review comment so the contributor knows what to fix. The agent never merges code it hasn't reasoned about.

```
PR opened → CI must pass → GPT-4o reviews diff → PASS/FAIL verdict posted
                                                        ↓ PASS only
                                               PR merged + XTZ paid on-chain
```

### 2. Autonomous Bounty Creation — Deciding What Work to Fund

When new funds arrive, the agent doesn't just wait for humans to create bounty issues — it uses GPT-4o to analyse the repository and generate meaningful improvement tasks autonomously.

**`agent/bounty-creator.js`** gathers context about the project (README, recent commits, open issues, file structure) and asks the LLM to produce actionable tasks with clear acceptance criteria:

```json
[
  {
    "title": "Add end-to-end tests for the bounty payment flow",
    "task": "Write integration tests covering the full path from PR approval to on-chain payment...",
    "difficulty": "medium"
  }
]
```

The agent then creates these as GitHub issues with the `Bounty` label and an appropriate XTZ amount based on available funds. The scanner picks them up and funds them on-chain. This closes the loop: funds arrive → agent thinks → bounties appear → developers contribute → XTZ paid out → cycle repeats.

---

## Smart Contract — `SovereignAgent.sol`

Deployed on Etherlink EVM (Solidity ^0.8.20, OpenZeppelin ReentrancyGuard).

| Function | Access | Description |
|---|---|---|
| `postBounty(prId, amount)` | agent only | Escrow XTZ for a GitHub PR |
| `releaseBounty(prId, contributor)` | agent only | Pay contributor and mark bounty paid |
| `investSurplus(target)` | agent only | Forward spendable surplus to a DeFi protocol |
| `setLifeSupportBuffer(amount)` | agent only | Update the minimum treasury reserve |
| `setAgent(newAgent)` | agent only | Rotate the agent wallet address |
| `spendableBalance()` | public view | Treasury balance minus life-support reserve |
| `treasuryBalance()` | public view | Full contract balance |

**Security model:** `onlyAgent` modifier on all write functions, reentrancy guard on fund transfers, checks-effects-interactions pattern throughout.

---

## Financial Awareness Rules

The agent applies these rules automatically before every bounty decision:

| Condition | Action |
|---|---|
| `treasury ≤ lifeSupportBuffer` | Block bounty posting entirely |
| Balance volatility > 20% | Reduce bounty by 50% |
| `spendableBalance > investThreshold` | Call `investSurplus()` to grow the treasury |

---

## Bounty Issue Format

Create a GitHub Issue with label **`Bounty`**:

```
## Task
Describe what needs to be built.

## Requirements
- Requirement 1
- Requirement 2

Bounty: 2.5 XTZ
PR: owner/repo#42
```

## Contributor PR Format

The PR description or any comment must include:

```
Wallet: 0xYourEtherlinkAddress
```

The agent reads this wallet address and sends payment directly on-chain upon merge.

---

## Dashboard

The live dashboard shows:

- **Agent Health** — treasury balance, life-support buffer, spendable balance, health status
- **Open Bounties** — all active and completed bounties with reward amounts, contributor wallets, and a `verify tx →` link to the on-chain payment
- **Treasury Activity** — real-time stream of all contract events (deposits, bounty posts, releases, yield investments)
- **Development Log** — full history of every bounty with status (OPEN / FUNDED / PAID) and verifiable payment links

---

## Setup & Deployment

### Prerequisites

- Node.js 20+
- A funded Etherlink wallet (for deployment + agent operations)
- GitHub Personal Access Token (`repo` + `pull_requests` scopes)
- OpenAI API key (for PR review)

### 1. Install dependencies

```bash
# Root (contracts + agent + webhook)
npm install

# Dashboard
cd dashboard && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in all values
```

| Variable | Description |
|---|---|
| `ETHERLINK_RPC` | Etherlink RPC URL |
| `DEPLOYER_PRIVATE_KEY` | Wallet key for deploying the contract |
| `AGENT_PRIVATE_KEY` | Wallet key the agent uses to operate the contract |
| `GITHUB_TOKEN` | GitHub PAT |
| `GITHUB_REPO` | `owner/repo` to watch |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook HMAC verification |
| `OPENAI_API_KEY` | OpenAI API key for the AI judge |
| `YIELD_TARGET_ADDRESS` | (Optional) DeFi pool address for surplus investment |
| `INVEST_THRESHOLD_RATIO` | (Optional) Fraction of buffer above which surplus is invested (default: 0.5) |

### 3. Compile and deploy the contract

```bash
npm run compile
npm run deploy:testnet   # Etherlink Ghostnet (testnet)
npm run deploy:mainnet   # Etherlink Mainnet
```

This generates `abi/SovereignAgent.json` with the deployed address and ABI. Copy it to `dashboard/abi/` as well.

### 4. Fund the treasury

Send XTZ to the deployed contract address from any wallet. The contract accepts direct transfers.

### 5. Run with Docker (recommended)

```bash
docker compose up -d
```

This starts three containers:
- `dashboard` — Next.js app on port 3000
- `webhook` — GitHub webhook receiver on port 3001
- `agent` — The autonomous agent loop

### 6. Run without Docker

```bash
# Terminal 1 — agent
npm run agent

# Terminal 2 — webhook
npm run webhook

# Terminal 3 — dashboard
cd dashboard && npm run dev
```

### 7. Configure GitHub Webhook

In your repository settings → Webhooks → Add webhook:

- **Payload URL**: `https://your-domain.com/webhook`
- **Content type**: `application/json`
- **Secret**: value of `GITHUB_WEBHOOK_SECRET`
- **Events**: Pull requests

---

## Netlify Deployment (Dashboard Only)

See the [Netlify Deployment Guide](#netlify-deployment-guide) section below for step-by-step instructions to deploy the dashboard as a static/serverless site.

---

## Networks

| Network | Chain ID | RPC |
|---|---|---|
| Etherlink Ghostnet | 128123 | `https://node.ghostnet.etherlink.com` |
| Etherlink Mainnet | 42793 | `https://node.mainnet.etherlink.com` |

Block explorer: `https://shadownet.explorer.etherlink.com`

---

## Netlify Deployment Guide

The dashboard is a Next.js 14 app and can be deployed to Netlify using the Next.js runtime adapter.

### Steps

**1. Push your code to GitHub** (you will do this manually — see note below)

**2. Connect to Netlify**

- Go to [netlify.com](https://netlify.com) → New site → Import from Git
- Select your `sovereign-genesis` repository
- Set the **Base directory** to `dashboard`
- Set the **Build command** to `npm run build`
- Set the **Publish directory** to `.next`

**3. Set environment variables in Netlify**

In Site settings → Environment variables, add:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_ETHERLINK_RPC` | Your Etherlink RPC URL |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | `5000` |
| `GITHUB_TOKEN` | Your GitHub PAT |

**4. Install the Next.js Netlify plugin**

In your `dashboard/` directory:

```bash
npm install -D @netlify/plugin-nextjs
```

Create `dashboard/netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

**5. Deploy**

Netlify will auto-deploy on every push to your main branch. The first deploy triggers automatically after connecting the repo.

> **Note:** The agent and webhook server cannot run on Netlify (they are long-running Node.js processes). For full autonomous operation, run those on a VPS or server separately. The Netlify deployment hosts only the dashboard UI.

---
## Team Info ##
This is a solo project. Built and deployed by https://x.com/jennyoliver57
## License

MIT
