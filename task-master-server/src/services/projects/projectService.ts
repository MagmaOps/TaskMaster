import * as projectRepo from '../../repositories/projectRepository';
import { config } from '../../config';
import { ApiError } from '../../utils/errors';
import type {
  CreateProjectInput,
  ProjectDTO,
  ProjectRow,
  ProjectWithCount,
  UpdateProjectInput,
} from '../../types/project';

/** Business logic for projects: CRUD, reorder, with limits and name uniqueness. */

function toDTO(row: ProjectRow, taskCount: number): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    priorityOrder: row.priority_order,
    isDefault: row.is_default,
    color: row.color,
    taskCount,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toDTOWithCount(row: ProjectWithCount): ProjectDTO {
  return toDTO(row, row.task_count);
}

export async function createProject(userId: string, input: CreateProjectInput): Promise<ProjectDTO> {
  const count = await projectRepo.countForUser(userId);
  if (count >= config.limits.maxProjectsPerUser) {
    throw ApiError.badRequest(
      'VALIDATION_ERROR',
      `You can have a maximum of ${config.limits.maxProjectsPerUser} projects`,
    );
  }
  if (input.name.trim().toLowerCase() === 'unassigned') {
    throw ApiError.conflict('A project with this name already exists');
  }
  const existing = await projectRepo.findByNameForUser(userId, input.name);
  if (existing) {
    throw ApiError.conflict('A project with this name already exists');
  }
  const created = await projectRepo.create(userId, input);
  return toDTO(created, 0);
}

export async function listProjects(userId: string): Promise<ProjectDTO[]> {
  const rows = await projectRepo.listForUserWithCounts(userId);
  return rows.map(toDTOWithCount);
}

export async function updateProject(
  userId: string,
  id: string,
  patch: UpdateProjectInput,
): Promise<ProjectDTO> {
  const current = await projectRepo.findByIdForUser(userId, id);
  if (!current) throw ApiError.notFound('Project not found');

  if (current.is_default) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'The Unassigned project cannot be modified');
  }

  if (patch.name !== undefined) {
    if (patch.name.trim().toLowerCase() === 'unassigned') {
      throw ApiError.conflict('A project with this name already exists');
    }
    const dupe = await projectRepo.findByNameForUser(userId, patch.name);
    if (dupe && dupe.id !== id) {
      throw ApiError.conflict('A project with this name already exists');
    }
  }
  const updated = await projectRepo.update(userId, id, patch);
  if (!updated) throw ApiError.notFound('Project not found');
  // Recompute count for an accurate DTO.
  const withCounts = await projectRepo.listForUserWithCounts(userId);
  const match = withCounts.find((p) => p.id === id);
  return toDTO(updated, match?.task_count ?? 0);
}

export async function reorderProjects(userId: string, orderedIds: string[]): Promise<ProjectDTO[]> {
  const current = (await projectRepo.listForUser(userId)).filter((p) => !p.is_default);
  const currentIds = new Set(current.map((p) => p.id));
  const providedIds = new Set(orderedIds);

  // Must be exactly the user's Real_Project set: same size, no dupes, all belong to user.
  if (
    orderedIds.length !== current.length ||
    providedIds.size !== orderedIds.length ||
    ![...providedIds].every((id) => currentIds.has(id))
  ) {
    throw ApiError.badRequest(
      'VALIDATION_ERROR',
      'Reorder must include exactly your full set of project ids, once each',
    );
  }

  await projectRepo.reorder(userId, orderedIds);
  return listProjects(userId);
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  const current = await projectRepo.findByIdForUser(userId, id);
  if (!current) throw ApiError.notFound('Project not found');
  if (current.is_default) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'The Unassigned project cannot be deleted');
  }
  const ok = await projectRepo.remove(userId, id);
  if (!ok) throw ApiError.notFound('Project not found');
}
