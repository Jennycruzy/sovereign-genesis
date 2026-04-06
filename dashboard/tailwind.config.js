/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neon purple palette
        sovereign: {
          50:  "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
        },
        // Tezos blue palette
        tezos: {
          50:  "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        neon: {
          purple: "#c026d3",
          blue:   "#0ea5e9",
          green:  "#10b981",
          red:    "#ef4444",
        },
      },
      backgroundImage: {
        "grid-dark": "linear-gradient(rgba(139,92,246,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.07) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
      animation: {
        pulse:     "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "glow":    "glow 2s ease-in-out infinite alternate",
        "scan":    "scan 3s linear infinite",
      },
      keyframes: {
        glow: {
          from: { boxShadow: "0 0 5px #8b5cf6, 0 0 10px #8b5cf6" },
          to:   { boxShadow: "0 0 20px #8b5cf6, 0 0 40px #8b5cf6, 0 0 60px #c026d3" },
        },
        scan: {
          "0%":   { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
