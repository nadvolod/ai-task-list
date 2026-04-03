import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import TaskDetailClient from './TaskDetailClient';
import type { Task } from '@/types/task';

export default async function TaskDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/auth/signin');

  const { id } = await params;
  const taskId = parseInt(id);
  if (isNaN(taskId)) notFound();

  const userId = parseInt(session.user.id);
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);

  if (!task) notFound();

  const serialized = {
    ...task,
    status: task.status as Task['status'],
    dueDate: task.dueDate?.toISOString() ?? null,
    recurrenceEndDate: task.recurrenceEndDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };

  const { edit } = await searchParams;
  return <TaskDetailClient task={serialized} autoEdit={edit === 'true'} />;
}
