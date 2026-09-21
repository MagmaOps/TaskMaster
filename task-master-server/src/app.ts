import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { checkConnection } from './database/pool';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import taskRoutes from './routes/taskRoutes';
import projectRoutes from './routes/projectRoutes';
import economyRoutes from './routes/economyRoutes';
import streaksRoutes from './routes/streaksRoutes';
import achievementsRoutes from './routes/achievementsRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import { registerAllListeners } from './services/completion/registerListeners';

/** Builds the Express application with middleware and routes wired up. */
export function createApp(): Application {
  // Register completion-event listeners (economy, and later streaks/achievements/
  // recurrence/analytics). Guarded to run once per process.
  registerAllListeners();

  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.cors.origin, credentials: config.cors.credentials }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Health check (used by k8s probes and the frontend).
  app.get('/health', async (_req, res) => {
    const dbHealthy = await checkConnection();
    res.status(dbHealthy ? 200 : 503).json({
      status: dbHealthy ? 'ok' : 'degraded',
      environment: config.env,
      database: dbHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api', (_req, res) => {
    res.json({ success: true, data: { name: 'TaskMaster API', version: '2.0.0' } });
  });

  // Feature routes.
  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/economy', economyRoutes);
  app.use('/api/streaks', streaksRoutes);
  app.use('/api/achievements', achievementsRoutes);
  app.use('/api/analytics', analyticsRoutes);

  // 404 + centralized error handling (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
