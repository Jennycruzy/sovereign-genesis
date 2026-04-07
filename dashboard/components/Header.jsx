"use client";

import { useState, useEffect } from "react";

export default function Header({ lastUpdated }) {
  const [theme, setTheme] = useState("dark");
  const time = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : "—";

  useEffect(() => {
    const saved = localStorage.getItem("theme") || "dark";
    setTheme(saved);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    }
  };

  return (
    <header className="relative border-b border-sovereign-900/60 dark:bg-[#050509]/90 bg-white/90 backdrop-blur-sm px-6 py-4">
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
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <span>Updated: <span className="text-slate-400">{time}</span></span>
          <div className="h-3 w-px bg-slate-700" />
          <span className="text-sovereign-500">EVM · Chain 127823</span>
          <div className="h-3 w-px bg-slate-700" />
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center justify-center w-7 h-7 rounded-md border border-sovereign-700/40 hover:border-sovereign-500 hover:bg-sovereign-900/40 transition-all duration-200"
          >
            {theme === "dark" ? (
              /* Sun icon for switching to light */
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              /* Moon icon for switching to dark */
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-sovereign-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
