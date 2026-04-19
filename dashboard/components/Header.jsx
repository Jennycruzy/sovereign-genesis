"use client";

import { useState, useEffect } from 'react';

export default function Header({ lastUpdated }) {
  const [isDark, setIsDark] = useState(true);
  const time = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : "—";

  // Load theme from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('sovereign-theme');
    if (stored !== null) {
      const darkMode = stored === 'dark';
      setIsDark(darkMode);
      document.documentElement.classList.toggle('dark', darkMode);
    } else {
      // Default to dark
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Toggle theme and persist
  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    localStorage.setItem('sovereign-theme', newDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', newDark);
  };

  return (
    <header className={`relative border-b backdrop-blur-sm px-6 py-4 transition-colors duration-300 ${
      isDark 
        ? 'border-sovereign-900/60 bg-[#050509]/90' 
        : 'border-light-border bg-light-card'
    }`}>
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
        {/* Logo / title */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center text-lg font-bold shadow-lg transition-colors duration-300 ${
              isDark
                ? 'bg-gradient-to-br from-sovereign-600 to-tezos-600'
                : 'bg-gradient-to-br from-sovereign-500 to-tezos-500'
            }`}
                 style={{ boxShadow: isDark ? "0 0 20px rgba(139,92,246,0.5)" : "0 0 10px rgba(139,92,246,0.3)" }}>
              S
            </div>
            <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 animate-pulse"
                 style={{ borderColor: isDark ? '#050509' : '#ffffff' }} />
          </div>

          <div>
            <h1 className="text-xl font-bold tracking-widest uppercase">
              <span className="text-neon-purple">Sovereign</span>
              <span className={isDark ? 'text-slate-500' : 'text-light-muted'}>-</span>
              <span className="text-neon-blue">Genesis</span>
            </h1>
            <p className={`text-xs tracking-widest ${
              isDark ? 'text-slate-600' : 'text-light-muted'
            }`}>
              AUTONOMOUS AI TREASURY · TEZOS ETHERLINK
            </p>
          </div>
        </div>

        {/* Status bar + Theme Toggle */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs">
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-300 ${
              isDark
                ? 'border-sovereign-700/50 bg-sovereign-900/30 text-slate-300 hover:bg-sovereign-800/50'
                : 'border-sovereign-300 bg-sovereign-50 text-light-text hover:bg-sovereign-100'
            }`}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            <span className="text-base">{isDark ? '☀️' : '🌙'}</span>
            <span className={`font-medium ${isDark ? 'text-slate-400' : 'text-light-muted'}`}>
              {isDark ? 'Light' : 'Dark'}
            </span>
          </button>

          <div className={`flex items-center gap-1.5 ${
            isDark ? 'text-slate-500' : 'text-light-muted'
          }`}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live</span>
          </div>
          <div className={`h-3 w-px ${isDark ? 'bg-slate-700' : 'bg-light-border'}`} />
          <span className={isDark ? 'text-slate-500' : 'text-light-muted'}>
            Updated: <span className={isDark ? 'text-slate-400' : 'text-light-text'}>{time}</span>
          </span>
          <div className={`h-3 w-px ${isDark ? 'bg-slate-700' : 'bg-light-border'}`} />
          <span className="text-sovereign-500">EVM · Chain 127823</span>
        </div>
      </div>
    </header>
  );
}