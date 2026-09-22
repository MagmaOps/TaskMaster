import { useEffect, type ReactNode } from 'react';
import { useSettings } from '../../contexts/SettingsContext';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies the effective theme to <html data-theme>. For the `system` preference
 * it follows the OS setting live via matchMedia. The inline pre-paint script in
 * index.html sets the initial value to avoid a flash; this keeps it in sync
 * afterward as preference or OS setting changes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useSettings();

  useEffect(() => {
    const root = document.documentElement;

    const applyEffective = () => {
      const effective =
        theme === 'system'
          ? window.matchMedia(DARK_QUERY).matches
            ? 'dark'
            : 'light'
          : theme;
      root.dataset.theme = effective;
    };

    applyEffective();

    if (theme === 'system') {
      const mq = window.matchMedia(DARK_QUERY);
      const listener = () => applyEffective();
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, [theme]);

  return <>{children}</>;
}
