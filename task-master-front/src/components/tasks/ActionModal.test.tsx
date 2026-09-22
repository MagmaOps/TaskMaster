import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionModal } from './ActionModal';
import type { CompleteTaskData, TaskDTO } from '../../api/types';

// TaskForm (Modify view) uses ProjectContext for inline project creation.
vi.mock('../../contexts/ProjectContext', () => ({
  useProjects: () => ({ createProject: vi.fn() }),
}));
vi.mock('../../api/projects', () => ({ listProjects: vi.fn().mockResolvedValue([]) }));

const task: TaskDTO = {
  id: 't1',
  subject: 'Write report',
  priority: 'high',
  dueDate: null,
  dueTime: null,
  isRepeatable: false,
  repeatPattern: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  projects: [],
  deferralCount: 0,
  weight: 42,
};

function setup(overrides: Partial<Parameters<typeof ActionModal>[0]> = {}) {
  const props = {
    task,
    projects: [],
    onClose: vi.fn(),
    onComplete: vi.fn(),
    onDefer: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onCelebrate: vi.fn(),
    ...overrides,
  };
  render(<ActionModal {...props} />);
  return props;
}

const completeResult = (unlocked: CompleteTaskData['unlocked']): CompleteTaskData => ({
  ...task,
  completedAt: '2026-01-02T00:00:00.000Z',
  weightAtCompletion: 42,
  unlocked,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActionModal', () => {
  it('shows all five actions', () => {
    setup();
    expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^later$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^modify$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('completes and fires celebration when achievements unlock', async () => {
    const onComplete = vi.fn().mockResolvedValue(completeResult([{ type: 'first_task_completed' }]));
    const onCelebrate = vi.fn();
    const onClose = vi.fn();
    setup({ onComplete, onCelebrate, onClose });

    await userEvent.click(screen.getByRole('button', { name: /^complete$/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('t1'));
    expect(onCelebrate).toHaveBeenCalledWith(
      expect.objectContaining({ unlocked: [{ type: 'first_task_completed' }] }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the deferral options and defers with the chosen option', async () => {
    const onDefer = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    setup({ onDefer, onClose });

    await userEvent.click(screen.getByRole('button', { name: /^later$/i }));
    expect(screen.getByRole('button', { name: /later today/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /tomorrow/i }));

    await waitFor(() => expect(onDefer).toHaveBeenCalledWith('t1', 'tomorrow'));
    expect(onClose).toHaveBeenCalled();
  });

  it('requires confirmation before deleting', async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    setup({ onArchive });

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    // Not archived yet — confirmation shown.
    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByText(/delete .*write report/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('t1'));
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    setup({ onClose });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
