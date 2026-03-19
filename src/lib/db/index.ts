import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Lazy database connection - only created when first accessed
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

// Proxy export for convenience - matches the original `db` usage pattern
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof drizzle>];
  },
});
