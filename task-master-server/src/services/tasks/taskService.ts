import * as taskRepo from '../../repositories/taskRepository';
import * as deferralRepo from '../../repositories/deferralRepository';
import * as projectRepo from '../../repositories/projectRepository';
import * as userRepo from '../../repositories/userRepository';
import { ApiError } from '../../utils/errors';
import { calculateWeight, calculateWeightBreakdown, type WeightInput } from './weight';
import {
  resolveTimezone,
  localCalendarDate,
  nextCalendarDate,
} from '../time/userTime';
import {
  emitTaskCompleted,
  type CompletionEvent,
  type UnlockedAchievement,
} from '../completion/completionEvents';
import type {
  CreateTaskInput,
  DeferOption,
  TaskDTO,
  TaskWithMeta,
  UpdateTaskInput,
} from '../../types/task';

/**
 * Task-management business logic: CRUD, complete, defer, archive, and
 * weight-sorted listing. Weight is computed per request from user context.
 */

interface UserWeightContext {
  projectWeightingEnabled: boolean;
  totalProjects: number;
  /** map of projectId -> priority_order for the user's projects */
  orderById: Map<string, number>;
  isPremium: boolean;
  weightVisibility: boolean;
  /** resolved IANA zone (UTC if unset/invalid) */
  timezone: string;
  /** the true current instant (age/due-proximity are offset-independent); localToday carries the user's zoned calendar day. */
  now: Date;
  /** localCalendarDate(timezone) for that same instant */
  localToday: string;
}

async function loadUserWeightContext(userId: string): Promise<UserWeightContext> {
  const user = await userRepo.findById(userId);
  const projects = await projectRepo.listForUser(userId);
  const orderById = new Map(projects.map((p) => [p.id, p.priority_order]));
  // Resolve the zone once and derive "now"/"today" from a single captured
  // instant so the whole request shares one moment in the user's timezone.
  const timezone = resolveTimezone(user?.settings.timezone);
  const instant = new Date();
  const now = instant;
  const localToday = localCalendarDate(timezone, instant);
  return {
    projectWeightingEnabled: user?.settings.project_priority_enabled ?? true,
    totalProjects: projects.length,
    orderById,
    isPremium: user?.tier === 'premium',
    weightVisibility: user?.settings.weight_visibility_enabled ?? false,
    timezone,
    now,
    localToday,
  };
}

/** pg returns DATE columns as strings in some cases and Date in others; normalize to 'YYYY-MM-DD'. */
function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return toDateString(value);
  const s = String(value);
  // Already a date-only string, or an ISO timestamp — take the date part.
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Normalize a TIME column to 'HH:MM' (or null). */
function normalizeTime(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.slice(0, 5); // 'HH:MM'
}

function buildWeightInput(task: TaskWithMeta, ctx: UserWeightContext): WeightInput {
  // Highest-priority (lowest priority_order) project the task belongs to.
  let bestOrder: number | null = null;
  for (const p of task.projects) {
    const order = ctx.orderById.get(p.id) ?? p.priorityOrder;
    if (bestOrder === null || order < bestOrder) bestOrder = order;
  }
  return {
    createdAt: new Date(task.created_at),
    priority: task.priority,
    dueDate: normalizeDate(task.due_date),
    dueTime: normalizeTime(task.due_time),
    isRepeatable: task.is_repeatable,
    deferralCount: task.deferral_count,
    projectPriorityOrder: bestOrder,
    totalProjects: ctx.totalProjects,
    projectWeightingEnabled: ctx.projectWeightingEnabled,
    now: ctx.now,
    localToday: ctx.localToday,
  };
}

function toDTO(task: TaskWithMeta, ctx: UserWeightContext): TaskDTO {
  const wInput = buildWeightInput(task, ctx);
  const includeBreakdown = ctx.isPremium && ctx.weightVisibility;
  const weight = calculateWeight(wInput);
  return {
    id: task.id,
    subject: task.subject,
    priority: task.priority,
    dueDate: normalizeDate(task.due_date),
    dueTime: normalizeTime(task.due_time),
    isRepeatable: task.is_repeatable,
    repeatPattern: task.repeat_pattern,
    createdAt: new Date(task.created_at).toISOString(),
    completedAt: task.completed_at ? new Date(task.completed_at).toISOString() : null,
    projects: task.projects,
    deferralCount: task.deferral_count,
    weight,
    ...(includeBreakdown ? { weightBreakdown: calculateWeightBreakdown(wInput) } : {}),
  };
}

