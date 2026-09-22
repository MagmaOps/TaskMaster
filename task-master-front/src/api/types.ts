/**
 * Shared API types mirroring the backend response envelopes and public DTOs.
 * Source of truth: task-master-server authController + types/index.ts.
 */

export type UserTier = 'free' | 'premium';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface UserSettings {
  project_priority_enabled: boolean;
  achievement_toasts_enabled: boolean;
  focus_mode_enabled: boolean;
  weight_visibility_enabled: boolean;
  theme: ThemePreference;
  timezone: string;
}

/** User shape returned by the backend (never includes secrets). */
export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: UserTier;
  currencyBalance: number;
  settings: UserSettings;
}

/** Success envelope: `{ success: true, data }`. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Error envelope: `{ success: false, error: { code, message, details? } }`. */
export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Normalized error thrown by the API client. Carries the backend error `code`
 * (or a synthetic one like `NETWORK`/`UNKNOWN`) plus the HTTP status when known.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: unknown;

  constructor(code: string, message: string, status: number | null = null, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// --- Auth payloads ---

export interface RegisterPayload {
  email: string;
  password: string;
  displayName: string;
  timezone?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  timezone?: string;
}

export interface GooglePayload {
  idToken: string;
  timezone?: string;
}

export interface AuthData {
  user: User;
  accessToken: string;
  isNewUser?: boolean;
}

export interface RefreshData {
  accessToken: string;
}

export interface MeData {
  user: User;
}

// --- Tasks & projects (mirrors backend types/task.ts + types/project.ts) ---

export type Priority = 'high' | 'medium' | 'low';
export type DeferOption = 'later_today' | 'tomorrow' | 'sometime_later';

export interface RepeatPattern {
  frequency: 'daily' | 'weekly';
  interval?: number;
  days_of_week?: number[]; // 0-6 for weekly
  end_date?: string | null;
}

/** A project association as seen from a task. */
export interface TaskProjectRef {
  id: string;
  name: string;
  priorityOrder: number;
  color: string | null;
}

export interface WeightBreakdown {
  base: number;
  dueProximity: number;
  project: number;
  deferral: number;
  repeatable: number;
  total: number;
}

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
  projects: TaskProjectRef[];
  deferralCount: number;
  weight: number;
  weightBreakdown?: WeightBreakdown;
}

export interface CreateTaskInput {
  subject: string;
  priority: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  projectIds?: string[];
  isRepeatable?: boolean;
  repeatPattern?: RepeatPattern | null;
}

export type UpdateTaskInput = Partial<CreateTaskInput>;

/** Minimal achievement shape returned by the complete endpoint for celebration. */
export interface UnlockedAchievement {
  type: string;
  data?: Record<string, unknown>;
}

export interface CompleteTaskData extends TaskDTO {
  weightAtCompletion: number;
  unlocked: UnlockedAchievement[];
}

export interface ProjectDTO {
  id: string;
  name: string;
  priorityOrder: number;
  isDefault: boolean;
  color: string | null;
  taskCount: number;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  color?: string | null;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;
