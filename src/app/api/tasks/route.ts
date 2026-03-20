import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { calculatePriorityAI } from '@/lib/priority';
import { logger } from '@/lib/logger';

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

    logger.info('POST /api/tasks', { userId, title: body.title });

    const { score, reason } = await calculatePriorityAI({
      title: body.title,
      description: body.description,
      monetaryValue: body.monetaryValue,
      revenuePotential: body.revenuePotential,
      urgency: body.urgency,
      strategicValue: body.strategicValue,
      dueDate,
    });

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
        priorityScore: score,
        priorityReason: reason,
      })
      .returning();

    logger.info('Task created', { taskId: task.id, userId, score });
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    logger.error('POST /api/tasks failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
