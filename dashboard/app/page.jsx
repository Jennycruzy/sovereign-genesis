"use client";

import { useEffect, useState, useCallback } from "react";
import Header        from "../components/Header";
import AgentHealth   from "../components/AgentHealth";
import TreasuryFeed  from "../components/TreasuryFeed";
import DevLog        from "../components/DevLog";
import OpenBounties  from "../components/OpenBounties";
import "./mobile-enhancements.css";

const POLL_INTERVAL = parseInt(
  process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || "5000",
  10
);

export default function DashboardPage() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [lastPoll,  setLastPoll]  = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/contract", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastPoll(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header lastUpdated={lastPoll} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-4 md:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">

        {/* Error banner */}
        {error && (
          <div className="rounded-lg border border-red-700/40 bg-red-900/20 px-3 sm:px-4 py-3 text-xs sm:text-sm text-red-400">
            RPC error: {error} — displaying last known state
          </div>
        )}

        {/* Demo banner */}
        {data?.demo && (
          <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 sm:px-4 py-3 text-xs sm:text-sm text-amber-400 flex items-start sm:items-center gap-2">
            <span className="mt-0.5 sm:mt-0">⚠</span>
            <span>
              No deployment found. Showing demo data.
              Run <code className="bg-amber-900/40 px-1 rounded text-xs">npm run deploy:testnet</code> then
              copy <code className="bg-amber-900/40 px-1 rounded text-xs">abi/SovereignAgent.json</code> to the dashboard folder.
            </span>
          </div>
        )}

        {/* Row 1 — Agent health (full width) */}
        <AgentHealth data={data} />

        {/* Row 2 — Open Bounties */}
        <OpenBounties />

        {/* Row 3 — Feed + Dev Log stacked on mobile, side by side on lg */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <TreasuryFeed events={data?.events || []} isLoading={loading} />
          <DevLog />
        </div>

        {/* Row 4 — System stats strip */}
        <StatsStrip data={data} />
      </main>

      <footer className="border-t border-slate-900 px-4 sm:px-6 py-3 text-center text-[10px] sm:text-xs text-slate-700">
        SOVEREIGN-GENESIS · Autonomous AI · Tezos Etherlink EVM · Poll every {POLL_INTERVAL / 1000}s
      </footer>
    </div>
  );
}

function StatsStrip({ data }) {
  const events    = data?.events || [];
  const posted    = events.filter((e) => e.name === "BountyPosted").length;
  const released  = events.filter((e) => e.name === "BountyReleased").length;
  const invested  = events.filter((e) => e.name === "SurplusInvested").length;
  const received  = events.filter((e) => e.name === "Received").length;

  const stats = [
    { label: "XTZ Deposits",      value: received, color: "text-tezos-400" },
    { label: "Bounties Posted",   value: posted,   color: "text-sovereign-400" },
    { label: "Bounties Released", value: released, color: "text-emerald-400" },
    { label: "Surplus Invested",  value: invested, color: "text-amber-400" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 stats-strip">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-slate-800/60 bg-slate-900/50 p-3 sm:p-4 text-center touch-target"
        >
          <div className={`text-2xl sm:text-3xl font-bold font-mono ${s.color}`}>{s.value}</div>
          <div className="text-[10px] sm:text-xs text-slate-600 uppercase tracking-widest mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
