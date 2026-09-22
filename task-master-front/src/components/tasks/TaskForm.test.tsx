import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskForm } from './TaskForm';
import { ApiError, type ProjectDTO, type TaskDTO } from '../../api/types';

const createProject = vi.fn();
vi.mock('../../contexts/ProjectContext', () => ({
  useProjects: () => ({ createProject }),
}));
const listProjects = vi.fn();
vi.mock('../../api/projects', () => ({
  listProjects: () => listProjects(),
}));

const projects: ProjectDTO[] = [
  { id: 'd0', name: 'Unassigned', priorityOrder: 0, isDefault: true, color: null, taskCount: 0, createdAt: '' },
  { id: 'p1', name: 'Work', priorityOrder: 1, isDefault: false, color: '#4f46e5', taskCount: 0, createdAt: '' },
];

// An Unassigned task: the backend includes the default project in task.projects.
const unassignedTask: TaskDTO = {
  id: 't1',
  subject: 'Loose task',
  priority: 'medium',
  dueDate: null,
  dueTime: null,
  isRepeatable: false,
  repeatPattern: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  projects: [{ id: 'd0', name: 'Unassigned', priorityOrder: 0, color: null }],
  deferralCount: 0,
  weight: 5,
};

function renderForm(overrides: Partial<Parameters<typeof TaskForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskForm
      projects={projects}
      submitLabel="Save changes"
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
  return { onSubmit };
}

beforeEach(() => {
  vi.clearAllMocks();
  listProjects.mockResolvedValue(projects);
});

describe('TaskForm project save flow', () => {
  it('does NOT send the default project id when modifying an Unassigned task', async () => {
    const { onSubmit } = renderForm({ initialTask: unassignedTask });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].projectIds).toEqual([]);
  });

  it('creates a pending project (random palette color) then submits with its id', async () => {
    createProject.mockResolvedValue({
      id: 'new1',
      name: 'Garden',
      priorityOrder: 1,
      isDefault: false,
      color: '#10b981',
      taskCount: 0,
      createdAt: '',
    });
    const { onSubmit } = renderForm();

    await userEvent.type(screen.getByLabelText(/what needs doing/i), 'Water plants');
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    await userEvent.type(screen.getByRole('combobox'), 'Garden{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    const createArg = createProject.mock.calls[0][0];
    expect(createArg.name).toBe('Garden');
    expect(createArg.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].projectIds).toEqual(['new1']);
  });

  it('reconciles a 409 conflict to the existing project id and still submits', async () => {
    createProject.mockRejectedValue(new ApiError('CONFLICT', 'exists', 409));
    // Reconcile: the "new" name already exists as a real project.
    listProjects.mockResolvedValue([
      ...projects,
      { id: 'px', name: 'Garden', priorityOrder: 2, isDefault: false, color: null, taskCount: 0, createdAt: '' },
    ]);
    const { onSubmit } = renderForm();

    await userEvent.type(screen.getByLabelText(/what needs doing/i), 'Water');
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    await userEvent.type(screen.getByRole('combobox'), 'garden{Enter}'); // case-insensitive
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].projectIds).toEqual(['px']);
  });

  it('aborts submit and shows a message when project creation fails (limit)', async () => {
    createProject.mockRejectedValue(
      new ApiError('VALIDATION_ERROR', 'You can have a maximum of 20 projects', 400),
    );
    const { onSubmit } = renderForm();

    await userEvent.type(screen.getByLabelText(/what needs doing/i), 'Water');
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    await userEvent.type(screen.getByRole('combobox'), 'Garden{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/maximum of 20 projects/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    // Chips preserved so the user can adjust.
    expect(screen.getByText('Garden')).toBeInTheDocument();
  });

  it('assigning an existing project (via suggestion) submits only that id', async () => {
    const { onSubmit } = renderForm({ initialTask: unassignedTask });
    await userEvent.click(screen.getByRole('button', { name: /more options/i }));
    await userEvent.type(screen.getByRole('combobox'), 'work{Enter}'); // matches existing 'Work'
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].projectIds).toEqual(['p1']);
    expect(createProject).not.toHaveBeenCalled();
  });
});
