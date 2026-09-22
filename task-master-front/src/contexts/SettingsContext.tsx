import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemePreference } from '../api/types';

const THEME_STORAGE_KEY = 'tm_theme';

interface SettingsContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (private mode); fall through to default.
  }
  return 'system';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme());

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; the in-memory preference still applies.
    }
  }, []);

  // Keep storage in sync if the initial value was defaulted (no stored key yet).
  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_STORAGE_KEY) === null) {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
    } catch {
      // ignore
    }
  }, [theme]);

  const value = useMemo<SettingsContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}
