import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * Generate the next sequential short code for a user's tasks.
 * Returns "T-1", "T-2", etc.
 */
export async function nextShortCode(userId: number): Promise<string> {
  const [result] = await db.select({
    maxNum: sql<number>`coalesce(max(cast(substring(short_code from 3) as integer)), 0)`,
  }).from(tasks).where(eq(tasks.userId, userId));

  const next = (result?.maxNum ?? 0) + 1;
  return `T-${next}`;
}
