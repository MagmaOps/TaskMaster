import type { NextFunction, Request, Response } from 'express';
import * as economyService from '../services/economy/economyService';

/** HTTP layer for the economy (currency balance). */
export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await economyService.getEconomy(req.userId as string);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
