import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import {
  api,
  getAccessToken,
  setAccessToken,
  setAuthFailureHandler,
  normalizeError,
} from './client';
import { ApiError } from './types';

// Mock the `api` instance (app requests) and bare `axios` (the refresh call).
let apiMock: MockAdapter;
let axiosMock: MockAdapter;

beforeEach(() => {
  apiMock = new MockAdapter(api);
  axiosMock = new MockAdapter(axios);
  setAccessToken(null);
  setAuthFailureHandler(null);
});

afterEach(() => {
  apiMock.restore();
  axiosMock.restore();
});

describe('request interceptor', () => {
  it('attaches the bearer token when present', async () => {
    setAccessToken('tok-123');
    apiMock.onGet('/tasks').reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer tok-123');
      return [200, { success: true, data: [] }];
    });
    await api.get('/tasks');
  });

  it('omits Authorization when no token is set', async () => {
    apiMock.onGet('/tasks').reply((config) => {
      expect(config.headers?.Authorization).toBeUndefined();
      return [200, { success: true, data: [] }];
    });
    await api.get('/tasks');
  });
});

describe('401 -> refresh -> retry', () => {
  it('refreshes once and retries the original request on success', async () => {
    setAccessToken('stale');
    let call = 0;
    apiMock.onGet('/tasks').reply(() => {
      call += 1;
      // First call 401s; after refresh the retry should carry the new token.
      if (call === 1) return [401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }];
      return [200, { success: true, data: ['ok'] }];
    });
    axiosMock.onPost('/api/auth/refresh').reply(200, { success: true, data: { accessToken: 'fresh' } });

    const res = await api.get<{ success: true; data: string[] }>('/tasks');

    expect(res.data.data).toEqual(['ok']);
    expect(getAccessToken()).toBe('fresh');
    expect(call).toBe(2);
  });

  it('does not attempt refresh for the refresh endpoint itself', async () => {
    // A 401 from refresh should surface, not loop.
    axiosMock.onPost('/api/auth/refresh').reply(401, {
      success: false,
      error: { code: 'INVALID_REFRESH', message: 'nope' },
    });
    apiMock.onGet('/protected').reply(401, {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'x' },
    });

    await expect(api.get('/protected')).rejects.toBeInstanceOf(ApiError);
  });

  it('clears the token and invokes the auth-failure handler when refresh fails', async () => {
    setAccessToken('stale');
    const onFail = vi.fn();
    setAuthFailureHandler(onFail);

    apiMock.onGet('/tasks').reply(401, {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'x' },
    });
    axiosMock.onPost('/api/auth/refresh').reply(401, {
      success: false,
      error: { code: 'INVALID_REFRESH', message: 'expired' },
    });

    await expect(api.get('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('shares a single refresh across concurrent 401s (single-flight)', async () => {
    setAccessToken('stale');
    let refreshCount = 0;
    axiosMock.onPost('/api/auth/refresh').reply(() => {
      refreshCount += 1;
      return [200, { success: true, data: { accessToken: 'fresh' } }];
    });

    const hits: Record<string, number> = { '/a': 0, '/b': 0, '/c': 0 };
    (['/a', '/b', '/c'] as const).forEach((path) => {
      apiMock.onGet(path).reply(() => {
        hits[path] += 1;
        if (hits[path] === 1)
          return [401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }];
        return [200, { success: true, data: path }];
      });
    });

    const [a, b, c] = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

    expect([a.data.data, b.data.data, c.data.data]).toEqual(['/a', '/b', '/c']);
    expect(refreshCount).toBe(1);
  });
});

describe('normalizeError', () => {
  it('maps a backend error envelope to a typed ApiError', () => {
    const err = normalizeError({
      isAxiosError: true,
      response: {
        status: 409,
        data: { success: false, error: { code: 'EMAIL_TAKEN', message: 'in use' } },
      },
      // minimal AxiosError shape
      config: {},
      name: 'AxiosError',
      message: 'Request failed',
      toJSON: () => ({}),
    } as unknown);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('EMAIL_TAKEN');
    expect(err.message).toBe('in use');
    expect(err.status).toBe(409);
  });

  it('maps a network failure (no response) to code NETWORK', () => {
    const err = normalizeError({
      isAxiosError: true,
      response: undefined,
      config: {},
      name: 'AxiosError',
      message: 'Network Error',
      toJSON: () => ({}),
    } as unknown);

    expect(err.code).toBe('NETWORK');
    expect(err.status).toBeNull();
  });
});
