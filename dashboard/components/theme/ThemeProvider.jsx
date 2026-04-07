'use client'; // This component uses client-side features like useState, useEffect, localStorage

import { useState, useEffect, useCallback } from 'react';
import { ThemeContext } from './ThemeContext';

export function ThemeProvider({ children }) {
  // Initialize theme state from localStorage or system preference.
  // This state will be managed client-side.
  const [theme, setTheme] = useState(() => {
    // Check if window and localStorage are available (i.e., running in browser)
    if (typeof window !== 'undefined' && window.localStorage) {
      const storedTheme = localStorage.getItem('theme');
      if (storedTheme) {
        return storedTheme;
      }
      // If no stored theme, check user's system preference
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    // Default to 'dark' during server-side rendering or if localStorage is unavailable
    return 'dark';
  });

  // Memoized callback to toggle the theme
  const toggleTheme = useCallback(() => {
    setTheme(prevTheme => {
      const newTheme = prevTheme === 'dark' ? 'light' : 'dark';
      // Persist the new theme to localStorage
      localStorage.setItem('theme', newTheme);
      return newTheme;
    });
  }, []);

  // Effect to apply the 'dark' class to the document's root element (<html>)
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // The class is already set by the FOUC script before hydration.
    // This useEffect ensures the class is updated if the theme changes post-hydration.
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
