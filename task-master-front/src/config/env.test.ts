import { describe, it, expect } from 'vitest';
import { API_BASE } from './env';

describe('env config', () => {
  it('uses a relative /api base so requests are same-origin', () => {
    expect(API_BASE).toBe('/api');
  });
});
