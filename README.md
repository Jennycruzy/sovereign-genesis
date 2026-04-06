# SOVEREIGN-GENESIS

**A financially sovereign, self-evolving AI agent on Tezos Etherlink (EVM)**

The agent manages its own on-chain XTZ treasury, posts bounties for code contributions, reviews pull requests with AI, auto-merges approved PRs, pays contributors, and invests surplus funds — all autonomously.

---

## Architecture

```
sovereign-genesis/
├── contracts/
│   └── SovereignAgent.sol       # Treasury + bounty escrow + yield investment
├── scripts/
│   └── deploy.js                # Hardhat deployment script
├── agent/
│   ├── index.js                 # Entry point / orchestrator
│   ├── contract.js              # ethers.js contract client
│   ├── scanner.js               # GitHub issue scanner (bounty posting)
│   ├── judge.js                 # AI PR review (CI + LLM)
│   ├── executor.js              # Auto-merge + bounty release
│   ├── financial.js             # Financial awareness logic
│   └── logger.js                # Winston logger
├── webhook/
│   └── server.js                # GitHub webhook listener (Express)
├── dashboard/                   # Next.js + TailwindCSS UI
│   ├── app/
│   │   ├── layout.jsx
│   │   ├── page.jsx             # Main dashboard
│   │   ├── globals.css
│   │   └── api/contract/route.js
│   └── components/
│       ├── Header.jsx
│       ├── AgentHealth.jsx      # Treasury health panel
│       ├── TreasuryFeed.jsx     # Real-time event stream
│       └── DevLog.jsx           # Bounty / PR log
├── abi/                         # Auto-generated after deploy
│   └── SovereignAgent.json
├── .env.example
├── hardhat.config.js
└── package.json
```

---

## Quick Start

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
# Fill in all values in .env
```

Key variables:
| Variable | Description |
|---|---|
| `ETHERLINK_RPC` | Etherlink Ghostnet RPC URL |
| `DEPLOYER_PRIVATE_KEY` | Wallet key for contract deployment |
| `AGENT_PRIVATE_KEY` | Wallet key the Node.js agent uses |
| `GITHUB_TOKEN` | GitHub PAT (repo + pull_request scopes) |
| `GITHUB_REPO` | `owner/repo` to watch |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for webhook HMAC |
| `OPENAI_API_KEY` | OpenAI API key for PR review |
| `YIELD_TARGET_ADDRESS` | Optional DeFi pool to invest surplus into |

### 3. Compile & deploy

```bash
# Compile contracts
npm run compile

# Deploy to Etherlink Ghostnet (testnet)
npm run deploy:testnet

# Deploy to Etherlink Mainnet
npm run deploy:mainnet
```

The deployment script writes `abi/SovereignAgent.json` with the address + ABI.

### 4. Fund the treasury

Send XTZ to the deployed contract address from any wallet.  
The contract accepts direct transfers via `receive()`.

### 5. Start the evolution engine

```bash
npm run agent
```

### 6. Start the webhook server

```bash
npm run webhook
# Listening on port 3001
```

Configure your GitHub repository webhook:
- **Payload URL**: `https://your-domain.com/webhook`
- **Content type**: `application/json`
- **Secret**: value of `GITHUB_WEBHOOK_SECRET`
- **Events**: `Pull requests`

### 7. Start the dashboard

```bash
cd dashboard
npm run dev   # http://localhost:3000
```

---

## Execution Flow

```
1.  User sends XTZ to contract address
2.  Agent treasury balance increases
3.  Scanner polls GitHub every 60s for issues labelled "Bounty"
4.  Scanner calls postBounty(prId, amount) on-chain
5.  Developer submits a PR referencing the issue
6.  Webhook fires → agent enqueues PR for review
7.  Judge checks CI status (GitHub Checks API)
8.  Judge sends diff to LLM → PASS or FAIL
9.  If PASS: agent auto-merges the PR via GitHub API
10. Agent reads contributor wallet from PR comment ("Wallet: 0x…")
11. Agent calls releaseBounty(prId, wallet) → XTZ transferred
12. Dashboard polls contract every 5s and updates live
13. If surplus > threshold: agent calls investSurplus(yieldTarget)
```

---

## Bounty Issue Format

Create a GitHub Issue with label **`Bounty`** and body:

```
## Task
Implement feature X

## Requirements
- …

Bounty: 2.5 XTZ
PR: owner/repo#42
```

## Contributor PR Format

The PR description or a comment must contain the contributor's wallet:

```
Wallet: 0xYourEtherlinkAddress
```

---

## Smart Contract

**`SovereignAgent.sol`** — deployed on Etherlink EVM (Solidity 0.8.20)

| Function | Access | Description |
|---|---|---|
| `postBounty(prId, amount)` | agent | Escrow XTZ for a PR |
| `releaseBounty(prId, contributor)` | agent | Pay contributor, mark paid |
| `investSurplus(target)` | agent | Forward surplus to DeFi protocol |
| `setLifeSupportBuffer(amount)` | agent | Update minimum balance |
| `setAgent(newAgent)` | agent | Rotate agent address |
| `spendableBalance()` | public | Treasury minus buffer |
| `treasuryBalance()` | public | Full contract balance |

Security: OpenZeppelin `ReentrancyGuard`, checks-effects-interactions, `onlyAgent` modifier.

---

## Financial Awareness Rules

| Condition | Action |
|---|---|
| `balance ≤ lifeSupportBuffer` | Block all bounty posting |
| Volatility > 20% | Halve bounty size |
| `spendable > threshold` | Call `investSurplus()` |

---

## Networks

| Network | Chain ID | RPC |
|---|---|---|
| Etherlink Ghostnet | 128123 | `https://node.ghostnet.etherlink.com` |
| Etherlink Mainnet  | 42793  | `https://node.mainnet.etherlink.com` |

---

## License

MIT
