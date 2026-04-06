import "./globals.css";

export const metadata = {
  title:       "SOVEREIGN-GENESIS | Autonomous AI Treasury",
  description: "Financial consciousness dashboard for the SOVEREIGN-GENESIS self-evolving AI agent on Tezos Etherlink",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#050509] text-slate-100 font-mono antialiased">
        {/* Background grid */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(139,92,246,0.05) 1px, transparent 1px)," +
              "linear-gradient(90deg, rgba(139,92,246,0.05) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Top accent line */}
        <div className="fixed top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-sovereign-500 to-transparent z-50" />

        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
