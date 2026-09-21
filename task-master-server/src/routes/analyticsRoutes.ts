import { Router } from 'express';
import * as analyticsController from '../controllers/analyticsController';
import { authMiddleware } from '../middleware/authMiddleware';

/** Analytics routes, behind authMiddleware and scoped to req.userId. */
const router = Router();

router.use(authMiddleware);
router.get('/projects', analyticsController.getProjects);

export default router;
