import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { calculatePriority } from '@/lib/priority';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const { id } = await params;
  const taskId = parseInt(id);
  const body = await req.json();

  // Fetch the current task to merge with updates
  const [current] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);

  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Recalculate priority if any priority fields changed
  const newMonetary = body.monetaryValue !== undefined ? body.monetaryValue : current.monetaryValue;
  const newRevenue = body.revenuePotential !== undefined ? body.revenuePotential : current.revenuePotential;
  const newUrgency = body.urgency !== undefined ? body.urgency : current.urgency;
  const newStrategic = body.strategicValue !== undefined ? body.strategicValue : current.strategicValue;

  const { score, reason } = calculatePriority({
    monetaryValue: newMonetary,
    revenuePotential: newRevenue,
    urgency: newUrgency,
    strategicValue: newStrategic,
  });

  const [updated] = await db
    .update(tasks)
    .set({
      title: body.title !== undefined ? body.title : current.title,
      description: body.description !== undefined ? body.description : current.description,
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

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const { id } = await params;
  const taskId = parseInt(id);

  await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));

  return NextResponse.json({ ok: true });
}
