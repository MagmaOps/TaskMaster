import type { NextFunction, Request, Response } from 'express';
import * as achievementsService from '../services/achievements/achievementsService';

/** HTTP layer for achievements (unlocked achievements read model). */
export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await achievementsService.getAchievements(req.userId as string);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
