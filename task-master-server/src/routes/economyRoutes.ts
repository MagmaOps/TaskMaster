import { Router } from 'express';
import * as economyController from '../controllers/economyController';
import { authMiddleware } from '../middleware/authMiddleware';

/** Economy routes, behind authMiddleware and scoped to req.userId. */
const router = Router();

router.use(authMiddleware);
router.get('/', economyController.get);

export default router;
