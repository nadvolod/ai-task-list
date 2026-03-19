import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { calculatePriority } from '@/lib/priority';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const userTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.priorityScore));

  return NextResponse.json(userTasks);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const body = await req.json();

  const { score, reason } = calculatePriority({
    monetaryValue: body.monetaryValue,
    revenuePotential: body.revenuePotential,
    urgency: body.urgency,
    strategicValue: body.strategicValue,
  });

  const [task] = await db
    .insert(tasks)
    .values({
      userId,
      title: body.title,
      description: body.description,
      sourceType: body.sourceType ?? 'manual',
      monetaryValue: body.monetaryValue,
      revenuePotential: body.revenuePotential,
      urgency: body.urgency,
      strategicValue: body.strategicValue,
      confidence: body.confidence,
      priorityScore: score,
      priorityReason: reason,
    })
    .returning();

  return NextResponse.json(task, { status: 201 });
}
