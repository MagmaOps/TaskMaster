import { api, unwrap, normalizeError } from './client';
import type { CreateProjectInput, ProjectDTO, UpdateProjectInput } from './types';

export async function listProjects(): Promise<ProjectDTO[]> {
  try {
    const res = await api.get<{ success: true; data: ProjectDTO[] }>('/projects');
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function createProject(input: CreateProjectInput): Promise<ProjectDTO> {
  try {
    const res = await api.post<{ success: true; data: ProjectDTO }>('/projects', input);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectDTO> {
  try {
    const res = await api.put<{ success: true; data: ProjectDTO }>(`/projects/${id}`, input);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await api.delete(`/projects/${id}`);
  } catch (err) {
    throw normalizeError(err);
  }
}

/** Send the full ordered list of REAL (non-default) project ids. Returns the new server order. */
export async function reorderProjects(orderedRealIds: string[]): Promise<ProjectDTO[]> {
  try {
    const res = await api.put<{ success: true; data: ProjectDTO[] }>('/projects/reorder', {
      projectIds: orderedRealIds,
    });
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}
