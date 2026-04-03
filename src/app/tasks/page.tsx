import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import TaskListClient from './TaskListClient';
import type { Task } from '@/types/task';

export default async function TasksPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/auth/signin');

  const userId = parseInt(session.user.id);
  const userTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.priorityScore));

  const serialized = userTasks.map(t => ({
    ...t,
    status: t.status as Task['status'],
    dueDate: t.dueDate?.toISOString() ?? null,
    recurrenceEndDate: t.recurrenceEndDate?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  return <TaskListClient initialTasks={serialized} />;
}
