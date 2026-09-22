import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskProvider, useTasks } from './TaskContext';
import type { TaskDTO } from '../api/types';

vi.mock('../api/tasks', () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  deferTask: vi.fn(),
  archiveTask: vi.fn(),
}));
import * as tasksApi from '../api/tasks';

function task(id: string, subject: string, weight: number): TaskDTO {
  return {
    id,
    subject,
    priority: 'medium',
    dueDate: null,
    dueTime: null,
    isRepeatable: false,
    repeatPattern: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    projects: [],
    deferralCount: 0,
    weight,
  };
}

function Probe() {
  const { tasks, status, error, setSelection, completeTask } = useTasks();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ''}</span>
      <ol data-testid="list">
        {tasks.map((t) => (
          <li key={t.id}>{t.subject}</li>
        ))}
      </ol>
      <button onClick={() => setSelection({ kind: 'project', id: 'p1' })}>filter-p1</button>
      <button onClick={() => completeTask('t1').catch(() => {})}>complete-t1</button>
    </div>
  );
}

const renderProvider = () =>
  render(
    <TaskProvider>
      <Probe />
    </TaskProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TaskContext', () => {
  it('loads tasks on mount in server order', async () => {
    vi.mocked(tasksApi.listTasks).mockResolvedValue([
      task('t1', 'Top', 100),
      task('t2', 'Next', 50),
    ]);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    const items = screen.getByTestId('list').querySelectorAll('li');
    expect([...items].map((li) => li.textContent)).toEqual(['Top', 'Next']);
    expect(tasksApi.listTasks).toHaveBeenCalledWith({ projectId: null, includeCompleted: false });
  });

  it('refetches with project_id when a project is selected', async () => {
    vi.mocked(tasksApi.listTasks).mockResolvedValue([]);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    await userEvent.click(screen.getByText('filter-p1'));

    await waitFor(() =>
      expect(tasksApi.listTasks).toHaveBeenLastCalledWith({
        projectId: 'p1',
        includeCompleted: false,
      }),
    );
  });

  it('refetches after a completion mutation', async () => {
    vi.mocked(tasksApi.listTasks).mockResolvedValue([task('t1', 'Top', 100)]);
    vi.mocked(tasksApi.completeTask).mockResolvedValue({
      ...task('t1', 'Top', 100),
      completedAt: '2026-01-02T00:00:00.000Z',
      weightAtCompletion: 100,
      unlocked: [],
    });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    const before = vi.mocked(tasksApi.listTasks).mock.calls.length;

    await userEvent.click(screen.getByText('complete-t1'));

    expect(tasksApi.completeTask).toHaveBeenCalledWith('t1');
    await waitFor(() =>
      expect(vi.mocked(tasksApi.listTasks).mock.calls.length).toBe(before + 1),
    );
  });

  it('enters the error state when loading fails', async () => {
    vi.mocked(tasksApi.listTasks).mockRejectedValue(new Error('boom'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('error').textContent).not.toBe('');
  });

  it('throws when useTasks is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within a TaskProvider/);
    spy.mockRestore();
  });
});
