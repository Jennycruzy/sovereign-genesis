/**
 * /api/bounties — fetches open bounty issues from GitHub + on-chain status
 *
 * Status is derived entirely from on-chain events (BountyPosted, BountyReleased)
 * rather than contract mapping calls. Etherlink's RPC rejects eth_call on
 * string-key mappings with CALL_EXCEPTION, so events are the reliable source.
 */
export const dynamic = "force-dynamic"; // never cache — always fetch live data

import { ethers } from "ethers";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const GITHUB_REPO = "Jennycruzy/sovereign-genesis";
const BOUNTY_RE = /bounty[:\s]+([0-9]+(?:\.[0-9]+)?)\s*xtz/i;
const PR_RE = /pr[:\s]+(?:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+))?#(\d+)/i;

// ── Module-level event caches (incremental getLogs) ───────────────────────────
const DEPLOY_BLOCK = 3661743;
let _releaseCache   = {};   // keccak256(prId) → { txHash, blockNumber, contributor, amountWei }
let _postedCache    = {};   // keccak256(prId) → { txHash, blockNumber, amountWei }
let _eventHighBlock = DEPLOY_BLOCK - 1;

function loadDeployment() {
  const candidates = [
    path.join(process.cwd(), "abi", "SovereignAgent.json"),
    path.join(process.cwd(), "..", "abi", "SovereignAgent.json"),
  ];
  const p = candidates.find(fs.existsSync);
  if (!p) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export async function GET() {
  try {
    // Fetch GitHub issues with Bounty label (open + closed)
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/issues?labels=Bounty&state=all&per_page=50`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ bounties: [], error: "GitHub API error" });
    }

    const issues = await res.json();

    // Load contract deployment for event fetching
    const deployment = loadDeployment();
    let provider = null;

    if (deployment) {
      provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_ETHERLINK_RPC || "https://node.shadownet.etherlink.com"
      );

      // ── Incremental event fetch (BountyPosted + BountyReleased) ─────────────
      try {
        const latest = await provider.getBlockNumber();
        if (latest > _eventHighBlock) {
          const releaseSig = ethers.id("BountyReleased(string,address,uint256)");
          const postedSig  = ethers.id("BountyPosted(string,uint256)");
          const abiCoder   = ethers.AbiCoder.defaultAbiCoder();
          const fromBlock  = _eventHighBlock + 1;

          for (let from = fromBlock; from <= latest; from += 499) {
            const to = Math.min(from + 498, latest);

            const [releaseLogs, postedLogs] = await Promise.all([
              provider.getLogs({
                address: deployment.address,
                topics: [releaseSig],
                fromBlock: from,
                toBlock: to,
              }),
              provider.getLogs({
                address: deployment.address,
                topics: [postedSig],
                fromBlock: from,
                toBlock: to,
              }),
            ]);

            for (const log of releaseLogs) {
              const prIdHash = log.topics[1]; // keccak256(githubPrId)
              const [contributor, amount] = abiCoder.decode(["address", "uint256"], log.data);
              _releaseCache[prIdHash] = {
                txHash:      log.transactionHash,
                blockNumber: log.blockNumber,
                contributor: contributor,
                amountWei:   amount,
              };
            }

            for (const log of postedLogs) {
              const prIdHash = log.topics[1]; // keccak256(githubPrId)
              const [amount] = abiCoder.decode(["uint256"], log.data);
              // Only store if not already superseded by a release
              if (!_postedCache[prIdHash]) {
                _postedCache[prIdHash] = {
                  txHash:      log.transactionHash,
                  blockNumber: log.blockNumber,
                  amountWei:   amount,
                };
              }
            }
          }
          _eventHighBlock = latest;
        }
      } catch (err) {
        console.error("Bounties API: event fetch failed —", err.message);
        // Non-fatal: events just won't be fresher than last high-water mark
      }
    }

    // GitHub auth headers reused for comment fetching
    const ghHeaders = {
      Accept: "application/vnd.github.v3+json",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
        : {}),
    };

    const bounties = await Promise.all(
      issues
        .filter((issue) => !issue.pull_request) // skip PRs listed as issues
        .map(async (issue) => {
          const body = issue.body || "";
          const rewardMatch = body.match(BOUNTY_RE);
          const prMatch     = body.match(PR_RE);
          const reward      = rewardMatch ? parseFloat(rewardMatch[1]) : 0;
          const prRepo      = prMatch?.[1] || GITHUB_REPO;
          const prNum       = prMatch?.[2] ? parseInt(prMatch[2]) : issue.number;
          const prId        = `${prRepo}#${prNum}`;

          // ── Derive status from on-chain events ───────────────────────────
          const prIdHash   = ethers.keccak256(ethers.toUtf8Bytes(prId));
          const releaseInfo = _releaseCache[prIdHash];
          const postedInfo  = _postedCache[prIdHash];

          let onChainStatus   = "open";
          let paidTo          = null;
          let txHash          = null;
          let paymentBlock    = null;
          let onChainAmountWei = 0n;

          if (releaseInfo) {
            // BountyReleased event exists → confirmed paid
            onChainStatus    = "completed";
            paidTo           = releaseInfo.contributor;
            txHash           = releaseInfo.txHash;
            paymentBlock     = releaseInfo.blockNumber;
            onChainAmountWei = releaseInfo.amountWei;
          } else if (postedInfo) {
            // BountyPosted event exists but no release → escrowed on-chain
            onChainAmountWei = postedInfo.amountWei;
            onChainStatus    = "funded";
          }

          // ── Detect "resolved without payout" ────────────────────────────
          // GitHub issue closed + no BountyReleased event = no payment was made.
          let noPayoutNote = null;
          if (issue.state === "closed" && onChainStatus !== "completed") {
            onChainStatus = "no_payout";
            noPayoutNote  =
              "This issue was resolved but no Etherlink wallet address was provided — no XTZ was paid out.";
          }

          // ── Detect volatility-reduced bounty ────────────────────────────
          // If the on-chain escrowed amount is significantly less than the
          // requested amount, fetch the agent's volatility comment on the issue.
          let volatilityNote = null;
          if (onChainAmountWei > 0n && reward > 0) {
            const requestedWei = ethers.parseEther(String(reward));
            if (onChainAmountWei < (requestedWei * 95n / 100n)) {
              try {
                const commentsRes = await fetch(
                  `https://api.github.com/repos/${GITHUB_REPO}/issues/${issue.number}/comments?per_page=100`,
                  { headers: ghHeaders }
                );
                if (commentsRes.ok) {
                  const comments = await commentsRes.json();
                  for (const c of comments) {
                    const volMatch = c.body?.match(
                      /<!-- SOVEREIGN:VOLATILITY_REDUCED originalXtz=([\d.]+) advisedXtz=([\d.]+) -->/
                    );
                    if (volMatch) {
                      volatilityNote = `Bounty reduced from ${volMatch[1]} XTZ → ${volMatch[2]} XTZ by the agent due to high treasury volatility at posting time.`;
                      break;
                    }
                  }
                  if (!volatilityNote) {
                    const ratio = Number((onChainAmountWei * 100n) / requestedWei);
                    if (ratio >= 44 && ratio <= 56) {
                      volatilityNote = `Bounty reduced ~50% by the agent due to high treasury volatility at posting time.`;
                    }
                  }
                }
              } catch { /* non-fatal */ }
            }
          }

          // Extract task description
          const taskMatch = body.match(/##\s*task\s*\n([\s\S]*?)(?=\n##|\nbounty|\nPR:|$)/i);
          const description = taskMatch
            ? taskMatch[1].trim()
            : body.split("\n").filter(Boolean)[0] || issue.title;

          return {
            id:           issue.number,
            title:        issue.title,
            description,
            repoUrl:      `https://github.com/${GITHUB_REPO}`,
            issueUrl:     issue.html_url,
            reward:       `${reward} XTZ`,
            rewardRaw:    reward,
            prId,
            status:       onChainStatus,
            paidTo,
            txHash,
            paymentBlock,
            volatilityNote,
            noPayoutNote,
            createdAt:    issue.created_at,
            labels:       issue.labels.map((l) => l.name),
          };
        })
    );

    return NextResponse.json({ bounties });
  } catch (err) {
    console.error("Bounties API error:", err.message);
    return NextResponse.json({ bounties: [], error: err.message }, { status: 500 });
  }
}
