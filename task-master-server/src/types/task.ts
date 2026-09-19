import type { Priority, WeightBreakdown } from '../services/tasks/weight';

/** Recurrence pattern stored on repeatable tasks (regeneration handled by the task-recurrence spec). */
export interface RepeatPattern {
  frequency: 'daily' | 'weekly';
  interval?: number;
  days_of_week?: number[]; // 0-6, for weekly
  end_date?: string | null;
}

export type DeferOption = 'later_today' | 'tomorrow' | 'sometime_later';

/** Raw task row from the DB. */
export interface TaskRow {
  id: string;
  user_id: string;
  subject: string;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  is_repeatable: boolean;
  repeat_pattern: RepeatPattern | null;
  repeat_series_id: string | null;
  created_at: Date;
  completed_at: Date | null;
  archived_at: Date | null;
  updated_at: Date;
  weight_at_completion: number | null;
}

/** A project association as seen from a task. */
export interface TaskProject {
  id: string;
  name: string;
  priorityOrder: number;
  color: string | null;
}

/** Task row enriched with joined metadata for weighting/serialization. */
export interface TaskWithMeta extends TaskRow {
  deferral_count: number;
  projects: TaskProject[];
}

/** API DTO returned to clients. */
export interface TaskDTO {
  id: string;
  subject: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  isRepeatable: boolean;
  repeatPattern: RepeatPattern | null;
  createdAt: string;
  completedAt: string | null;
  projects: TaskProject[];
  deferralCount: number;
  weight: number;
  weightBreakdown?: WeightBreakdown;
}

/** Input for creating a task (post-validation). */
export interface CreateTaskInput {
  subject: string;
  priority: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  projectIds?: string[];
  isRepeatable?: boolean;
  repeatPattern?: RepeatPattern | null;
}

/** Input for updating a task (all optional). */
export interface UpdateTaskInput {
  subject?: string;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  projectIds?: string[];
  isRepeatable?: boolean;
  repeatPattern?: RepeatPattern | null;
}
