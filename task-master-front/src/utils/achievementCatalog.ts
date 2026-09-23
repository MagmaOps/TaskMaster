/**
 * Display catalog for the achievements gallery. The backend returns achievement
 * `type` slugs (e.g. `daily_streak_7`); this maps each defined type to a
 * human-readable title + description, and provides a humanized-slug fallback so
 * a future server-side achievement not in this list still renders gracefully.
 *
 * The ordered list drives the gallery layout (unlocked and greyed-locked items
 * share this order). Keep it in sync with the backend achievements service.
 */

export interface AchievementMeta {
  type: string;
  title: string;
  description: string;
}

/** All defined achievement types, in display order. */
export const ACHIEVEMENT_CATALOG: AchievementMeta[] = [
  {
    type: 'first_task_completed',
    title: 'First Steps',
    description: 'Complete your very first task.',
  },
  {
    type: 'daily_streak_7',
    title: '7-Day Streak',
    description: 'Complete at least one task seven days in a row.',
  },
  {
    type: 'daily_streak_14',
    title: '14-Day Streak',
    description: 'Keep a daily completion streak going for two weeks.',
  },
  {
    type: 'daily_streak_30',
    title: '30-Day Streak',
    description: 'A full month of daily completions.',
  },
  {
    type: 'daily_streak_90',
    title: '90-Day Streak',
    description: 'Three months without missing a day.',
  },
  {
    type: 'repeatable_streak_7',
    title: 'Habit Forming',
    description: 'Complete a repeatable task seven times in a row.',
  },
  {
    type: 'repeatable_streak_30',
    title: 'Habit Locked In',
    description: 'A repeatable task completed thirty times running.',
  },
  {
    type: 'repeatable_streak_100',
    title: 'Unstoppable Habit',
    description: 'One hundred consecutive completions of a repeatable task.',
  },
  {
    type: 'accountable_procrastination',
    title: 'Accountable Procrastinator',
    description: 'Finish a task you deferred at least three times.',
  },
  {
    type: 'high_weight_completed',
    title: 'Heavy Lifter',
    description: 'Complete a task that had grown to a high weight.',
  },
  {
    type: 'productivity_burst_10',
    title: 'Productivity Burst',
    description: 'Complete ten tasks in a single day.',
  },
];

const BY_TYPE: Record<string, AchievementMeta> = Object.fromEntries(
  ACHIEVEMENT_CATALOG.map((m) => [m.type, m]),
);

/** Turn an unknown slug like `some_new_badge` into "Some New Badge". */
function humanizeSlug(type: string): string {
  return type
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Resolve display metadata for an achievement type. Known types return their
 * catalog entry; unknown types (forward-compat) return a humanized-slug title
 * with an empty description.
 */
export function achievementMeta(type: string): AchievementMeta {
  return BY_TYPE[type] ?? { type, title: humanizeSlug(type), description: '' };
}
