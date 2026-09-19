import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/auth/tokenService';
import { ApiError } from '../utils/errors';

/**
 * Validates the Bearer access token and attaches req.userId.
 * Rejects with 401 when the token is missing or invalid.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(ApiError.unauthorized('TOKEN_REQUIRED', 'Authorization token required'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const { userId } = verifyAccessToken(token);
    req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}
