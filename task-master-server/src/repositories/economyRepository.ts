import { query } from '../database/pool';
import type { UserTier } from '../types';

/** Data access for the virtual currency balance on users. */

/** Add (or subtract) currency atomically, clamping the balance at >= 0. */
export async function addCurrency(userId: string, amount: number): Promise<void> {
  await query(
    'UPDATE users SET currency_balance = GREATEST(currency_balance + $2, 0), updated_at = NOW() WHERE id = $1',
    [userId, amount],
  );
}

/** Current balance + tier for a user. currency_balance is bigint → number. */
export async function getBalance(
  userId: string,
): Promise<{ balance: number; tier: UserTier } | null> {
  const res = await query<{ currency_balance: string; tier: UserTier }>(
    'SELECT currency_balance, tier FROM users WHERE id = $1',
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { balance: Number(row.currency_balance), tier: row.tier };
}
