"use client";

import { useEffect, useState, useCallback } from "react";

const STATUS_STYLE = {
  open:      { badge: "OPEN",       color: "text-amber-400",   bg: "bg-amber-900/30 border-amber-700/40",   dot: "bg-amber-400 animate-pulse" },
  funded:    { badge: "FUNDED",     color: "text-tezos-400",   bg: "bg-tezos-900/30 border-tezos-700/40",   dot: "bg-tezos-400 animate-pulse" },
  completed: { badge: "PAID",       color: "text-emerald-400", bg: "bg-emerald-900/30 border-emerald-700/40", dot: "bg-emerald-400" },
  no_payout: { badge: "NO PAYOUT",  color: "text-slate-400",   bg: "bg-slate-900/30 border-slate-700/40",   dot: "bg-slate-500" },
};

export default function OpenBounties() {
  const [bounties, setBounties] = useState([]);
  const [loading, setLoading]   = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/bounties", { cache: "no-store" });
      const json = await res.json();
      setBounties(json.bounties || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 30000); // refresh every 30s
    return () => clearInterval(id);
  }, [fetch_]);

  const open    = bounties.filter((b) => b.status !== "completed" && b.status !== "no_payout");
  const closed  = bounties.filter((b) => b.status === "completed");
  const noPayout = bounties.filter((b) => b.status === "no_payout");

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="card-glow rounded-xl border border-sovereign-800/50 bg-[#0a0a14]/80 p-6 backdrop-blur">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold tracking-widest uppercase text-sovereign-300">
              Open Bounties
            </h2>
            <span className="text-xs bg-sovereign-900/50 text-sovereign-400 border border-sovereign-700/40 px-2 py-0.5 rounded">
              {open.length} open
            </span>
            {closed.length > 0 && (
              <span className="text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-700/40 px-2 py-0.5 rounded">
                {closed.length} completed
              </span>
            )}
            {noPayout.length > 0 && (
              <span className="text-xs bg-slate-900/50 text-slate-400 border border-slate-700/40 px-2 py-0.5 rounded">
                {noPayout.length} no payout
              </span>
            )}
          </div>
          {loading && <span className="text-xs text-slate-500 animate-pulse">loading…</span>}
        </div>

        {/* How to submit */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4 mb-6">
          <h3 className="text-sm font-bold text-slate-300 mb-2">How to Contribute</h3>
          <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
            <li>Fork the repository and complete the bounty task</li>
            <li>Open a Pull Request against the main branch</li>
            <li>
              Include your payout wallet in the PR description:
              <code className="ml-1 bg-slate-800 text-tezos-400 px-1.5 py-0.5 rounded text-xs">
                Wallet: 0xYourAddress
              </code>
            </li>
            <li>The AI judge reviews your code automatically</li>
            <li>If approved, your PR is merged and XTZ is sent to your wallet</li>
          </ol>
        </div>

        {/* Bounty cards */}
        {bounties.length === 0 && !loading ? (
          <div className="text-center text-slate-600 text-sm py-8">
            No bounties posted yet. Watch this space.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bounties.map((b) => (
              <BountyCard key={b.id} bounty={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BountyCard({ bounty }) {
  const s = STATUS_STYLE[bounty.status] || STATUS_STYLE.open;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-[#0d0d1a]/80 p-5 flex flex-col gap-3 hover:border-sovereign-700/50 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-200 leading-snug">
            {bounty.title}
          </h3>
          <span className="text-xs text-slate-600 mt-0.5">#{bounty.id}</span>
        </div>
        <span className={`shrink-0 flex items-center gap-1.5 text-xs ${s.color} ${s.bg} border px-2 py-0.5 rounded`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {s.badge}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
        {bounty.description}
      </p>

      {/* Reward */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Reward:</span>
        <span className="text-sm font-bold font-mono text-neon-blue">{bounty.reward}</span>
        {bounty.volatilityNote && (
          <span className="text-xs text-amber-500 bg-amber-900/20 border border-amber-700/30 px-1.5 py-0.5 rounded">
            ⚡ volatility adjusted
          </span>
        )}
      </div>

      {/* Volatility explanation */}
      {bounty.volatilityNote && (
        <div className="rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-400 leading-relaxed">
          <span className="font-semibold">Why was this reduced?</span>{" "}
          {bounty.volatilityNote}
        </div>
      )}

      {/* No-payout explanation */}
      {bounty.status === "no_payout" && bounty.noPayoutNote && (
        <div className="rounded-md border border-slate-700/40 bg-slate-900/40 px-3 py-2 text-xs text-slate-400 leading-relaxed">
          <span className="font-semibold">Issue resolved — no payout:</span>{" "}
          {bounty.noPayoutNote}
        </div>
      )}

      {/* Paid to (if completed) */}
      {bounty.paidTo && bounty.paidTo !== "0x0000000000000000000000000000000000000000" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 uppercase tracking-wider">Paid to:</span>
            <span className="text-xs font-mono text-emerald-400 truncate">{bounty.paidTo}</span>
          </div>
          {bounty.txHash && (
            <a
              href={`https://shadownet.explorer.etherlink.com/tx/${bounty.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-slate-500 hover:text-sovereign-400 transition-colors truncate ml-[calc(theme(spacing.2)+3.5rem)] -mt-0.5"
            >
              verify tx →
            </a>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-slate-800/50">
        <a
          href={bounty.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center text-xs px-3 py-2 rounded-lg border border-sovereign-700 bg-sovereign-900/30 text-sovereign-300 hover:bg-sovereign-800/40 transition-colors"
        >
          {bounty.status === "completed"
            ? "View Repo"
            : bounty.status === "no_payout"
            ? "View Repo"
            : "Submit via GitHub PR"}
        </a>
        <a
          href={bounty.issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-2 rounded-lg border border-slate-700 bg-slate-900/30 text-slate-400 hover:text-slate-300 transition-colors"
        >
          Issue →
        </a>
      </div>
    </div>
  );
}
