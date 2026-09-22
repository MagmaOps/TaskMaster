import { useCallback, useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, isGoogleConfigured } from '../config/env';

/**
 * Loads Google Identity Services (GIS) on demand and exposes a trigger that
 * resolves to a Google ID token. When VITE_GOOGLE_CLIENT_ID is empty the hook
 * reports `available: false` and does nothing (the Login page hides the button).
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdApi {
  initialize: (config: {
    client_id: string;
    callback: (resp: GoogleCredentialResponse) => void;
  }) => void;
  prompt: () => void;
}

function getGoogleId(): GoogleIdApi | undefined {
  return (window as unknown as { google?: { accounts?: { id?: GoogleIdApi } } }).google?.accounts
    ?.id;
}

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (getGoogleId()) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google script')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google script'));
    document.head.appendChild(script);
  });
}

interface UseGoogleSignIn {
  available: boolean;
  /** Opens the Google prompt and resolves to an ID token, or rejects on failure/cancel. */
  signIn: () => Promise<string>;
}

export function useGoogleSignIn(): UseGoogleSignIn {
  const available = isGoogleConfigured();
  const pendingResolve = useRef<((token: string) => void) | null>(null);
  const pendingReject = useRef<((err: Error) => void) | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    loadGisScript()
      .then(() => {
        if (cancelled) return;
        const googleId = getGoogleId();
        if (!googleId) return;
        googleId.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            if (resp.credential) {
              pendingResolve.current?.(resp.credential);
            } else {
              pendingReject.current?.(new Error('No credential returned'));
            }
            pendingResolve.current = null;
            pendingReject.current = null;
          },
        });
        setInitialized(true);
      })
      .catch(() => {
        // Leaving initialized=false means signIn() will reject cleanly.
      });
    return () => {
      cancelled = true;
    };
  }, [available]);

  const signIn = useCallback((): Promise<string> => {
    if (!available) return Promise.reject(new Error('Google sign-in is not configured'));
    const googleId = getGoogleId();
    if (!initialized || !googleId) {
      return Promise.reject(new Error('Google sign-in is not ready yet'));
    }
    return new Promise<string>((resolve, reject) => {
      pendingResolve.current = resolve;
      pendingReject.current = reject;
      googleId.prompt();
    });
  }, [available, initialized]);

  return { available, signIn };
}
