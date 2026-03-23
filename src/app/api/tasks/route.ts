import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { reprioritizeAllTasks } from '@/lib/priority';
import { logger } from '@/lib/logger';
import { defaultAssigneeFromEmail, normalizeAssignee } from '@/lib/assignee';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    logger.info('GET /api/tasks', { userId });

    const userTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .orderBy(desc(tasks.priorityScore));

    return NextResponse.json(userTasks);
  } catch (err) {
    logger.error('GET /api/tasks failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const body = await req.json();

    // Input validation
    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (body.monetaryValue != null && (typeof body.monetaryValue !== 'number' || body.monetaryValue < 0)) {
      return NextResponse.json({ error: 'monetaryValue must be a non-negative number' }, { status: 400 });
    }
    if (body.revenuePotential != null && (typeof body.revenuePotential !== 'number' || body.revenuePotential < 0)) {
      return NextResponse.json({ error: 'revenuePotential must be a non-negative number' }, { status: 400 });
    }
    if (body.urgency != null && (typeof body.urgency !== 'number' || body.urgency < 1 || body.urgency > 10)) {
      return NextResponse.json({ error: 'urgency must be between 1 and 10' }, { status: 400 });
    }
    if (body.strategicValue != null && (typeof body.strategicValue !== 'number' || body.strategicValue < 1 || body.strategicValue > 10)) {
      return NextResponse.json({ error: 'strategicValue must be between 1 and 10' }, { status: 400 });
    }
    let dueDate: Date | null = null;
    if (body.dueDate) {
      dueDate = new Date(body.dueDate);
      if (isNaN(dueDate.getTime())) {
        return NextResponse.json({ error: 'dueDate must be a valid date' }, { status: 400 });
      }
    }

    // Validate parentId for subtask creation
    let parentId: number | null = null;
    let subtaskOrder: number | null = null;
    if (body.parentId != null) {
      parentId = parseInt(body.parentId);
      if (isNaN(parentId)) {
        return NextResponse.json({ error: 'parentId must be a valid number' }, { status: 400 });
      }
      const [parent] = await db.select().from(tasks)
        .where(and(eq(tasks.id, parentId), eq(tasks.userId, userId)))
        .limit(1);
      if (!parent) {
        return NextResponse.json({ error: 'Parent task not found' }, { status: 404 });
      }
      if (parent.parentId != null) {
        return NextResponse.json({ error: 'Cannot nest subtasks more than one level deep' }, { status: 400 });
      }
      // Auto-set subtaskOrder to max+1 (handles gaps from deletions)
      const [orderResult] = await db.select({
        nextOrder: sql<number>`coalesce(max(${tasks.subtaskOrder}), -1) + 1`,
      }).from(tasks)
        .where(and(eq(tasks.parentId, parentId), eq(tasks.userId, userId)));
      subtaskOrder = Number(orderResult.nextOrder);
    }

    // Validate recurrenceEndDate
    let recurrenceEndDate: Date | null = null;
    if (body.recurrenceEndDate) {
      recurrenceEndDate = new Date(body.recurrenceEndDate);
      if (isNaN(recurrenceEndDate.getTime())) {
        return NextResponse.json({ error: 'recurrenceEndDate must be a valid date' }, { status: 400 });
      }
    }

    // Validate recurrenceRule
    const validRules = ['daily', 'weekly', 'biweekly', 'monthly'];
    if (body.recurrenceRule && !validRules.includes(body.recurrenceRule)) {
      return NextResponse.json({ error: 'recurrenceRule must be daily, weekly, biweekly, or monthly' }, { status: 400 });
    }

    logger.info('POST /api/tasks', { userId, title: body.title, parentId });

    const [task] = await db
      .insert(tasks)
      .values({
        userId,
        title: body.title.trim(),
        description: body.description,
        sourceType: body.sourceType ?? 'manual',
        monetaryValue: body.monetaryValue,
        revenuePotential: body.revenuePotential,
        urgency: body.urgency,
        strategicValue: body.strategicValue,
        confidence: body.confidence,
        dueDate,
        parentId,
        subtaskOrder,
        recurrenceRule: body.recurrenceRule ?? null,
        recurrenceDays: body.recurrenceDays ?? null,
        recurrenceEndDate,
        category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null,
        assignee: normalizeAssignee(body.assignee) ?? defaultAssigneeFromEmail(session.user.email),
      })
      .returning();

    await reprioritizeAllTasks(userId);

    // Re-fetch the task to get updated priority score
    const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));

    logger.info('Task created', { taskId: task.id, userId, score: updated.priorityScore });
    return NextResponse.json(updated, { status: 201 });
  } catch (err) {
    logger.error('POST /api/tasks failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
