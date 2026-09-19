import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import * as authController from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';

/**
 * Authentication routes. Rate limiting (10/min/IP) guards the credential
 * endpoints; validation runs before controllers.
 */
const router = Router();

const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Disable in the test environment so the integration suite isn't throttled.
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' },
  },
});

router.post(
  '/register',
  authRateLimiter,
  validate([
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('displayName').optional().isString().isLength({ max: 255 }),
  ]),
  authController.register,
);

router.post(
  '/login',
  authRateLimiter,
  validate([
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isString().notEmpty().withMessage('Password is required'),
  ]),
  authController.login,
);

router.post(
  '/google',
  authRateLimiter,
  validate([body('idToken').isString().notEmpty().withMessage('idToken is required')]),
  authController.google,
);

router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.me);

export default router;
