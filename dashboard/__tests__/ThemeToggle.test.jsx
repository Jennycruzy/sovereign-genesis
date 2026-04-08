import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from '../../components/theme/ThemeToggle';
import { ThemeProvider } from '../../components/theme/ThemeProvider';

function renderWithProvider(ui) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('renders a button element', () => {
    renderWithProvider(<ThemeToggle />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('has an accessible aria-label', () => {
    renderWithProvider(<ThemeToggle />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe('Toggle theme');
  });

  it('renders a visible icon (sun or moon)', () => {
    renderWithProvider(<ThemeToggle />);
    const btn = screen.getByRole('button');
    // Button should have child content (an SVG icon)
    expect(btn.innerHTML.length).toBeGreaterThan(0);
  });

  it('toggles icon when clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ThemeToggle />);
    const btn = screen.getByRole('button');
    const before = btn.innerHTML;
    await user.click(btn);
    const after = btn.innerHTML;
    expect(before).not.toBe(after);
  });

  it('calls toggleTheme on click without errors', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ThemeToggle />);
    const btn = screen.getByRole('button');
    await expect(user.click(btn)).resolves.not.toThrow();
  });
});