export async function createTask(userId: string, input: CreateTaskInput): Promise<TaskDTO> {
  if (input.isRepeatable && !input.repeatPattern) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'repeat_pattern is required for repeatable tasks');
  }
  if (input.projectIds && input.projectIds.length > 0) {
    await projectRepo.assertOwned(userId, input.projectIds);
  }
  const created = await taskRepo.create(userId, input);
  const full = await taskRepo.findByIdForUser(userId, created.id);
  const ctx = await loadUserWeightContext(userId);
  return toDTO(full as TaskWithMeta, ctx);
}

export async function listTasks(
  userId: string,
  opts: { projectId?: string; includeCompleted?: boolean },
): Promise<TaskDTO[]> {
  const [rows, ctx] = await Promise.all([
    taskRepo.findActiveByUser(userId, opts),
    loadUserWeightContext(userId),
  ]);
  return rows
    .map((t) => toDTO(t, ctx))
    .sort((a, b) => b.weight - a.weight);
}

export async function updateTask(
  userId: string,
  id: string,
  patch: UpdateTaskInput,
): Promise<TaskDTO> {
  if (patch.projectIds !== undefined && patch.projectIds.length > 0) {
    await projectRepo.assertOwned(userId, patch.projectIds);
  }
  const updated = await taskRepo.update(userId, id, patch);
  if (!updated) throw ApiError.notFound('Task not found');
  const full = await taskRepo.findByIdForUser(userId, id);
  const ctx = await loadUserWeightContext(userId);
  return toDTO(full as TaskWithMeta, ctx);
}

export async function completeTask(
  userId: string,
  id: string,
): Promise<TaskDTO & { weightAtCompletion: number; unlocked: UnlockedAchievement[] }> {
  // Distinguish "not found" (404) from "already completed" (409).
  const existing = await taskRepo.findByIdForUser(userId, id);
  if (!existing) throw ApiError.notFound('Task not found');
  if (existing.completed_at) throw ApiError.conflict('Task is already completed');

  const ctx = await loadUserWeightContext(userId);
  const weightAtCompletion = calculateWeight(buildWeightInput(existing, ctx));

  const completed = await taskRepo.setCompleted(userId, id, weightAtCompletion);
  if (!completed) throw ApiError.conflict('Task is already completed');

  const full = (await taskRepo.findByIdForUser(userId, id)) as TaskWithMeta;

  // Announce the completion to all registered listeners (economy, streaks,
  // achievements, recurrence, analytics). Listener errors never fail completion.
  const event: CompletionEvent = { userId, task: full, weightAtCompletion, unlocked: [] };
  await emitTaskCompleted(event);

  return { ...toDTO(full, ctx), weightAtCompletion, unlocked: event.unlocked };
}

export async function deferTask(
  userId: string,
  id: string,
  option: DeferOption,
): Promise<TaskDTO> {
  const existing = await taskRepo.findByIdForUser(userId, id);
  if (!existing) throw ApiError.notFound('Task not found');

  // Load the user's weight context once: it carries the resolved timezone and
  // local calendar date used below, and is reused for the returned DTO — no
  // redundant user/projects query. In the UTC test env localToday equals the
  // server-local day, so existing defer expectations are unchanged.
  const ctx = await loadUserWeightContext(userId);
  const patch: { dueDate?: string | null; dueTime?: string | null; priority?: string } = {};

  if (option === 'later_today') {
    patch.dueDate = ctx.localToday;
  } else if (option === 'tomorrow') {
    patch.dueDate = nextCalendarDate(ctx.localToday);
  } else {
    // sometime_later: lower priority one level, clear due date/time.
    const downgrade: Record<string, string> = { high: 'medium', medium: 'low', low: 'low' };
    patch.priority = downgrade[existing.priority];
    patch.dueDate = null;
    patch.dueTime = null;
  }

  const updated = await taskRepo.applyDefer(userId, id, patch);
  if (!updated) throw ApiError.notFound('Task not found');
  await deferralRepo.record(id, option);

  const full = (await taskRepo.findByIdForUser(userId, id)) as TaskWithMeta;
  return toDTO(full, ctx);
}

export async function archiveTask(userId: string, id: string): Promise<void> {
  const ok = await taskRepo.archive(userId, id);
  if (!ok) throw ApiError.notFound('Task not found');
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
