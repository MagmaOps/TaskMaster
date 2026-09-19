import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Runs once before the whole test suite: loads .env.test and applies all
 * migrations to the (ephemeral) test database.
 */
export default async function globalSetup(): Promise<void> {
  const envPath = path.resolve(__dirname, '../../.env.test');
  dotenv.config({ path: envPath, override: true });

  // Apply migrations to the test DB. Uses the .env.test DATABASE_URL.
  execSync(
    'node-pg-migrate up -m src/database/migrations -j ts --tsconfig tsconfig.json --envPath .env.test',
    { stdio: 'inherit', cwd: path.resolve(__dirname, '../../') },
  );
}
