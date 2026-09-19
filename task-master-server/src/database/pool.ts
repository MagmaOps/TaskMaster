import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config';

/**
 * Shared PostgreSQL connection pool.
 * All data access goes through query()/withTransaction() below.
 */
export const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
  max: config.database.poolMax,
  idleTimeoutMillis: config.database.poolIdleTimeoutMs,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Run a parameterized query. Always use $1, $2, ... placeholders — never string
 * interpolation — to prevent SQL injection.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/**
 * Run a set of statements inside a single transaction. Commits on success,
 * rolls back on any thrown error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Lightweight health check used by the /health endpoint. */
export async function checkConnection(): Promise<boolean> {
  try {
    const res = await pool.query('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

/** Close the pool (used on graceful shutdown and in tests). */
export async function closePool(): Promise<void> {
  await pool.end();
}
