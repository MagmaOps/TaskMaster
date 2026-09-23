import type { ReactNode } from 'react';
import { Spinner } from '../common/Spinner';
import { Button } from '../common/Button';
import type { AsyncState } from './profileFormat';
import './profile.css';

interface ProfileSectionProps<T> {
  title: string;
  state: AsyncState<T>;
  /** Render the section body once data is ready (never null in this branch). */
  children: (data: T) => ReactNode;
}

/**
 * Shared shell for a Profile section: renders its title plus a per-section
 * loading / error-with-retry state, and delegates the ready state to `children`.
 * Each section is independent so one failing fetch never blanks the page.
 */
export function ProfileSection<T>({ title, state, children }: ProfileSectionProps<T>) {
  return (
    <section className="profile-section" aria-busy={state.status === 'loading'}>
      <h2 className="profile-section__title">{title}</h2>
      {state.status === 'loading' && <Spinner label={`Loading ${title.toLowerCase()}`} />}
      {state.status === 'error' && (
        <div className="profile-section__error" role="alert">
          <p>{state.error ?? `Couldn’t load ${title.toLowerCase()}.`}</p>
          <Button variant="secondary" onClick={state.retry}>
            Try again
          </Button>
        </div>
      )}
      {state.status === 'ready' && state.data !== null && children(state.data)}
    </section>
  );
}
