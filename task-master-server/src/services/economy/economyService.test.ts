/** Unit tests for economyService with the repository mocked. */
import * as economyRepo from '../../repositories/economyRepository';
import { earnRateForTier, onTaskCompleted } from './economyService';
import type { CompletionEvent } from '../completion/completionEvents';

jest.mock('../../repositories/economyRepository');
const mocked = jest.mocked(economyRepo);

function event(weight: number, userId = 'u1'): CompletionEvent {
  return { userId, task: {} as never, weightAtCompletion: weight, unlocked: [] };
}

describe('economyService (unit)', () => {
  it('earnRateForTier: free 1.0, premium 1.5', () => {
    expect(earnRateForTier('free')).toBe(1.0);
    expect(earnRateForTier('premium')).toBe(1.5);
  });

  it('awards weight × 1.0 for free users', async () => {
    mocked.getBalance.mockResolvedValue({ balance: 0, tier: 'free' });
    await onTaskCompleted(event(40));
    expect(mocked.addCurrency).toHaveBeenCalledWith('u1', 40);
  });

  it('awards round(weight × 1.5) for premium users', async () => {
    mocked.getBalance.mockResolvedValue({ balance: 0, tier: 'premium' });
    await onTaskCompleted(event(41));
    expect(mocked.addCurrency).toHaveBeenCalledWith('u1', 62); // round(41*1.5)=62 (61.5→62)
  });

  it('skips a zero award', async () => {
    mocked.getBalance.mockResolvedValue({ balance: 0, tier: 'free' });
    await onTaskCompleted(event(0));
    expect(mocked.addCurrency).not.toHaveBeenCalled();
  });

  it('does nothing if the user is missing', async () => {
    mocked.getBalance.mockResolvedValue(null);
    await onTaskCompleted(event(10));
    expect(mocked.addCurrency).not.toHaveBeenCalled();
  });
});
