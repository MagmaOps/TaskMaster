import { Router } from 'express';
import * as streaksController from '../controllers/streaksController';
import { authMiddleware } from '../middleware/authMiddleware';

/** Streaks routes, behind authMiddleware and scoped to req.userId. */
const router = Router();

router.use(authMiddleware);
router.get('/', streaksController.get);

export default router;
