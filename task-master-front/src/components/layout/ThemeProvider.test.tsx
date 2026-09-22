import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider, useSettings } from '../../contexts/SettingsContext';
import { ThemeProvider } from './ThemeProvider';

/** Controllable matchMedia mock so we can drive `system` theme resolution. */
function installMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener: (cb: () => void) => listeners.add(cb),
    removeListener: (cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => mql,
  });
  return {
    setDark(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

function ThemeControls() {
  const { theme, setTheme } = useSettings();
  return (
    <div>
      <span data-testid="pref">{theme}</span>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('system')}>system</button>
    </div>
  );
}

const renderThemed = () =>
  render(
    <SettingsProvider>
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>
    </SettingsProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theming', () => {
  it('defaults to system and follows the OS preference', () => {
    installMatchMedia(true); // OS is dark
    renderThemed();
    expect(screen.getByTestId('pref').textContent).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('updates live when the OS preference changes under system theme', () => {
    const mm = installMatchMedia(false); // OS light initially
    renderThemed();
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => mm.setDark(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies and persists an explicit theme selection', async () => {
    installMatchMedia(false);
    renderThemed();

    await userEvent.click(screen.getByText('dark'));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByTestId('pref').textContent).toBe('dark');
    expect(localStorage.getItem('tm_theme')).toBe('dark');
  });

  it('reads a persisted preference on mount', () => {
    localStorage.setItem('tm_theme', 'light');
    installMatchMedia(true); // OS dark, but stored pref is light -> light wins
    renderThemed();
    expect(screen.getByTestId('pref').textContent).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
