"use client";

/**
 * DevLog — Bounty / PR / contributor payment history
 * Derived from the BountyPosted + BountyReleased events in the feed.
 */
export default function DevLog({ events = [] }) {
  // Filter to bounty-related events only
  const bountyEvents = events.filter(
    (e) => e.name === "BountyPosted" || e.name === "BountyReleased"
  );

  // Build a combined log: for each PR seen, show its full lifecycle
  const byPr = {};
  for (const ev of bountyEvents) {
    const prId = ev.args?.prId || "unknown";
    if (!byPr[prId]) byPr[prId] = { prId, posted: null, released: null };
    if (ev.name === "BountyPosted")   byPr[prId].posted   = ev;
    if (ev.name === "BountyReleased") byPr[prId].released = ev;
  }

  const entries = Object.values(byPr).reverse();

  return (
    <div className="card-glow rounded-xl border border-sovereign-800/50 bg-[#0a0a14]/80 p-6 backdrop-blur">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-lg font-bold tracking-widest uppercase text-sovereign-300">
          Development Log
        </h2>
        <span className="text-xs bg-sovereign-900/50 text-sovereign-400 border border-sovereign-700/40 px-2 py-0.5 rounded">
          {entries.length} bounties
        </span>
      </div>

      {/* Table */}
      {entries.length === 0 ? (
        <div className="text-center text-slate-600 text-sm py-6">
          No bounties yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-600 uppercase tracking-widest border-b border-slate-800">
                <th className="pb-2 pr-4">PR</th>
                <th className="pb-2 pr-4">Amount</th>
                <th className="pb-2 pr-4">Contributor</th>
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {entries.map((e) => (
                <BountyRow key={e.prId} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BountyRow({ entry }) {
  const paid = !!entry.released;
  const amount = entry.released?.args?.amount || entry.posted?.args?.amount || "—";
  const contributor = entry.released?.args?.contributor || "—";
  const block = entry.released?.blockNumber || entry.posted?.blockNumber;
  const ts = entry.released?.timestamp || entry.posted?.timestamp;
  const timeStr = ts ? new Date(ts).toLocaleString() : "—";

  return (
    <tr className="hover:bg-slate-900/30 transition-colors">
      <td className="py-2.5 pr-4 font-mono text-xs text-sovereign-400 truncate max-w-[140px]">
        {entry.prId}
      </td>
      <td className="py-2.5 pr-4 text-neon-blue font-bold font-mono">
        {amount}
      </td>
      <td className="py-2.5 pr-4 font-mono text-xs text-slate-400 truncate max-w-[140px]">
        {contributor !== "—"
          ? <span className="text-tezos-400">{contributor}</span>
          : <span className="text-slate-600">pending</span>
        }
      </td>
      <td className="py-2.5 pr-4 text-xs text-slate-500 whitespace-nowrap">
        {timeStr}
      </td>
      <td className="py-2.5">
        <div className="flex items-center gap-2">
          {paid ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 px-2 py-0.5 rounded">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              PAID
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/30 border border-amber-700/40 px-2 py-0.5 rounded">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              OPEN
            </span>
          )}
          {block && (
            <span className="text-xs text-slate-600">#{block}</span>
          )}
        </div>
      </td>
    </tr>
  );
}
