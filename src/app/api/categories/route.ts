import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { categoryBoosts } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { reprioritizeAllTasks } from '@/lib/priority';
import { logger } from '@/lib/logger';

/** GET: list all category boosts for the user */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = auth.userId;
    const boosts = await db.select().from(categoryBoosts).where(eq(categoryBoosts.userId, userId));
    return NextResponse.json(boosts);
  } catch (err) {
    logger.error('GET /api/categories failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST: create or update a category boost (upsert) */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = auth.userId;

    const body = await req.json();

    if (!body.category || typeof body.category !== 'string' || !body.category.trim()) {
      return NextResponse.json({ error: 'category is required' }, { status: 400 });
    }
    const boost = typeof body.boost === 'number' ? Math.max(-50, Math.min(50, Math.round(body.boost))) : 0;
    const category = body.category.trim();

    logger.info('POST /api/categories', { userId, category, boost });

    // Single-statement upsert to avoid race conditions
    const [result] = await db
      .insert(categoryBoosts)
      .values({ userId, category, boost })
      .onConflictDoUpdate({
        target: [categoryBoosts.userId, categoryBoosts.category],
        set: { boost },
        where: and(eq(categoryBoosts.userId, userId), eq(categoryBoosts.category, category)),
      })
      .returning();

    // Re-rank tasks so boost takes effect immediately
    await reprioritizeAllTasks(userId);

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    logger.error('POST /api/categories failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE: remove a category boost */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = auth.userId;

    const { searchParams } = new URL(req.url);
    const rawCategory = searchParams.get('category');
    if (!rawCategory) return NextResponse.json({ error: 'category param required' }, { status: 400 });
    const category = rawCategory.trim();

    await db.delete(categoryBoosts)
      .where(and(eq(categoryBoosts.userId, userId), eq(categoryBoosts.category, category)));

    // Re-rank tasks so removal takes effect immediately
    await reprioritizeAllTasks(userId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /api/categories failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
