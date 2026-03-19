import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import TaskDetailClient from './TaskDetailClient';

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  return <TaskDetailClient task={task} />;
}
