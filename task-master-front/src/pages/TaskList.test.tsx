import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskList from './TaskList';
import type { Selection } from '../contexts/TaskContext';
import type { TaskDTO, User } from '../api/types';

// --- mocks ---
import type { ProjectDTO } from '../api/types';
let projectsList: ProjectDTO[] = [];
vi.mock('../contexts/ProjectContext', () => ({
  useProjects: () => ({ projects: projectsList, createProject: vi.fn() }),
}));

const showToast = vi.fn();
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }));

let user: User;
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user }) }));

const openQuickAdd = vi.fn();
const setSelection = vi.fn();
let ctx: {
  tasks: TaskDTO[];
  status: string;
  error: string | null;
  selection: Selection;
};
vi.mock('../contexts/TaskContext', () => ({
  useTasks: () => ({
    ...ctx,
    setSelection,
    loadTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    deferTask: vi.fn(),
    archiveTask: vi.fn(),
    isQuickAddOpen: false,
    openQuickAdd,
    closeQuickAdd: vi.fn(),
  }),
}));

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

const baseUser: User = {
  id: 'u1',
  email: 'a@b.com',
  displayName: 'Ada',
  avatarUrl: null,
  tier: 'free',
  currencyBalance: 0,
  settings: {
    project_priority_enabled: true,
    achievement_toasts_enabled: true,
    focus_mode_enabled: false,
    weight_visibility_enabled: false,
    theme: 'system',
    timezone: 'UTC',
  },
  isAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  user = { ...baseUser };
  projectsList = [];
  ctx = { tasks: [], status: 'ready', error: null, selection: { kind: 'all' } };
});

describe('TaskList', () => {
  it('renders the top task prominently and the rest below', async () => {
    ctx.tasks = [task('t1', 'Top task', 100), task('t2', 'Second', 50), task('t3', 'Third', 10)];
    render(<TaskList />);

    expect(await screen.findByText("What’s next?")).toBeInTheDocument();
    expect(screen.getByText('Top task')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });

  it('shows an empty-state CTA that opens Quick-Add', async () => {
    ctx.tasks = [];
    render(<TaskList />);
    const cta = await screen.findByRole('button', { name: /add your first task/i });
    await userEvent.click(cta);
    expect(openQuickAdd).toHaveBeenCalled();
  });

  it('in Focus mode shows only the top task', async () => {
    ctx.tasks = [task('t1', 'Only me', 100), task('t2', 'Hidden', 50)];
    ctx.selection = { kind: 'focus' };
    render(<TaskList />);
    expect(await screen.findByText('Only me')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('selecting a project pill sets the selection', async () => {
    // Projects now come from ProjectContext; provide one.
    projectsList = [
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
    ctx.tasks = [task('t1', 'Top', 100)];
    render(<TaskList />);

    const workPill = await screen.findByRole('button', { name: 'Work' });
    await userEvent.click(workPill);
    expect(setSelection).toHaveBeenCalledWith({ kind: 'project', id: 'p1' });
  });

  it('shows an error state with retry', async () => {
    ctx.status = 'error';
    ctx.error = 'Could not load your tasks.';
    render(<TaskList />);
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('seeds the focus selection on mount when focus_mode_enabled is on', async () => {
    user = { ...baseUser, settings: { ...baseUser.settings, focus_mode_enabled: true } };
    ctx.tasks = [task('t1', 'Top', 100)];
    render(<TaskList />);
    await screen.findByText('Top');
    expect(setSelection).toHaveBeenCalledWith({ kind: 'focus' });
  });

  it('does not seed focus when focus_mode_enabled is off', async () => {
    ctx.tasks = [task('t1', 'Top', 100)];
    render(<TaskList />);
    await screen.findByText('Top');
    expect(setSelection).not.toHaveBeenCalledWith({ kind: 'focus' });
  });

  it('shows task weight only for a premium user with weight visibility on', async () => {
    user = {
      ...baseUser,
      tier: 'premium',
      settings: { ...baseUser.settings, weight_visibility_enabled: true },
    };
    ctx.tasks = [task('t1', 'Weighted', 77)];
    render(<TaskList />);
    expect(await screen.findByText('77')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /weight breakdown/i })).toBeInTheDocument();
  });

  it('hides task weight for a free user', async () => {
    ctx.tasks = [task('t1', 'Weighted', 77)];
    render(<TaskList />);
    await screen.findByText('Weighted');
    expect(screen.queryByText('77')).toBeNull();
  });
});
