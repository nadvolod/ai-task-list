import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export async function GET() {
  logger.info('GET /api/health');
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = 'ok';
  } catch (err) {
    checks.database = `error: ${(err as Error).message}`;
    healthy = false;
    logger.error('Health check: database failed', { error: (err as Error).message });
  }

  checks.openai = process.env.OPENAI_API_KEY ? 'configured' : 'missing';
  checks.google_api = process.env.GOOGLE_API_KEY ? 'configured' : 'missing';

  logger.info('GET /api/health', { status: healthy ? 'healthy' : 'degraded' });

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
