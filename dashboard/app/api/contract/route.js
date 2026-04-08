/**
 * /api/contract — server-side data fetcher
 *
 * Returns on-chain state for the dashboard.
 * Runs server-side to avoid exposing the RPC URL to clients.
 */
export const dynamic = "force-dynamic"; // never cache — always fetch live chain data

import { ethers }  from "ethers";
import { NextResponse } from "next/server";
import fs   from "fs";
import path from "path";

function loadDeployment() {
  // Try local abi/ first (Docker build), then parent (dev mode)
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

  // If no deployment yet, return demo data so the UI renders
  if (!deployment) {
    return NextResponse.json(demoData());
  }

  try {
    const provider  = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_ETHERLINK_RPC || "https://node.shadownet.etherlink.com"
    );
    const contract  = new ethers.Contract(deployment.address, deployment.abi, provider);

    const [treasuryWei, bufferWei, spendableWei] = await Promise.all([
      provider.getBalance(deployment.address),
      contract.lifeSupportBuffer(),
      contract.spendableBalance(),
    ]);

    // Fetch all events since deployment in 499-block chunks (Shadownet RPC limit)
    const DEPLOY_BLOCK = 3661743;
    const latest  = await provider.getBlockNumber();
    const rawLogs = [];
    for (let from = DEPLOY_BLOCK; from <= latest; from += 499) {
      const to = Math.min(from + 498, latest);
      const chunk = await provider.getLogs({ address: deployment.address, fromBlock: from, toBlock: to });
      rawLogs.push(...chunk);
    }
    const iface   = new ethers.Interface(deployment.abi);

    const events = await Promise.all(
      rawLogs.map(async (log) => {
        try {
          const parsed = iface.parseLog(log);
          // Fetch block timestamp for the DevLog
          let timestamp = null;
          try {
            const block = await provider.getBlock(log.blockNumber);
            timestamp = block ? block.timestamp * 1000 : null; // ms
          } catch { /* fallback: no timestamp */ }
          return {
            name:        parsed.name,
            args:        formatArgs(parsed.args, parsed.name),
            blockNumber: log.blockNumber,
            txHash:      log.transactionHash,
            timestamp,
          };
        } catch {
          return null;
        }
      })
    );
    const filteredEvents = events
      .filter(Boolean)
      .slice(-20)
      .reverse();

    return NextResponse.json({
      address:    deployment.address,
      network:    deployment.network,
      treasury:   ethers.formatEther(treasuryWei),
      buffer:     ethers.formatEther(bufferWei),
      spendable:  ethers.formatEther(spendableWei),
      health:     treasuryWei <= bufferWei ? "CRITICAL" : "HEALTHY",
      events: filteredEvents,
      timestamp:  Date.now(),
    });
  } catch (err) {
    console.error("Contract API error:", err.message);
    return NextResponse.json(
      { error: err.message },
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
