import { Router } from 'express';
import { body, param } from 'express-validator';
import * as projectController from '../controllers/projectController';
import { authMiddleware } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';

/** Project routes, all behind authMiddleware and scoped to req.userId. */
const router = Router();

router.use(authMiddleware);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const createRules = [
  body('name').isString().trim().isLength({ min: 1, max: 255 }).withMessage('name must be 1–255 chars'),
  body('color').optional({ nullable: true }).matches(HEX_COLOR_RE).withMessage('color must be #RRGGBB'),
];

const updateRules = [
  param('id').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 1, max: 255 }),
  body('color').optional({ nullable: true }).matches(HEX_COLOR_RE).withMessage('color must be #RRGGBB'),
];

router.get('/', projectController.list);
router.post('/', validate(createRules), projectController.create);
// Declared before '/:id' so "reorder" is not captured as an id.
router.put(
  '/reorder',
  validate([
    body('projectIds').isArray({ min: 1 }).withMessage('projectIds must be a non-empty array'),
    body('projectIds.*').isUUID().withMessage('projectIds must be UUIDs'),
  ]),
  projectController.reorder,
);
router.put('/:id', validate(updateRules), projectController.update);
router.delete('/:id', validate([param('id').isUUID()]), projectController.remove);

export default router;
