import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks, priorityOverrides } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { reprioritizeAllTasks } from '@/lib/priority';
import { computeNextDueDate, shouldCreateNextInstance, type RecurrenceConfig } from '@/lib/recurrence';
import { logger } from '@/lib/logger';

/**
 * Shared logic: when a recurring task is completed, spawn the next instance.
 * Returns the new task or null.
 */
export async function spawnNextRecurringInstance(
  current: typeof tasks.$inferSelect
): Promise<typeof tasks.$inferSelect | null> {
  if (!current.recurrenceRule) return null;

  const config: RecurrenceConfig = {
    rule: current.recurrenceRule as RecurrenceConfig['rule'],
    days: current.recurrenceDays ? current.recurrenceDays.split(',').map(Number) : undefined,
    endDate: current.recurrenceEndDate ?? undefined,
    active: current.recurrenceActive !== 'false',
  };

  if (!shouldCreateNextInstance(config, current.dueDate)) return null;

  const nextDue = computeNextDueDate(current.dueDate, config);
  const recurrenceParentId = current.recurrenceParentId ?? current.id;

  const [newTask] = await db.insert(tasks).values({
    userId: current.userId,
    title: current.title,
    description: current.description,
    sourceType: current.sourceType,
    monetaryValue: current.monetaryValue,
    revenuePotential: current.revenuePotential,
    urgency: current.urgency,
    strategicValue: current.strategicValue,
    assignee: current.assignee,
    parentId: current.parentId,
    recurrenceRule: current.recurrenceRule,
    recurrenceDays: current.recurrenceDays,
    recurrenceEndDate: current.recurrenceEndDate,
    recurrenceParentId,
    recurrenceActive: current.recurrenceActive,
    dueDate: nextDue,
  }).returning();

  return newTask;
}

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

    // Validate fields if provided
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim().length === 0)) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    if (body.monetaryValue !== undefined && body.monetaryValue !== null && (typeof body.monetaryValue !== 'number' || body.monetaryValue < 0)) {
      return NextResponse.json({ error: 'monetaryValue must be a non-negative number' }, { status: 400 });
    }
    if (body.revenuePotential !== undefined && body.revenuePotential !== null && (typeof body.revenuePotential !== 'number' || body.revenuePotential < 0)) {
      return NextResponse.json({ error: 'revenuePotential must be a non-negative number' }, { status: 400 });
    }
    if (body.urgency !== undefined && body.urgency !== null && (typeof body.urgency !== 'number' || body.urgency < 1 || body.urgency > 10)) {
      return NextResponse.json({ error: 'urgency must be between 1 and 10' }, { status: 400 });
    }
    if (body.strategicValue !== undefined && body.strategicValue !== null && (typeof body.strategicValue !== 'number' || body.strategicValue < 1 || body.strategicValue > 10)) {
      return NextResponse.json({ error: 'strategicValue must be between 1 and 10' }, { status: 400 });
    }
    if (body.status !== undefined && !['todo', 'done'].includes(body.status)) {
      return NextResponse.json({ error: 'status must be "todo" or "done"' }, { status: 400 });
    }
    let parsedDueDate: Date | null | undefined = undefined;
    if (body.dueDate !== undefined) {
      if (body.dueDate === null) {
        parsedDueDate = null;
      } else {
        parsedDueDate = new Date(body.dueDate);
        if (isNaN(parsedDueDate.getTime())) {
          return NextResponse.json({ error: 'dueDate must be a valid date' }, { status: 400 });
        }
      }
    }

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
    const newDueDate = parsedDueDate !== undefined ? parsedDueDate : current.dueDate;
    const newAssignee = body.assignee !== undefined ? body.assignee : current.assignee;
    const newRecurrenceRule = body.recurrenceRule !== undefined ? body.recurrenceRule : current.recurrenceRule;
    const newRecurrenceDays = body.recurrenceDays !== undefined ? body.recurrenceDays : current.recurrenceDays;
    const newRecurrenceActive = body.recurrenceActive !== undefined ? body.recurrenceActive : current.recurrenceActive;

    // Handle manual priority override (Issue #11)
    let newManualPriorityScore = current.manualPriorityScore;
    let newManualPriorityReason = current.manualPriorityReason;
    if (body.manualPriorityScore !== undefined) {
      newManualPriorityScore = body.manualPriorityScore;
      newManualPriorityReason = body.manualPriorityReason ?? null;

      // Record the override in history
      if (body.manualPriorityScore !== null) {
        await db.insert(priorityOverrides).values({
          taskId,
          userId,
          previousScore: current.priorityScore,
          newScore: body.manualPriorityScore,
          reason: body.manualPriorityReason ?? 'Manual override',
          source: body.overrideSource ?? 'manual',
        });
      }
    }

    const newStatus = body.status !== undefined ? body.status : current.status;

    await db
      .update(tasks)
      .set({
        title: newTitle,
        description: newDescription,
        status: newStatus,
        monetaryValue: newMonetary,
        revenuePotential: newRevenue,
        urgency: newUrgency,
        strategicValue: newStrategic,
        manualOrder: body.manualOrder !== undefined ? body.manualOrder : current.manualOrder,
        dueDate: newDueDate,
        assignee: newAssignee,
        recurrenceRule: newRecurrenceRule,
        recurrenceDays: newRecurrenceDays,
        recurrenceActive: newRecurrenceActive,
        manualPriorityScore: newManualPriorityScore,
        manualPriorityReason: newManualPriorityReason,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));

    // Subtask cascade: marking parent done → complete all subtasks
    if (body.status === 'done' && current.parentId === null) {
      await db
        .update(tasks)
        .set({ status: 'done', updatedAt: new Date() })
        .where(and(eq(tasks.parentId, taskId), eq(tasks.userId, userId)));
    }

    // Subtask cascade: check if completing last subtask → auto-complete parent
    let parentAutoCompleted = false;
    if (body.status === 'done' && current.parentId !== null) {
      const siblings = await db.select().from(tasks)
        .where(and(eq(tasks.parentId, current.parentId), eq(tasks.userId, userId)));
      const allDone = siblings.every(s => s.id === taskId ? true : s.status === 'done');
      if (allDone) {
        await db.update(tasks)
          .set({ status: 'done', updatedAt: new Date() })
          .where(and(eq(tasks.id, current.parentId), eq(tasks.userId, userId)));
        parentAutoCompleted = true;
      }
    }

    // Recurring task: spawn next instance on completion (Issue #9)
    let nextInstance = null;
    if (body.status === 'done' && current.status !== 'done') {
      const updatedCurrent = { ...current, dueDate: newDueDate };
      nextInstance = await spawnNextRecurringInstance(updatedCurrent);
    }

    await reprioritizeAllTasks(userId);

    // Re-fetch to get updated priority score
    const [updated] = await db.select().from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));

    logger.info('Task updated', { taskId, userId, score: updated.priorityScore });

    const response: Record<string, unknown> = { ...updated };
    if (parentAutoCompleted) response.parentAutoCompleted = true;
    if (nextInstance) response.nextInstance = nextInstance;

    return NextResponse.json(response);
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

    // Re-rank remaining tasks now that one is removed
    await reprioritizeAllTasks(userId);

    logger.info('Task deleted', { taskId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /api/tasks/:id failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
