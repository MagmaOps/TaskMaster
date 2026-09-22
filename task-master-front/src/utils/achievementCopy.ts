import type { UnlockedAchievement } from '../api/types';

/**
 * Friendly, non-corporate celebration copy for unlocked achievements.
 * Types mirror the backend achievements config; unknown types fall back to a
 * generic cheer so new server-side achievements still celebrate gracefully.
 */

const EXACT: Record<string, string> = {
  first_task_completed: 'First task done — you’re off! 🎉',
  accountable_procrastination: 'You finally tackled it. That counts double. 💪',
  productivity_burst_10: '10 done in a day — you’re on fire! 🔥',
  high_weight_completed: 'Big one cleared. That was heavy! 🏋️',
};

function friendlyForType(type: string): string {
  if (EXACT[type]) return EXACT[type];

  const daily = /^daily_streak_(\d+)$/.exec(type);
  if (daily) return `${daily[1]}-day streak! Keep it going. 🔥`;

  const repeat = /^repeatable_streak_(\d+)$/.exec(type);
  if (repeat) return `${repeat[1]} in a row on a repeat task — habit unlocked! ✨`;

  return 'Achievement unlocked! 🎉';
}

export function celebrationMessage(achievement: UnlockedAchievement): string {
  return friendlyForType(achievement.type);
}
