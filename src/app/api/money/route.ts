import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and, or, gt, desc } from 'drizzle-orm';
import type { Task } from '@/types/task';

function serializeTask(t: typeof tasks.$inferSelect): Task & { createdAt: string } {
  return {
    ...t,
    status: t.status as Task['status'],
    dueDate: t.dueDate?.toISOString() ?? null,
    recurrenceEndDate: t.recurrenceEndDate?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allMoneyTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, auth.userId),
          // Only parent tasks (not subtasks)
          // parentId is null for top-level tasks
          or(gt(tasks.monetaryValue, 0), gt(tasks.revenuePotential, 0)),
        ),
      )
      .orderBy(desc(tasks.monetaryValue));

    // Filter to parent tasks only (parentId is null)
    const parentMoneyTasks = allMoneyTasks.filter(t => t.parentId === null);

    // Calculate stats
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const completedToday = parentMoneyTasks.filter(
      t => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= startOfToday,
    );

    const movedToday = completedToday.reduce((sum, t) => sum + (t.monetaryValue ?? 0), 0);
    const dealsClosedToday = completedToday.length;

    const activeTasks = parentMoneyTasks.filter(t => t.status !== 'done');
    const stillInPlay = activeTasks.reduce((sum, t) => sum + (t.monetaryValue ?? 0), 0);

    return NextResponse.json({
      stats: {
        movedToday,
        dealsClosedToday,
        stillInPlay,
      },
      tasks: parentMoneyTasks.map(serializeTask),
    });
  } catch (err) {
    console.error('GET /api/money failed', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
