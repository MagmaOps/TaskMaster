import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAddModal } from './QuickAddModal';
import type { ProjectDTO } from '../../api/types';

// TaskForm (inside QuickAddModal) uses ProjectContext for inline project creation.
vi.mock('../../contexts/ProjectContext', () => ({
  useProjects: () => ({ createProject: vi.fn() }),
}));
vi.mock('../../api/projects', () => ({ listProjects: vi.fn().mockResolvedValue([]) }));

const projects: ProjectDTO[] = [
  {
    id: 'd0',
    name: 'Unassigned',
    priorityOrder: 0,
    isDefault: true,
    color: null,
    taskCount: 0,
    createdAt: '',
  },
  {
    id: 'p1',
    name: 'Work',
    priorityOrder: 1,
    isDefault: false,
    color: null,
    taskCount: 0,
    createdAt: '',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QuickAddModal / TaskForm', () => {
  it('autofocuses the subject and keeps options collapsed initially', () => {
    render(<QuickAddModal open projects={projects} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByLabelText(/what needs doing/i)).toHaveFocus();
    expect(screen.queryByLabelText(/due date/i)).toBeNull();
  });

  it('blocks submit and shows an error when subject is empty', async () => {
    const onCreate = vi.fn();
    render(<QuickAddModal open projects={projects} onClose={vi.fn()} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(await screen.findByText(/subject is required/i)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('reveals weekday checkboxes when repeatable + weekly is chosen', async () => {
    render(<QuickAddModal open projects={projects} onClose={vi.fn()} onCreate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    await userEvent.click(screen.getByLabelText(/repeatable/i));
    await userEvent.click(screen.getByLabelText('Weekly'));
    expect(screen.getByLabelText('Mon')).toBeInTheDocument();
    expect(screen.getByLabelText('Fri')).toBeInTheDocument();
  });

  it('offers the project tag input and excludes the default from suggestions', async () => {
    render(<QuickAddModal open projects={projects} onClose={vi.fn()} onCreate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    const combo = screen.getByRole('combobox');
    // Typing a substring surfaces the real project but never the Unassigned default.
    await userEvent.type(combo, 'wo');
    expect(screen.getByRole('option', { name: /work/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /unassigned/i })).toBeNull();
  });

  it('submits a valid task with medium priority default and closes', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<QuickAddModal open projects={projects} onClose={onClose} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/what needs doing/i), 'Buy milk');
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Buy milk', priority: 'medium' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a server error and preserves entered values', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('Server said no'));
    render(<QuickAddModal open projects={projects} onClose={vi.fn()} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/what needs doing/i), 'Keep me');
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));

    expect(await screen.findByText(/server said no/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what needs doing/i)).toHaveValue('Keep me');
  });
});
