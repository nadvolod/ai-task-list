import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and, or, desc } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const { id } = await params;
    const taskId = parseInt(id);
    if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });

    // Fetch the task to find its recurrence chain
    const [task] = await db.select().from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);

    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // The chain parent is either this task (if it has no recurrenceParentId) or the recurrenceParentId
    const chainParentId = task.recurrenceParentId ?? task.id;

    // Find all tasks in this recurrence chain
    const history = await db.select().from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        or(
          eq(tasks.id, chainParentId),
          eq(tasks.recurrenceParentId, chainParentId)
        )
      ))
      .orderBy(desc(tasks.createdAt));

    logger.info('GET /api/tasks/:id/history', { userId, taskId, chainSize: history.length });
    return NextResponse.json({ history });
  } catch (err) {
    logger.error('GET /api/tasks/:id/history failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
