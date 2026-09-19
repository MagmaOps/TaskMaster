import { config } from '../../config';
import * as economyRepo from '../../repositories/economyRepository';
import { ApiError } from '../../utils/errors';
import type { UserTier } from '../../types';
import type { CompletionEvent } from '../completion/completionEvents';

/** Virtual currency: earn on completion, expose balance. */

export function earnRateForTier(tier: UserTier): number {
  return tier === 'premium' ? config.economy.premiumEarnRate : 1.0;
}

/**
 * Completion listener: award currency for the completed task.
 * amount = round(weightAtCompletion × earnRate); skips a zero award.
 */
export async function onTaskCompleted(event: CompletionEvent): Promise<void> {
  const info = await economyRepo.getBalance(event.userId);
  if (!info) return;
  const amount = Math.round(event.weightAtCompletion * earnRateForTier(info.tier));
  if (amount > 0) {
    await economyRepo.addCurrency(event.userId, amount);
  }
}

export async function getEconomy(
  userId: string,
): Promise<{ balance: number; earnRate: number; tier: UserTier }> {
  const info = await economyRepo.getBalance(userId);
  if (!info) throw ApiError.notFound('User not found');
  return { balance: info.balance, earnRate: earnRateForTier(info.tier), tier: info.tier };
}
