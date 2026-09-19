import type { NextFunction, Request, Response } from 'express';
import { validationResult, type ValidationChain } from 'express-validator';
import { ApiError } from '../utils/errors';

/**
 * Runs a set of express-validator chains and throws VALIDATION_ERROR (400)
 * with the collected issues if any fail.
 */
export function validate(chains: ValidationChain[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    for (const chain of chains) {
      await chain.run(req);
    }
    const result = validationResult(req);
    if (!result.isEmpty()) {
      next(
        ApiError.badRequest('VALIDATION_ERROR', 'Invalid input data', result.array({ onlyFirstError: true })),
      );
      return;
    }
    next();
  };
}
