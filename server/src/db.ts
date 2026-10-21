import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
pool.on('error', (e) => console.warn('[db] pool error:', e.message));

export let dbReady = false;

/** Returns true if DB can respond to SELECT 1. */
export async function dbAlive(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Boot-time DB init with exponential back-off retries. */
export async function initDb(attempts = 10): Promise<void> {
  const schemaPath = path.resolve(__dirname, '../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query(sql);
      dbReady = true;
      console.log('[db] ready');
      return;
    } catch (e) {
      const delay = Math.min(1000 * i, 5000);
      console.warn(`[db] attempt ${i}/${attempts} failed: ${(e as Error).message} — retrying in ${delay}ms`);
      if (i < attempts) await new Promise((r) => setTimeout(r, delay));
    }
  }
  dbReady = false;
  console.warn('[db] not available after all attempts, continuing file-only');
}
