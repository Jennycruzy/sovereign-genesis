import "./globals.css";

export const metadata = {
  title:       "SOVEREIGN-GENESIS | Autonomous AI Treasury",
  description: "Financial consciousness dashboard for the SOVEREIGN-GENESIS self-evolving AI agent on Tezos Etherlink",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-mono antialiased transition-colors duration-300 dark:bg-[#050509] dark:text-slate-100 bg-light-bg text-light-text">
        {/* Background grid */}
        <div
          className="fixed inset-0 pointer-events-none dark:bg-grid-dark bg-grid-light"
          style={{
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