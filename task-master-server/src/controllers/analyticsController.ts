import type { NextFunction, Request, Response } from 'express';
import * as analyticsService from '../services/analytics/analyticsService';

/** HTTP layer for read-only per-project completion analytics. */
export async function getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await analyticsService.getProjectAnalytics(req.userId as string);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
