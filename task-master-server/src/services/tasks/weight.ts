/**
 * Task weight algorithm — pure, deterministic, no I/O.
 *
 * Weight orders a user's active tasks (higher = more urgent / shown first).
 * It is recomputed on every fetch, never stored. Due proximity is continuous
 * on the exact hours to the due moment, so an earlier due_time outweighs a
 * later one on the same day, throughout the whole 7-day countdown.
 */

export type Priority = 'high' | 'medium' | 'low';

const PRIORITY_MULTIPLIER: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const DEFERRAL_BONUS = 5;
const OVERDUE_PER_DAY = 10;
const DUE_SOON_MAX = 35;
const DUE_SOON_DAYS = 7;
const DUE_SOON_WINDOW_HOURS = DUE_SOON_DAYS * 24; // 168
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

export interface WeightInput {
  createdAt: Date;
  priority: Priority;
  dueDate: string | null; // 'YYYY-MM-DD'
  dueTime: string | null; // 'HH:MM' (or 'HH:MM:SS')
  isRepeatable: boolean;
  deferralCount: number;
  /** priority_order of the highest-priority project this task belongs to, or null. */
  projectPriorityOrder: number | null;
  /** total number of projects the user has (for multiplier scaling). */
  totalProjects: number;
  projectWeightingEnabled: boolean;
  /** injectable "now" for deterministic tests; defaults to new Date(). */
  now?: Date;
  /**
   * The user's Local_Calendar_Date ('YYYY-MM-DD') for the same instant as `now`.
   * When omitted, defaults to the server-local calendar day of `now` — which,
   * in the UTC test/CI environment, equals the pre-change behavior.
   */
  localToday?: string;
}

export interface WeightBreakdown {
  base: number;
  dueProximity: number;
  project: number;
  deferral: number;
  repeatable: number;
  total: number;
}

/**
 * Build the local due-moment Date from a due date and optional time.
 * With no time, the due moment is the end of the due date (23:59:59.999 local).
 * Returns null when there is no due date.
 */
export function dueMomentOf(dueDate: string | null, dueTime: string | null): Date | null {
  if (!dueDate) return null;
  const [y, m, d] = dueDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (dueTime) {
    const [hh, mm, ss] = dueTime.split(':').map(Number);
    return new Date(y, m - 1, d, hh ?? 0, mm ?? 0, ss ?? 0, 0);
  }
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** Project multiplier: 1.0 for a single project, else linear 1..0 by priority order. */
export function projectMultiplier(priorityOrder: number, totalProjects: number): number {
  if (totalProjects <= 1) return 1.0;
  const raw = 1.0 - (priorityOrder - 1) / (totalProjects - 1);
  return Math.max(0, Math.min(1, raw));
}

/** The server-local calendar day of `d` as 'YYYY-MM-DD' (local getters). */
function serverLocalDay(d: Date): string {
  const year = String(d.getFullYear()).padStart(4, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Full breakdown of a task's weight contributions. */
export function calculateWeightBreakdown(input: WeightInput): WeightBreakdown {
  const now = input.now ?? new Date();
  const localToday = input.localToday ?? serverLocalDay(now);

  // 1. Base: age (whole days, +1 so creation day is non-zero) × priority.
  //    Age is clamped at 0 (a task can't be negative days old); this guards
  //    against sub-second created_at vs now clock skew, where a task's DB
  //    now()-at-insert can be a few ms ahead of the later-captured `now`,
  //    which would otherwise floor to -1 and zero out the whole weight.
  const ageInDays = Math.max(0, Math.floor((now.getTime() - input.createdAt.getTime()) / MS_PER_DAY));
  const base = (ageInDays + 1) * PRIORITY_MULTIPLIER[input.priority];

  // 2/3. Due proximity — continuous on exact hours to the due moment.
  let dueProximity = 0;
  const dueMoment = dueMomentOf(input.dueDate, input.dueTime);
  if (dueMoment) {
    const hoursUntilDue = (dueMoment.getTime() - now.getTime()) / MS_PER_HOUR;
    if (hoursUntilDue < 0) {
      const daysOverdue = Math.ceil(Math.abs(hoursUntilDue) / 24);
      dueProximity = daysOverdue * OVERDUE_PER_DAY;
    } else if (hoursUntilDue <= DUE_SOON_WINDOW_HOURS) {
      dueProximity = (DUE_SOON_DAYS - hoursUntilDue / 24) * (DUE_SOON_MAX / DUE_SOON_DAYS);
    }
  }

  // 4. Project multiplier (applied to base + due proximity).
  let subtotal = base + dueProximity;
  let projectContribution = 0;
  if (
    input.projectWeightingEnabled &&
    input.projectPriorityOrder !== null &&
    input.totalProjects > 0
  ) {
    const mult = projectMultiplier(input.projectPriorityOrder, input.totalProjects);
    projectContribution = subtotal * mult;
    subtotal += projectContribution;
  }

  // 5. Deferral accumulation.
  const deferral = input.deferralCount * DEFERRAL_BONUS;
  subtotal += deferral;

  // 6. Repeatable due today → double.
  let repeatable = 0;
  if (input.isRepeatable && input.dueDate && input.dueDate === localToday) {
    repeatable = subtotal; // doubling => the added amount equals the current subtotal
    subtotal += repeatable;
  }

  return {
    base,
    dueProximity: round(dueProximity),
    project: round(projectContribution),
    deferral,
    repeatable: round(repeatable),
    total: Math.round(subtotal),
  };
}

/** Final integer weight for a task. */
export function calculateWeight(input: WeightInput): number {
  return calculateWeightBreakdown(input).total;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
