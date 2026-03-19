import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export async function GET() {
  const checks: Record<string, string> = {};

  try {
    const result = await db.select({ count: sql<number>`count(*)` }).from(users);
    checks.database = `ok (${result[0].count} users)`;
  } catch (err) {
    checks.database = `error: ${(err as Error).message}`;
  }

  checks.openai = process.env.OPENAI_API_KEY ? 'configured' : 'missing';

  return NextResponse.json({
    status: checks.database.startsWith('ok') ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
}
