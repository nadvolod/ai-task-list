import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and, or, gt, isNull, desc } from 'drizzle-orm';
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

    const moneyTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, auth.userId),
          isNull(tasks.parentId),
          or(gt(tasks.monetaryValue, 0), gt(tasks.revenuePotential, 0)),
        ),
      )
      .orderBy(desc(tasks.monetaryValue));

    // Stats are computed client-side to avoid server/client timezone mismatch.
    // The client knows the user's local midnight; the server doesn't.
    return NextResponse.json({
      tasks: moneyTasks.map(serializeTask),
    });
  } catch (err) {
    console.error('GET /api/money failed', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
