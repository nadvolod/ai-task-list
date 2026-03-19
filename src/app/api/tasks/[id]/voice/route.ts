import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks, taskEvents } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { transcribeAndParseVoice } from '@/lib/ai';
import { calculatePriority } from '@/lib/priority';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const { id } = await params;
  const taskId = parseInt(id);

  // Verify task ownership
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const formData = await req.formData();
  const audioFile = formData.get('audio') as File | null;

  if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 });

  const arrayBuffer = await audioFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Transcribe and parse voice note
  const { transcription, metadata } = await transcribeAndParseVoice(buffer, audioFile.name || 'audio.webm', task.title);

  // Store the event
  await db.insert(taskEvents).values({
    taskId,
    eventType: 'voice_note',
    rawInput: transcription,
    parsedOutput: metadata,
  });

  // Merge new metadata with existing task data (keep highest values)
  const newMonetary = Math.max(task.monetaryValue ?? 0, metadata.monetary_value ?? 0) || null;
  const newRevenue = Math.max(task.revenuePotential ?? 0, metadata.revenue_potential ?? 0) || null;
  const newUrgency = Math.max(task.urgency ?? 0, metadata.urgency ?? 0) || null;
  const newStrategic = Math.max(task.strategicValue ?? 0, metadata.strategic_value ?? 0) || null;

  // Recalculate priority
  const { score, reason } = calculatePriority({
    monetaryValue: newMonetary,
    revenuePotential: newRevenue,
    urgency: newUrgency,
    strategicValue: newStrategic,
  });

  const notes = task.description
    ? `${task.description}\n\nVoice note: ${transcription}`
    : `Voice note: ${transcription}`;

  const [updated] = await db
    .update(tasks)
    .set({
      monetaryValue: newMonetary,
      revenuePotential: newRevenue,
      urgency: newUrgency,
      strategicValue: newStrategic,
      description: notes,
      priorityScore: score,
      priorityReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  return NextResponse.json({
    task: updated,
    transcription,
    metadata,
  });
}
