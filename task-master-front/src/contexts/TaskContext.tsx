import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as tasksApi from '../api/tasks';
import { normalizeError } from '../api/client';
import type {
  CompleteTaskData,
  CreateTaskInput,
  DeferOption,
  TaskDTO,
  UpdateTaskInput,
} from '../api/types';

export type TaskStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Which view the selector row has active. Focus = show only the top task of All. */
export type Selection = { kind: 'focus' } | { kind: 'all' } | { kind: 'project'; id: string };

interface TaskContextValue {
  tasks: TaskDTO[];
  status: TaskStatus;
  error: string | null;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  loadTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<TaskDTO>;
  updateTask: (id: string, input: UpdateTaskInput) => Promise<TaskDTO>;
  completeTask: (id: string) => Promise<CompleteTaskData>;
  deferTask: (id: string, option: DeferOption) => Promise<TaskDTO>;
  archiveTask: (id: string) => Promise<void>;
  // Quick-Add modal control (shared by BottomNav + and empty-state CTA).
  isQuickAddOpen: boolean;
  openQuickAdd: () => void;
  closeQuickAdd: () => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

/** The project id to fetch for a selection ('focus' and 'all' fetch the full active set). */
function projectIdForSelection(sel: Selection): string | null {
  return sel.kind === 'project' ? sel.id : null;
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [status, setStatus] = useState<TaskStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelectionState] = useState<Selection>({ kind: 'all' });
  const [isQuickAddOpen, setQuickAddOpen] = useState(false);

  // Always fetch for the latest selection even if it changed mid-flight.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const loadTasks = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const data = await tasksApi.listTasks({
        projectId: projectIdForSelection(selectionRef.current),
        includeCompleted: false,
      });
      setTasks(data);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(normalizeError(err).message);
    }
  }, []);

  const setSelection = useCallback((next: Selection) => {
    setSelectionState(next);
  }, []);

  // Re-fetch whenever the selection changes (project scope differs; focus/all share scope).
  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.kind, selection.kind === 'project' ? selection.id : null]);

  // Mutations re-fetch so the server-owned weight order stays correct.
  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      const created = await tasksApi.createTask(input);
      await loadTasks();
      return created;
    },
    [loadTasks],
  );

  const updateTask = useCallback(
    async (id: string, input: UpdateTaskInput) => {
      const updated = await tasksApi.updateTask(id, input);
      await loadTasks();
      return updated;
    },
    [loadTasks],
  );

  const completeTask = useCallback(
    async (id: string) => {
      const result = await tasksApi.completeTask(id);
      await loadTasks();
      return result;
    },
    [loadTasks],
  );

  const deferTask = useCallback(
    async (id: string, option: DeferOption) => {
      const result = await tasksApi.deferTask(id, option);
      await loadTasks();
      return result;
    },
    [loadTasks],
  );

  const archiveTask = useCallback(
    async (id: string) => {
      await tasksApi.archiveTask(id);
      await loadTasks();
    },
    [loadTasks],
  );

  const openQuickAdd = useCallback(() => setQuickAddOpen(true), []);
  const closeQuickAdd = useCallback(() => setQuickAddOpen(false), []);

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks,
      status,
      error,
      selection,
      setSelection,
      loadTasks,
      createTask,
      updateTask,
      completeTask,
      deferTask,
      archiveTask,
      isQuickAddOpen,
      openQuickAdd,
      closeQuickAdd,
    }),
    [
      tasks,
      status,
      error,
      selection,
      setSelection,
      loadTasks,
      createTask,
      updateTask,
      completeTask,
      deferTask,
      archiveTask,
      isQuickAddOpen,
      openQuickAdd,
      closeQuickAdd,
    ],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTasks(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) {
    throw new Error('useTasks must be used within a TaskProvider');
  }
  return ctx;
}
