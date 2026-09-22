import { api, unwrap, normalizeError } from './client';
import type {
  CompleteTaskData,
  CreateTaskInput,
  DeferOption,
  TaskDTO,
  UpdateTaskInput,
} from './types';

/** Typed wrappers over the backend task endpoints (unwrapped, throwing ApiError). */

interface ListParams {
  projectId?: string | null;
  includeCompleted?: boolean;
}

export async function listTasks(params: ListParams = {}): Promise<TaskDTO[]> {
  try {
    const query: Record<string, string> = {};
    if (params.projectId) query.project_id = params.projectId;
    query.include_completed = String(params.includeCompleted ?? false);
    const res = await api.get<{ success: true; data: TaskDTO[] }>('/tasks', { params: query });
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function createTask(input: CreateTaskInput): Promise<TaskDTO> {
  try {
    const res = await api.post<{ success: true; data: TaskDTO }>('/tasks', input);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<TaskDTO> {
  try {
    const res = await api.put<{ success: true; data: TaskDTO }>(`/tasks/${id}`, input);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function completeTask(id: string): Promise<CompleteTaskData> {
  try {
    const res = await api.put<{ success: true; data: CompleteTaskData }>(`/tasks/${id}/complete`);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function deferTask(id: string, option: DeferOption): Promise<TaskDTO> {
  try {
    const res = await api.put<{ success: true; data: TaskDTO }>(`/tasks/${id}/defer`, { option });
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function archiveTask(id: string): Promise<void> {
  try {
    await api.delete(`/tasks/${id}`);
  } catch (err) {
    throw normalizeError(err);
  }
}
