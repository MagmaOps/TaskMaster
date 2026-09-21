import type { NextFunction, Request, Response } from 'express';
import * as streakService from '../services/streaks/streakService';

/** HTTP layer for streaks (daily + per-series). */
export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await streakService.getStreaks(req.userId as string);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
