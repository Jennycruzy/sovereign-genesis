/**
 * /api/bounties — fetches open bounty issues from GitHub + on-chain status
 */
import { ethers } from "ethers";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const GITHUB_REPO = "Jennycruzy/sovereign-genesis";
const BOUNTY_RE = /bounty[:\s]+([0-9]+(?:\.[0-9]+)?)\s*xtz/i;
const PR_RE = /pr[:\s]+(?:([a-z0-9_.-]+\/[a-z0-9_.-]+))?#(\d+)/i;

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
    // Fetch GitHub issues with Bounty label
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/issues?labels=Bounty&state=all&per_page=50`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        next: { revalidate: 30 },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ bounties: [], error: "GitHub API error" });
    }

    const issues = await res.json();

    // Load contract for on-chain status
    const deployment = loadDeployment();
    let contract = null;
    let provider = null;
    let releaseMap = {}; // keccak256(prId) -> { txHash, blockNumber }

    if (deployment) {
      provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_ETHERLINK_RPC ||
          "https://node.shadownet.etherlink.com"
      );
      contract = new ethers.Contract(
        deployment.address,
        deployment.abi,
        provider
      );

      // Batch-fetch all BountyReleased events once so we can attach txHash to paid bounties
      try {
        const DEPLOY_BLOCK = 3661743;
        const latest = await provider.getBlockNumber();
        const releaseSig = ethers.id("BountyReleased(string,address,uint256)");
        for (let from = DEPLOY_BLOCK; from <= latest; from += 499) {
          const to = Math.min(from + 498, latest);
          const chunk = await provider.getLogs({
            address: deployment.address,
            topics: [releaseSig],
            fromBlock: from,
            toBlock: to,
          });
          for (const log of chunk) {
            const topic1 = log.topics[1]; // keccak256(githubPrId)
            releaseMap[topic1] = {
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
            };
          }
        }
      } catch {
        /* non-fatal — tx links just won't appear */
      }
    }

    const bounties = await Promise.all(
      issues
        .filter((issue) => !issue.pull_request) // skip PRs
        .map(async (issue) => {
          const body = issue.body || "";
          const rewardMatch = body.match(BOUNTY_RE);
          const prMatch = body.match(PR_RE);
          const reward = rewardMatch ? parseFloat(rewardMatch[1]) : 0;
          const prRepo = prMatch?.[1] || GITHUB_REPO;
          const prNum = prMatch?.[2] ? parseInt(prMatch[2]) : issue.number;
          const prId = `${prRepo}#${prNum}`;

          // Check on-chain status
          let onChainStatus = "open";
          let paidTo = null;
          let txHash = null;
          let paymentBlock = null;
          if (contract) {
            try {
              const paid = await contract.bountyPaid(prId);
              if (paid) {
                onChainStatus = "completed";
                paidTo = await contract.bountyClaimant(prId);
                // Look up the release tx from the pre-fetched event map
                const prIdHash = ethers.keccak256(ethers.toUtf8Bytes(prId));
                const releaseInfo = releaseMap[prIdHash];
                if (releaseInfo) {
                  txHash = releaseInfo.txHash;
                  paymentBlock = releaseInfo.blockNumber;
                }
              } else {
                const amt = await contract.bounties(prId);
                if (amt > 0n) onChainStatus = "funded";
              }
            } catch {
              // contract call failed, default to open
            }
          }

          // Only mark completed if on-chain bountyPaid is true
          // GitHub issue being closed does NOT mean the bounty was paid

          // Extract task description (first ## Task section or first paragraph)
          const taskMatch = body.match(
            /##\s*task\s*\n([\s\S]*?)(?=\n##|\nbounty|\nPR:|$)/i
          );
          const description = taskMatch
            ? taskMatch[1].trim()
            : body.split("\n").filter(Boolean)[0] || issue.title;

          return {
            id: issue.number,
            title: issue.title,
            description,
            repoUrl: `https://github.com/${GITHUB_REPO}`,
            issueUrl: issue.html_url,
            reward: `${reward} XTZ`,
            rewardRaw: reward,
            prId,
            status: onChainStatus,
            paidTo,
            txHash,
            paymentBlock,
            createdAt: issue.created_at,
            labels: issue.labels.map((l) => l.name),
          };
        })
    );

    return NextResponse.json({ bounties });
  } catch (err) {
    console.error("Bounties API error:", err.message);
    return NextResponse.json(
      { bounties: [], error: err.message },
      { status: 500 }
    );
  }
}
