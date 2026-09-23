import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import * as authController from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { isValidTimezone } from '../services/time/userTime';

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
    body('timezone').optional().isString(),
  ]),
  authController.register,
);

router.post(
  '/login',
  authRateLimiter,
  validate([
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isString().notEmpty().withMessage('Password is required'),
    body('timezone').optional().isString(),
  ]),
  authController.login,
);

router.post(
  '/google',
  authRateLimiter,
  validate([
    body('idToken').isString().notEmpty().withMessage('idToken is required'),
    body('timezone').optional().isString(),
  ]),
  authController.google,
);

router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.me);
router.patch(
  '/me',
  authMiddleware,
  validate([
    body('theme').optional().isIn(['system', 'light', 'dark']).withMessage('Invalid theme'),
    body('focus_mode_enabled').optional().isBoolean().withMessage('Must be a boolean').toBoolean(),
    body('achievement_toasts_enabled')
      .optional()
      .isBoolean()
      .withMessage('Must be a boolean')
      .toBoolean(),
    body('project_priority_enabled')
      .optional()
      .isBoolean()
      .withMessage('Must be a boolean')
      .toBoolean(),
    body('weight_visibility_enabled')
      .optional()
      .isBoolean()
      .withMessage('Must be a boolean')
      .toBoolean(),
    body('timezone').optional().custom(isValidTimezone).withMessage('Invalid timezone'),
    body('tier').optional().isIn(['free', 'premium']).withMessage('Invalid tier'),
  ]),
  authController.updateSettings,
);

export default router;
