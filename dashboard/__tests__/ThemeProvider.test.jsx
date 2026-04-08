import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../components/theme/ThemeProvider';
import { useTheme } from '../../components/theme/ThemeContext';

// Helper component that consumes the theme context
function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button data-testid="toggle-btn" onClick={toggleTheme}>Toggle</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('renders children without crashing', () => {
    render(
      <ThemeProvider>
        <div data-testid="child">hello</div>
      </ThemeProvider>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('provides a default theme value to consumers', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    );
    const themeValue = screen.getByTestId('theme-value').textContent;
    expect(['dark', 'light']).toContain(themeValue);
  });

  it('toggleTheme switches between dark and light', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    );
    const initial = screen.getByTestId('theme-value').textContent;
    await user.click(screen.getByTestId('toggle-btn'));
    const after = screen.getByTestId('theme-value').textContent;
    expect(after).not.toBe(initial);
    const expected = initial === 'dark' ? 'light' : 'dark';
    expect(after).toBe(expected);
  });

  it('persists theme selection to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    );
    await user.click(screen.getByTestId('toggle-btn'));
    const stored = localStorage.getItem('theme');
    expect(stored).toBeTruthy();
  });

  it('applies the theme class to document.documentElement', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    );
    await user.click(screen.getByTestId('toggle-btn'));
    const theme = screen.getByTestId('theme-value').textContent;
    expect(document.documentElement.classList.contains(theme)).toBe(true);
  });

  it('throws when useTheme is called outside ThemeProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ThemeConsumer />)).toThrow(
      'useTheme must be used within a ThemeProvider'
    );
    spy.mockRestore();
  });
});
