"use client";

import { useEffect, useState, useCallback } from "react";

const EXPLORER = "https://shadownet.explorer.etherlink.com";

export default function DevLog() {
  const [bounties, setBounties] = useState([]);
  const [loading, setLoading]   = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const res  = await fetch("/api/bounties", { cache: "no-store" });
      const json = await res.json();
      setBounties(json.bounties || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 30000);
    return () => clearInterval(id);
  }, [fetch_]);

  // Most-recently-created first
  const sorted = [...bounties].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  return (
    <div className="card-glow rounded-xl border border-sovereign-800/50 bg-[#0a0a14]/80 p-6 backdrop-blur h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-widest uppercase text-sovereign-300">
            Development Log
          </h2>
          <span className="text-xs bg-sovereign-900/50 text-sovereign-400 border border-sovereign-700/40 px-2 py-0.5 rounded">
            {bounties.length} bounties
          </span>
        </div>
        {loading && <span className="text-xs text-slate-500 animate-pulse">loading…</span>}
      </div>

      {/* Table */}
      {sorted.length === 0 && !loading ? (
        <div className="text-center text-slate-600 text-sm py-6">
          No bounties yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-600 uppercase tracking-widest border-b border-slate-800">
                <th className="pb-2 pr-4">Bounty</th>
                <th className="pb-2 pr-4">Reward</th>
                <th className="pb-2 pr-4">Contributor</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {sorted.map((b) => (
                <BountyRow key={b.id} bounty={b} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BountyRow({ bounty }) {
  const paid = bounty.status === "completed";
  const hasPaidTo = bounty.paidTo && bounty.paidTo !== "0x0000000000000000000000000000000000000000";

  return (
    <tr className="hover:bg-slate-900/30 transition-colors">
      {/* Title + PR id */}
      <td className="py-2.5 pr-4 max-w-[160px]">
        <a
          href={bounty.issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-sovereign-400 hover:text-sovereign-300 font-semibold line-clamp-1 transition-colors"
        >
          {bounty.title}
        </a>
        <div className="text-xs text-slate-600 font-mono mt-0.5">#{bounty.id}</div>
      </td>

      {/* Reward */}
      <td className="py-2.5 pr-4 text-neon-blue font-bold font-mono text-xs whitespace-nowrap">
        {bounty.reward}
      </td>

      {/* Contributor */}
      <td className="py-2.5 pr-4 max-w-[140px]">
        {hasPaidTo ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-mono text-emerald-400 truncate">
              {bounty.paidTo}
            </span>
            {bounty.txHash && (
              <a
                href={`${EXPLORER}/tx/${bounty.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-600 hover:text-sovereign-400 font-mono transition-colors"
              >
                verify tx →
              </a>
            )}
          </div>
        ) : (
          <span className="text-slate-600 text-xs">open</span>
        )}
      </td>

      {/* Status badge */}
      <td className="py-2.5">
        {paid ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 px-2 py-0.5 rounded w-fit">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            PAID
          </span>
        ) : bounty.status === "funded" ? (
          <span className="flex items-center gap-1 text-xs text-tezos-400 bg-tezos-900/30 border border-tezos-700/40 px-2 py-0.5 rounded w-fit">
            <span className="h-1.5 w-1.5 rounded-full bg-tezos-400 animate-pulse" />
            FUNDED
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/30 border border-amber-700/40 px-2 py-0.5 rounded w-fit">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            OPEN
          </span>
        )}
      </td>
    </tr>
  );
}
