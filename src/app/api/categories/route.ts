import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { categoryBoosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/** GET: list all category boosts for the user */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const boosts = await db.select().from(categoryBoosts).where(eq(categoryBoosts.userId, userId));
    return NextResponse.json(boosts);
  } catch (err) {
    logger.error('GET /api/categories failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST: create or update a category boost */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const body = await req.json();

    if (!body.category || typeof body.category !== 'string' || !body.category.trim()) {
      return NextResponse.json({ error: 'category is required' }, { status: 400 });
    }
    const boost = typeof body.boost === 'number' ? Math.max(-50, Math.min(50, Math.round(body.boost))) : 0;
    const category = body.category.trim();

    logger.info('POST /api/categories', { userId, category, boost });

    // Upsert: update if exists, insert if not
    const [existing] = await db.select().from(categoryBoosts)
      .where(and(eq(categoryBoosts.userId, userId), eq(categoryBoosts.category, category)))
      .limit(1);

    if (existing) {
      await db.update(categoryBoosts)
        .set({ boost })
        .where(eq(categoryBoosts.id, existing.id));
      return NextResponse.json({ ...existing, boost });
    }

    const [created] = await db.insert(categoryBoosts)
      .values({ userId, category, boost })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    logger.error('POST /api/categories failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE: remove a category boost */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    if (!category) return NextResponse.json({ error: 'category param required' }, { status: 400 });

    await db.delete(categoryBoosts)
      .where(and(eq(categoryBoosts.userId, userId), eq(categoryBoosts.category, category)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /api/categories failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
