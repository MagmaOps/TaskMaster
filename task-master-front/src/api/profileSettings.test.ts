import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from './client';
import { ApiError } from './types';
import { getAchievements, getStreaks, getEconomy, getProjectAnalytics } from './profile';
import { updateSettings } from './settings';

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
});

describe('profile api wrappers', () => {
  it('getAchievements unwraps the data array', async () => {
    mock.onGet('/achievements').reply(200, {
      success: true,
      data: [{ id: 'a1', type: 'first_task_completed', unlocked_at: 'x', data: {} }],
    });
    const rows = await getAchievements();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('first_task_completed');
  });

  it('getStreaks unwraps the payload', async () => {
    mock.onGet('/streaks').reply(200, {
      success: true,
      data: { daily: { current: 3, longest: 5, lastCompletedDate: null }, series: [] },
    });
    const s = await getStreaks();
    expect(s.daily?.current).toBe(3);
  });

  it('getEconomy unwraps the payload', async () => {
    mock.onGet('/economy').reply(200, {
      success: true,
      data: { balance: 42, earnRate: 1, tier: 'free' },
    });
    expect((await getEconomy()).balance).toBe(42);
  });

  it('getProjectAnalytics unwraps the array', async () => {
    mock.onGet('/analytics/projects').reply(200, { success: true, data: [] });
    expect(await getProjectAnalytics()).toEqual([]);
  });

  it('throws a normalized ApiError on failure', async () => {
    mock.onGet('/economy').reply(500, {
      success: false,
      error: { code: 'INTERNAL', message: 'boom' },
    });
    await expect(getEconomy()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('settings api wrapper', () => {
  it('PATCHes /auth/me with the partial body and returns the user', async () => {
    mock.onPatch('/auth/me').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ theme: 'dark' });
      return [
        200,
        {
          success: true,
          data: {
            user: {
              id: 'u1',
              email: 'a@b.com',
              displayName: null,
              avatarUrl: null,
              tier: 'free',
              currencyBalance: 0,
              settings: {
                project_priority_enabled: true,
                achievement_toasts_enabled: true,
                focus_mode_enabled: false,
                weight_visibility_enabled: false,
                theme: 'dark',
                timezone: 'UTC',
              },
            },
          },
        },
      ];
    });
    const user = await updateSettings({ theme: 'dark' });
    expect(user.settings.theme).toBe('dark');
  });

  it('throws a normalized ApiError on a validation failure', async () => {
    mock.onPatch('/auth/me').reply(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid theme' },
    });
    await expect(updateSettings({ theme: 'system' })).rejects.toBeInstanceOf(ApiError);
  });
});
