"use client";

/**
 * TreasuryFeed — Real-time contract event stream
 */

const EVENT_META = {
  Received:          { icon: "↓", color: "text-tezos-400",    label: "XTZ Received",      bg: "bg-tezos-900/30 border-tezos-700/40" },
  BountyPosted:      { icon: "◈", color: "text-sovereign-400", label: "Bounty Posted",     bg: "bg-sovereign-900/30 border-sovereign-700/40" },
  BountyReleased:    { icon: "✓", color: "text-emerald-400",  label: "Bounty Released",   bg: "bg-emerald-900/30 border-emerald-700/40" },
  SurplusInvested:   { icon: "↗", color: "text-amber-400",    label: "Surplus Invested",  bg: "bg-amber-900/30 border-amber-700/40" },
  LifeSupportUpdated:{ icon: "♥", color: "text-pink-400",     label: "Buffer Updated",    bg: "bg-pink-900/30 border-pink-700/40" },
};

export default function TreasuryFeed({ events = [], isLoading }) {
  return (
    <div className="card-glow rounded-xl border border-sovereign-800/50 bg-[#0a0a14]/80 p-6 backdrop-blur h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold tracking-widest uppercase text-sovereign-300">
          Treasury Activity
        </h2>
        {isLoading && (
          <span className="text-xs text-slate-500 animate-pulse">syncing…</span>
        )}
      </div>

      {/* Feed */}
      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
        {events.length === 0 ? (
          <div className="text-center text-slate-600 text-sm py-8">
            No events yet. Deploy contract and fund treasury.
          </div>
        ) : (
          events.map((ev, i) => <EventRow key={i} event={ev} />)
        )}
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const meta  = EVENT_META[event.name] || { icon: "•", color: "text-slate-400", label: event.name, bg: "bg-slate-800/30 border-slate-700/40" };
  const args  = event.args || {};

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${meta.bg} hover:brightness-110 transition-all`}>
      {/* Icon */}
      <span className={`text-lg font-bold ${meta.color} mt-0.5 shrink-0`}>{meta.icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-bold ${meta.color}`}>{meta.label}</span>
          {event.blockNumber && (
            <span className="text-xs text-slate-600">#{event.blockNumber}</span>
          )}
        </div>

        {/* Args */}
        <div className="mt-1 text-xs text-slate-400 space-y-0.5">
          {Object.entries(args).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-slate-600 shrink-0">{k}:</span>
              <span className="truncate font-mono">
                {typeof v === "object" && v !== null ? (v.hash || JSON.stringify(v)) : String(v)}
              </span>
            </div>
          ))}
        </div>

        {/* TX link */}
        {event.txHash && (
          <a
            href={`https://shadownet.explorer.etherlink.com/tx/${event.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-xs text-sovereign-600 hover:text-sovereign-400 font-mono truncate transition-colors"
          >
            tx: {event.txHash}
          </a>
        )}
      </div>
    </div>
  );
}
