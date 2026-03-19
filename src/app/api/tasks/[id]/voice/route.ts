import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks, taskEvents } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { transcribeAndParseVoice } from '@/lib/ai';
import { calculatePriorityAI } from '@/lib/priority';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const { id } = await params;
    const taskId = parseInt(id);
    if (isNaN(taskId)) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });

    logger.info('POST /api/tasks/:id/voice', { userId, taskId });

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

    const { transcription, metadata } = await transcribeAndParseVoice(buffer, audioFile.name || 'audio.webm', task.title);
    logger.info('Voice transcribed', { taskId, transcription: transcription.substring(0, 100) });

    await db.insert(taskEvents).values({
      taskId,
      eventType: 'voice_note',
      rawInput: transcription,
      parsedOutput: metadata,
    });

    // Use voice values if provided, otherwise keep existing
    const newMonetary = metadata.monetary_value !== undefined && metadata.monetary_value !== null
      ? metadata.monetary_value : task.monetaryValue;
    const newRevenue = metadata.revenue_potential !== undefined && metadata.revenue_potential !== null
      ? metadata.revenue_potential : task.revenuePotential;
    const newUrgency = metadata.urgency !== undefined && metadata.urgency !== null
      ? metadata.urgency : task.urgency;
    const newStrategic = metadata.strategic_value !== undefined && metadata.strategic_value !== null
      ? metadata.strategic_value : task.strategicValue;

    const { score, reason } = await calculatePriorityAI({
      title: task.title,
      description: task.description,
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

    logger.info('Task updated via voice', { taskId, score });
    return NextResponse.json({ task: updated, transcription, metadata });
  } catch (err) {
    logger.error('POST /api/tasks/:id/voice failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
