import { createContext, useContext } from 'react';

// Create a context for the theme, initialized to undefined.
export const ThemeContext = createContext(undefined);

/**
 * Custom hook to consume the theme context.
 * Throws an error if used outside of a ThemeProvider.
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
