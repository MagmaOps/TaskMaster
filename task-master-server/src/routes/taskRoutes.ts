import { Router } from 'express';
import { body, param } from 'express-validator';
import * as taskController from '../controllers/taskController';
import { authMiddleware } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';

/** Task management routes, all behind authMiddleware and scoped to req.userId. */
const router = Router();

router.use(authMiddleware);

const PRIORITIES = ['high', 'medium', 'low'];
const DEFER_OPTIONS = ['later_today', 'tomorrow', 'sometime_later'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

const createRules = [
  body('subject').isString().trim().isLength({ min: 1, max: 500 }).withMessage('subject must be 1–500 chars'),
  body('priority').isIn(PRIORITIES).withMessage('priority must be high, medium, or low'),
  body('dueDate').optional({ nullable: true }).matches(DATE_RE).withMessage('dueDate must be YYYY-MM-DD'),
  body('dueTime').optional({ nullable: true }).matches(TIME_RE).withMessage('dueTime must be HH:MM'),
  body('projectIds').optional().isArray().withMessage('projectIds must be an array'),
  body('projectIds.*').optional().isUUID().withMessage('projectIds must be UUIDs'),
  body('isRepeatable').optional().isBoolean(),
  body('repeatPattern').optional({ nullable: true }).isObject(),
];

const updateRules = [
  param('id').isUUID(),
  body('subject').optional().isString().trim().isLength({ min: 1, max: 500 }),
  body('priority').optional().isIn(PRIORITIES),
  body('dueDate').optional({ nullable: true }).matches(DATE_RE),
  body('dueTime').optional({ nullable: true }).matches(TIME_RE),
  body('projectIds').optional().isArray(),
  body('projectIds.*').optional().isUUID(),
  body('isRepeatable').optional().isBoolean(),
  body('repeatPattern').optional({ nullable: true }).isObject(),
];

router.get('/', taskController.list);
router.post('/', validate(createRules), taskController.create);
router.put('/:id', validate(updateRules), taskController.update);
router.put('/:id/complete', validate([param('id').isUUID()]), taskController.complete);
router.put(
  '/:id/defer',
  validate([param('id').isUUID(), body('option').isIn(DEFER_OPTIONS).withMessage('invalid defer option')]),
  taskController.defer,
);
router.delete('/:id', validate([param('id').isUUID()]), taskController.remove);

export default router;
