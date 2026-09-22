import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectManagement from './ProjectManagement';
import { ApiError, type ProjectDTO } from '../api/types';

// ProjectManagement reloads tasks after mutations that change task display.
const loadTasks = vi.fn().mockResolvedValue(undefined);
vi.mock('../contexts/TaskContext', () => ({
  useTasks: () => ({ loadTasks }),
}));

const createProject = vi.fn();
const updateProject = vi.fn();
const deleteProject = vi.fn();
const reorderProjects = vi.fn();
const loadProjects = vi.fn();

let ctx: { projects: ProjectDTO[]; status: string; error: string | null };
vi.mock('../contexts/ProjectContext', () => ({
  useProjects: () => ({
    ...ctx,
    loadProjects,
    createProject,
    updateProject,
    deleteProject,
    reorderProjects,
  }),
}));

function proj(id: string, name: string, order: number, isDefault = false): ProjectDTO {
  return { id, name, priorityOrder: order, isDefault, color: null, taskCount: 0, createdAt: '' };
}

const unassigned = proj('d0', 'Unassigned', 0, true);

beforeEach(() => {
  vi.clearAllMocks();
  ctx = { projects: [unassigned], status: 'ready', error: null };
});

describe('ProjectManagement', () => {
  it('renders Unassigned first with a Default badge and no edit/delete', () => {
    ctx.projects = [unassigned, proj('p1', 'Work', 1)];
    render(<ProjectManagement />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    // Unassigned has no edit/delete actions; the real project does.
    expect(screen.queryByLabelText('Edit Unassigned')).toBeNull();
    expect(screen.queryByLabelText('Delete Unassigned')).toBeNull();
    expect(screen.getByLabelText('Edit Work')).toBeInTheDocument();
  });

  it('shows an empty state with a CTA when there are no real projects', async () => {
    ctx.projects = [unassigned];
    render(<ProjectManagement />);
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create a project/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables New project at the 20-project limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => proj(`p${i}`, `P${i}`, i + 1));
    ctx.projects = [unassigned, ...many];
    render(<ProjectManagement />);
    expect(screen.getByRole('button', { name: /new project/i })).toBeDisabled();
    expect(screen.getByText(/maximum of 20 projects/i)).toBeInTheDocument();
  });

  it('creates a project via the form', async () => {
    createProject.mockResolvedValue(proj('p9', 'New', 1));
    render(<ProjectManagement />);
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    await userEvent.type(screen.getByLabelText(/project name/i), 'New');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: 'New', color: null }));
  });

  it('shows a friendly conflict message and preserves values on duplicate name', async () => {
    createProject.mockRejectedValue(new ApiError('CONFLICT', 'dupe', 409));
    render(<ProjectManagement />);
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    await userEvent.type(screen.getByLabelText(/project name/i), 'Work');
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/project name/i)).toHaveValue('Work');
  });

  it('edits a project (pre-filled) via the form', async () => {
    ctx.projects = [unassigned, proj('p1', 'Work', 1)];
    updateProject.mockResolvedValue(proj('p1', 'Работа', 1));
    render(<ProjectManagement />);
    await userEvent.click(screen.getByLabelText('Edit Work'));
    const nameInput = screen.getByLabelText(/project name/i);
    expect(nameInput).toHaveValue('Work');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Career');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('p1', { name: 'Career', color: null }),
    );
  });

  it('confirms, deletes a project, and reloads tasks so cards are not stale', async () => {
    ctx.projects = [unassigned, proj('p1', 'Work', 1)];
    deleteProject.mockResolvedValue(undefined);
    render(<ProjectManagement />);
    await userEvent.click(screen.getByLabelText('Delete Work'));
    expect(screen.getByText(/tasks are kept/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /delete project/i }));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('p1'));
    // The affected tasks must be re-fetched so their (now-detached) tag disappears.
    await waitFor(() => expect(loadTasks).toHaveBeenCalled());
  });
});
