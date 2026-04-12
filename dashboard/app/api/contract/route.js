/**
 * /api/contract — server-side data fetcher
 *
 * Returns on-chain state for the dashboard.
 * Runs server-side to avoid exposing the RPC URL to clients.
 *
 * Balance data is always live (3 fast RPC calls).
 * Historical events are cached in memory and only new blocks are fetched
 * incrementally — avoids hammering the RPC with hundreds of getLogs calls.
 */
export const dynamic = "force-dynamic"; // always run — never serve a build-time snapshot

import { ethers }  from "ethers";
import { NextResponse } from "next/server";
import fs   from "fs";
import path from "path";

// ── Module-level event cache (persists across requests in standalone mode) ────
const DEPLOY_BLOCK = 3661743;
let _eventCache     = [];        // parsed event objects
let _highWaterBlock = DEPLOY_BLOCK - 1; // highest block we've scanned
let _blockTsCache   = {};        // blockNumber → timestamp (ms)

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
  const deployment = loadDeployment();
  if (!deployment) return NextResponse.json(demoData());

  try {
    const provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_ETHERLINK_RPC || "https://node.shadownet.etherlink.com"
    );
    const contract = new ethers.Contract(deployment.address, deployment.abi, provider);

    // ── 1. Live balance (always fresh, 3 parallel calls) ─────────────────────
    const [treasuryWei, bufferWei, spendableWei] = await Promise.all([
      provider.getBalance(deployment.address),
      contract.lifeSupportBuffer(),
      contract.spendableBalance(),
    ]);

    // ── 2. Incremental event fetch ───────────────────────────────────────────
    const latest = await provider.getBlockNumber();
    const iface  = new ethers.Interface(deployment.abi);

    if (latest > _highWaterBlock) {
      const fromBlock = _highWaterBlock + 1;
      const rawLogs   = [];
      for (let from = fromBlock; from <= latest; from += 499) {
        const to = Math.min(from + 498, latest);
        const chunk = await provider.getLogs({
          address: deployment.address, fromBlock: from, toBlock: to,
        });
        rawLogs.push(...chunk);
      }

      // Parse new logs and fetch their block timestamps
      for (const log of rawLogs) {
        try {
          const parsed = iface.parseLog(log);
          // Batch-friendly: only fetch timestamp if not cached
          if (!_blockTsCache[log.blockNumber]) {
            try {
              const block = await provider.getBlock(log.blockNumber);
              _blockTsCache[log.blockNumber] = block ? block.timestamp * 1000 : null;
            } catch { /* fallback: no timestamp */ }
          }
          _eventCache.push({
            name:        parsed.name,
            args:        formatArgs(parsed.args, parsed.name),
            blockNumber: log.blockNumber,
            txHash:      log.transactionHash,
            timestamp:   _blockTsCache[log.blockNumber] || null,
          });
        } catch { /* skip unparsable logs */ }
      }

      _highWaterBlock = latest;
    }

    // Return the last 20 events, newest first
    const events = _eventCache.slice(-20).reverse();

    return NextResponse.json({
      address:    deployment.address,
      network:    deployment.network,
      treasury:   ethers.formatEther(treasuryWei),
      buffer:     ethers.formatEther(bufferWei),
      spendable:  ethers.formatEther(spendableWei),
      health:     treasuryWei <= bufferWei ? "CRITICAL" : "HEALTHY",
      events,
      timestamp:  Date.now(),
    });
  } catch (err) {
    console.error("Contract API error:", err.message);
    // Graceful degradation: return cached events with error flag
    return NextResponse.json(
      { error: err.message, events: _eventCache.slice(-20).reverse(), timestamp: Date.now() },
      { status: 500 }
    );
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function formatArgs(args, eventName) {
  switch (eventName) {
    case "BountyPosted":
      return { prId: typeof args[0] === "object" ? (args[0].hash || String(args[0])) : String(args[0]), amount: ethers.formatEther(args[1]) + " XTZ" };
    case "BountyReleased":
      return { prId: args[0], contributor: args[1], amount: ethers.formatEther(args[2]) + " XTZ" };
    case "SurplusInvested":
      return { amount: ethers.formatEther(args[0]) + " XTZ", target: args[1] };
    case "LifeSupportUpdated":
      return { amount: ethers.formatEther(args[0]) + " XTZ" };
    case "Received":
      return { from: args[0], amount: ethers.formatEther(args[1]) + " XTZ" };
    default:
      return {};
  }
}

function demoData() {
  return {
    address:   "0x0000…demo",
    network:   "demo",
    treasury:  "12.500",
    buffer:    "1.000",
    spendable: "11.500",
    health:    "HEALTHY",
    events: [
      { name: "Received",         args: { from: "0xDev1…", amount: "5.0 XTZ" },  blockNumber: 100, txHash: "0xabc…", timestamp: Date.now() - 3600000 },
      { name: "BountyPosted",     args: { prId: "owner/repo#1", amount: "2.0 XTZ" }, blockNumber: 101, txHash: "0xdef…", timestamp: Date.now() - 2400000 },
      { name: "BountyReleased",   args: { prId: "owner/repo#1", contributor: "0xContrib…", amount: "2.0 XTZ" }, blockNumber: 102, txHash: "0xghi…", timestamp: Date.now() - 1200000 },
      { name: "SurplusInvested",  args: { amount: "3.0 XTZ", target: "0xYield…" }, blockNumber: 103, txHash: "0xjkl…", timestamp: Date.now() - 600000 },
    ],
    timestamp: Date.now(),
    demo: true,
  };
}
