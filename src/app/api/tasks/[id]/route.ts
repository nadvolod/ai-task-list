import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { calculatePriorityAI } from '@/lib/priority';
import { logger } from '@/lib/logger';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const { id } = await params;
    const taskId = parseInt(id);
    if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });

    logger.info('PATCH /api/tasks/:id', { userId, taskId });

    const body = await req.json();

    const [current] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .limit(1);

    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const newTitle = body.title !== undefined ? body.title : current.title;
    const newDescription = body.description !== undefined ? body.description : current.description;
    const newMonetary = body.monetaryValue !== undefined ? body.monetaryValue : current.monetaryValue;
    const newRevenue = body.revenuePotential !== undefined ? body.revenuePotential : current.revenuePotential;
    const newUrgency = body.urgency !== undefined ? body.urgency : current.urgency;
    const newStrategic = body.strategicValue !== undefined ? body.strategicValue : current.strategicValue;

    const { score, reason } = await calculatePriorityAI({
      title: newTitle,
      description: newDescription,
      monetaryValue: newMonetary,
      revenuePotential: newRevenue,
      urgency: newUrgency,
      strategicValue: newStrategic,
    });

    const [updated] = await db
      .update(tasks)
      .set({
        title: newTitle,
        description: newDescription,
        status: body.status !== undefined ? body.status : current.status,
        monetaryValue: newMonetary,
        revenuePotential: newRevenue,
        urgency: newUrgency,
        strategicValue: newStrategic,
        manualOrder: body.manualOrder !== undefined ? body.manualOrder : current.manualOrder,
        priorityScore: score,
        priorityReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning();

    logger.info('Task updated', { taskId, userId, score });
    return NextResponse.json(updated);
  } catch (err) {
    logger.error('PATCH /api/tasks/:id failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const { id } = await params;
    const taskId = parseInt(id);
    if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });

    logger.info('DELETE /api/tasks/:id', { userId, taskId });

    await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));

    logger.info('Task deleted', { taskId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /api/tasks/:id failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
