import "./globals.css";
import { ThemeProvider } from "../components/theme/ThemeProvider"; // Import the ThemeProvider
import { Header } from "../components/Header"; // Import the new Header component

export const metadata = {
  title:       "SOVEREIGN-GENESIS | Autonomous AI Treasury",
  description: "Financial consciousness dashboard for the SOVEREIGN-GENESIS self-evolving AI agent on Tezos Etherlink",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en"> {/* Remove hardcoded "dark" class. Theme is now controlled by JS and ThemeProvider. */}
      {/* Script to prevent Flash Of Unstyled Content (FOUC).
          It reads localStorage for theme preference and applies 'dark' class
          to the html element immediately, before React hydrates. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            try {
              if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }
            } catch (_) {}
          `,
        }}
      />
      <body className="min-h-screen bg-white dark:bg-[#050509] text-slate-900 dark:text-slate-100 font-mono antialiased transition-colors duration-200">
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
          <ThemeProvider> {/* Wrap all children with ThemeProvider to give them access to theme context */}
            <Header /> {/* Add the new Header component containing the ThemeToggle */}
            {children}
          </ThemeProvider>
        </div>
      </body>
    </html>
  );
}
