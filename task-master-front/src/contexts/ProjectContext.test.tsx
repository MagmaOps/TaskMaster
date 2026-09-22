import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectProvider, useProjects } from './ProjectContext';
import type { ProjectDTO } from '../api/types';

vi.mock('../api/projects', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  reorderProjects: vi.fn(),
}));
import * as projectsApi from '../api/projects';

function proj(id: string, name: string, order: number, isDefault = false): ProjectDTO {
  return { id, name, priorityOrder: order, isDefault, color: null, taskCount: 0, createdAt: '' };
}

function Probe() {
  const { projects, status, error, reorderProjects } = useProjects();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ''}</span>
      <ol data-testid="list">
        {projects.map((p) => (
          <li key={p.id}>{p.name}</li>
        ))}
      </ol>
      <button onClick={() => reorderProjects(['p2', 'p1']).catch(() => {})}>reorder</button>
    </div>
  );
}

const renderProvider = () =>
  render(
    <ProjectProvider>
      <Probe />
    </ProjectProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectContext', () => {
  it('loads projects in server order on mount', async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      proj('d0', 'Unassigned', 0, true),
      proj('p1', 'Work', 1),
      proj('p2', 'Home', 2),
    ]);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    const items = [...screen.getByTestId('list').querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Unassigned', 'Work', 'Home']);
  });

  it('sets projects from the reorder response', async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      proj('d0', 'Unassigned', 0, true),
      proj('p1', 'Work', 1),
      proj('p2', 'Home', 2),
    ]);
    vi.mocked(projectsApi.reorderProjects).mockResolvedValue([
      proj('d0', 'Unassigned', 0, true),
      proj('p2', 'Home', 1),
      proj('p1', 'Work', 2),
    ]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    await userEvent.click(screen.getByText('reorder'));

    await waitFor(() => {
      const items = [...screen.getByTestId('list').querySelectorAll('li')].map((li) => li.textContent);
      expect(items).toEqual(['Unassigned', 'Home', 'Work']);
    });
    expect(projectsApi.reorderProjects).toHaveBeenCalledWith(['p2', 'p1']);
  });

  it('reverts (re-fetches) and rethrows when reorder fails', async () => {
    const serverOrder = [proj('d0', 'Unassigned', 0, true), proj('p1', 'Work', 1), proj('p2', 'Home', 2)];
    vi.mocked(projectsApi.listProjects).mockResolvedValue(serverOrder);
    vi.mocked(projectsApi.reorderProjects).mockRejectedValue(new Error('nope'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    const loadsBefore = vi.mocked(projectsApi.listProjects).mock.calls.length;

    await userEvent.click(screen.getByText('reorder'));

    // A revert re-fetch happened, and the list is still the server order.
    await waitFor(() =>
      expect(vi.mocked(projectsApi.listProjects).mock.calls.length).toBe(loadsBefore + 1),
    );
    const items = [...screen.getByTestId('list').querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Unassigned', 'Work', 'Home']);
  });

  it('enters the error state when loading fails', async () => {
    vi.mocked(projectsApi.listProjects).mockRejectedValue(new Error('boom'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('error').textContent).not.toBe('');
  });

  it('throws when useProjects is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within a ProjectProvider/);
    spy.mockRestore();
  });
});
