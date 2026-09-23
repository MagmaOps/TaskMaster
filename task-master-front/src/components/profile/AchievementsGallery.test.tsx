import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AchievementsGallery } from './AchievementsGallery';
import type { AchievementRow } from '../../api/types';
import type { AsyncState } from './profileFormat';

function ready(data: AchievementRow[]): AsyncState<AchievementRow[]> {
  return { data, status: 'ready', error: null, retry: () => {} };
}

describe('AchievementsGallery', () => {
  it('renders an unlocked achievement with its title and unlock date', () => {
    render(
      <AchievementsGallery
        state={ready([
          { id: 'a1', type: 'first_task_completed', unlocked_at: '2026-09-20T10:00:00Z', data: {} },
        ])}
      />,
    );
    expect(screen.getByText('First Steps')).toBeInTheDocument();
    // Unlocked items carry an "Unlocked …" date line.
    expect(screen.getByText(/Unlocked/i)).toBeInTheDocument();
  });

  it('renders defined-but-not-unlocked achievements as locked (no date)', () => {
    render(<AchievementsGallery state={ready([])} />);
    // A known catalog item is present but marked Locked via aria-label.
    const locked = screen.getByLabelText(/First Steps\. Locked\./i);
    expect(locked).toBeInTheDocument();
    // Empty encouragement is shown when nothing is unlocked.
    expect(screen.getByText(/No achievements yet/i)).toBeInTheDocument();
  });

  it('renders an unknown unlocked type with a humanized-slug title', () => {
    render(
      <AchievementsGallery
        state={ready([
          { id: 'x1', type: 'some_new_badge', unlocked_at: '2026-09-21T10:00:00Z', data: {} },
        ])}
      />,
    );
    expect(screen.getByText('Some New Badge')).toBeInTheDocument();
  });
});
