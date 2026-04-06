"use client";

export default function Header({ lastUpdated }) {
  const time = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : "—";

  return (
    <header className="relative border-b border-sovereign-900/60 bg-[#050509]/90 backdrop-blur-sm px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* Logo / title */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-sovereign-600 to-tezos-600 flex items-center justify-center text-lg font-bold shadow-lg"
                 style={{ boxShadow: "0 0 20px rgba(139,92,246,0.5)" }}>
              S
            </div>
            <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-[#050509] animate-pulse" />
          </div>

          <div>
            <h1 className="text-xl font-bold tracking-widest uppercase">
              <span className="text-neon-purple">Sovereign</span>
              <span className="text-slate-500">-</span>
              <span className="text-neon-blue">Genesis</span>
            </h1>
            <p className="text-xs text-slate-600 tracking-widest">
              AUTONOMOUS AI TREASURY · TEZOS ETHERLINK
            </p>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <span>Updated: <span className="text-slate-400">{time}</span></span>
          <div className="h-3 w-px bg-slate-700" />
          <span className="text-sovereign-500">EVM · Chain 128123</span>
        </div>
      </div>
    </header>
  );
}
