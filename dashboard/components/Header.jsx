'use client'; // This component renders client-side components like ThemeToggle

import { ThemeToggle } from "./theme/ThemeToggle";

/**
 * Renders the main dashboard header with the site title and a theme toggle.
 */
export function Header() {
  return (
    <header className="flex justify-between items-center p-4 bg-white dark:bg-[#050509] shadow-md dark:shadow-purple-900/50">
      <div className="flex items-center space-x-4">
        <h1 className="text-2xl font-bold text-sovereign-700 dark:text-sovereign-300">
          SOVEREIGN-GENESIS
        </h1>
        {/* Additional header content can be placed here */}
      </div>
      <div>
        <ThemeToggle />
      </div>
    </header>
  );
}
