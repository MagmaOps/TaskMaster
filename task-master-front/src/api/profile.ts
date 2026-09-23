import { api, unwrap, normalizeError } from './client';
import type { AchievementRow, Economy, ProjectAnalytics, UserStreaks } from './types';

/**
 * Typed wrappers over the read-only profile endpoints (achievements, streaks,
 * economy, per-project analytics). Each unwraps `data` and throws a normalized
 * ApiError on failure, mirroring the auth/tasks/projects wrappers.
 */

export async function getAchievements(): Promise<AchievementRow[]> {
  try {
    const res = await api.get<{ success: true; data: AchievementRow[] }>('/achievements');
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function getStreaks(): Promise<UserStreaks> {
  try {
    const res = await api.get<{ success: true; data: UserStreaks }>('/streaks');
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function getEconomy(): Promise<Economy> {
  try {
    const res = await api.get<{ success: true; data: Economy }>('/economy');
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function getProjectAnalytics(): Promise<ProjectAnalytics[]> {
  try {
    const res = await api.get<{ success: true; data: ProjectAnalytics[] }>('/analytics/projects');
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}
