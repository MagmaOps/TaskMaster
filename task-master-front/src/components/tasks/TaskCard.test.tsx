import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCard } from './TaskCard';
import type { TaskDTO } from '../../api/types';

const task: TaskDTO = {
  id: 't1',
  subject: 'Write the report',
  priority: 'high',
  dueDate: null,
  dueTime: null,
  isRepeatable: false,
  repeatPattern: null,
  createdAt: '2026-09-20T10:00:00Z',
  completedAt: null,
  projects: [],
  deferralCount: 0,
  weight: 123,
  weightBreakdown: {
    base: 10,
    dueProximity: 20,
    project: 30,
    deferral: 40,
    repeatable: 23,
    total: 123,
  },
};

describe('TaskCard weight visibility', () => {
  it('hides the weight when showWeight is false', () => {
    render(<TaskCard task={task} onSelect={() => {}} />);
    expect(screen.queryByText('123')).toBeNull();
    expect(screen.queryByRole('button', { name: /weight breakdown/i })).toBeNull();
  });

  it('shows the weight + info icon when showWeight is true', () => {
    render(<TaskCard task={task} onSelect={() => {}} showWeight />);
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /weight breakdown/i })).toBeInTheDocument();
  });

  it('opens the breakdown modal without triggering onSelect', async () => {
    const onSelect = vi.fn();
    render(<TaskCard task={task} onSelect={onSelect} showWeight />);

    await userEvent.click(screen.getByRole('button', { name: /weight breakdown/i }));

    expect(screen.getByRole('dialog', { name: /weight breakdown/i })).toBeInTheDocument();
    // The breakdown total is shown; the card's onSelect must NOT have fired.
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
