import path from 'path';
import dotenv from 'dotenv';

// Ensure test env is loaded in each worker before config/pool are imported.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });

import { pool, closePool } from '../database/pool';

/** Truncate all data tables before each test for isolation. */
beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE refresh_tokens, oauth_accounts, deferrals, task_projects,
       achievements, streaks, tasks, projects, users RESTART IDENTITY CASCADE;`,
  );
});

afterAll(async () => {
  await closePool();
});
