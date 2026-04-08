"use client";

/**
 * AgentHealth — Treasury balance, life-support buffer, surplus, health bar
 */
export default function AgentHealth({ data }) {
  if (!data) return <SkeletonPanel />;

  const treasury = parseFloat(data.treasury || 0);
  const buffer = parseFloat(data.buffer || 0);
  const spendable = parseFloat(data.spendable || 0);
  const isHealthy = data.health === "HEALTHY";

  // Health bar: percentage of treasury above buffer
  const healthPct =
    treasury > 0 ? Math.min(100, Math.round((spendable / treasury) * 100)) : 0;

  const healthColor =
    healthPct > 60 ? "#10b981" : healthPct > 30 ? "#f59e0b" : "#ef4444";

  return (
    <div className="card-glow rounded-xl border border-sovereign-800/50 bg-[#0a0a14]/80 p-6 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className={`h-3 w-3 rounded-full ${
              isHealthy
                ? "bg-emerald-400 animate-pulse"
                : "bg-red-500 animate-pulse"
            }`}
          />
          <h2 className="text-lg font-bold tracking-widest uppercase text-sovereign-300">
            Agent Health
          </h2>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded font-bold tracking-widest ${
            isHealthy
              ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/50"
              : "bg-red-900/50 text-red-400 border border-red-700/50"
          }`}
        >
          {data.health}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Metric
          label="Treasury Balance"
          value={`${treasury.toFixed(4)} XTZ`}
          color="text-neon-blue"
          icon="◈"
        />
        <Metric
          label="Life-Support Buffer"
          value={`${buffer.toFixed(4)} XTZ`}
          color="text-neon-purple"
          icon="♥"
        />
        <Metric
          label="Surplus / Spendable"
          value={`${spendable.toFixed(4)} XTZ`}
          color="text-neon-green"
          icon="◆"
        />
      </div>

      {/* Health bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Operational Capacity</span>
          <span>{healthPct}%</span>
        </div>
        <div className="h-3 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${healthPct}%`,
              background: `linear-gradient(90deg, ${healthColor}88, ${healthColor})`,
              boxShadow: `0 0 8px ${healthColor}99`,
            }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-600 mt-1">
          <span>0%</span>
          <span className="text-slate-500">
            Buffer: {buffer.toFixed(2)} XTZ
          </span>
          <span>100%</span>
        </div>
      </div>

      {/* Network info */}
      <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap gap-4 text-xs text-slate-500">
        <span>
          <span className="text-slate-400">Network: </span>
          <span className="text-tezos-400 uppercase">
            {data.network || "—"}
          </span>
        </span>
        <span className="truncate">
          <span className="text-slate-400">Contract: </span>
          <span className="text-sovereign-400 font-mono">
            {data.address || "—"}
          </span>
        </span>
        {data.demo && (
          <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/40">
            DEMO MODE
          </span>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, color, icon }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800/60">
      <div className="text-xs text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1">
        <span className={color}>{icon}</span>
        {label}
      </div>
      <div className={`text-xl font-bold ${color} font-mono`}>{value}</div>
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="card-glow rounded-xl border border-sovereign-800/50 bg-[#0a0a14]/80 p-6 animate-pulse">
      <div className="h-6 w-40 bg-slate-700 rounded mb-6" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 bg-slate-800 rounded-lg" />
        ))}
      </div>
      <div className="h-3 bg-slate-800 rounded-full" />
    </div>
  );
}
