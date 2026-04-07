'use client'; // This component uses client-side features like useTheme hook

import { useTheme } from './ThemeContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-md hover:bg-sovereign-700 dark:hover:bg-sovereign-300 transition-colors duration-200"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? (
        // Sun icon (currently in dark mode, offering to switch to light)
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-6 h-6 text-yellow-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.609-1.591l-1.591 1.591M3 12H5.25m-.386-6.364l1.591 1.591M12 12a3 3 0 110-6 3 3 0 010 6zm0 6a9 9 0 100-18 9 9 0 000 18z"
          />
        </svg>
      ) : (
        // Moon icon (currently in light mode, offering to switch to dark)
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-6 h-6 text-slate-600"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.718 9.718 0 0112 21.75c-3.617 0-6.903-1.292-9.48-3.414a2.25 2.25 0 010-3.007c.753-.59 1.446-1.182 2.1-1.761a.916.916 0 00-.032-1.536c-.524-.46-1.071-.902-1.633-1.332C.807 9.812-.475 7.147.288 4.882c.439-1.314 1.259-2.529 2.283-3.328.67-.534 1.4-.95 2.188-1.222.84-.298 1.76-.43 2.652-.43.504 0 1.002.046 1.492.138.868.16 1.745.393 2.593.682a.916.916 0 00-.012 1.536c-.53.465-1.077.907-1.64 1.338-.807.592-1.554 1.233-2.256 1.944a.916.916 0 00-.007 1.535l-.013.013c.489.43.993.856 1.509 1.272.766.613 1.527 1.258 2.28 1.942a.916.916 0 00-.005 1.536l-.014.013a.916.916 0 00-.012 1.536l.013.013.012-.013.013-.013c.53-.465 1.077-.907 1.64-1.338.807-.592 1.554-1.233 2.256-1.944a.916.916 0 00.007-1.535L21 9.944l.014-.013a.916.916 0 00.012-1.536l-.013-.013.012-.013.013-.013a.916.916 0 00.012-1.536l.013-.013.012-.013.013-.013z"
          />
        </svg>
      )}
    </button>
  );
}
