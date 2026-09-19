import { query } from '../database/pool';
import type { DeferOption } from '../types/task';

/** Records deferral actions ("Later" clicks) for weight accumulation. */
export async function record(taskId: string, option: DeferOption): Promise<void> {
  await query('INSERT INTO deferrals (task_id, option_chosen) VALUES ($1, $2)', [taskId, option]);
}
