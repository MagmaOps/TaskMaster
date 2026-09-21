import { Router } from 'express';
import * as achievementsController from '../controllers/achievementsController';
import { authMiddleware } from '../middleware/authMiddleware';

/** Achievements routes, behind authMiddleware and scoped to req.userId. */
const router = Router();

router.use(authMiddleware);
router.get('/', achievementsController.get);

export default router;
