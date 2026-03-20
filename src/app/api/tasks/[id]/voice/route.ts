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

    // Validate and clamp voice metadata before using
    const clampPositive = (v: unknown): number | null => {
      if (v === undefined || v === null || typeof v !== 'number' || isNaN(v)) return null;
      return Math.max(v, 0);
    };
    const clamp1to10 = (v: unknown): number | null => {
      if (v === undefined || v === null || typeof v !== 'number' || isNaN(v)) return null;
      return Math.max(1, Math.min(10, Math.round(v)));
    };

    const parsedMonetary = clampPositive(metadata.monetary_value);
    const parsedRevenue = clampPositive(metadata.revenue_potential);
    const parsedUrgency = clamp1to10(metadata.urgency);
    const parsedStrategic = clamp1to10(metadata.strategic_value);

    // Parse due date from voice metadata
    let parsedDueDate: Date | null = null;
    if (metadata.due_date) {
      const d = new Date(metadata.due_date);
      if (!isNaN(d.getTime())) parsedDueDate = d;
    }

    // Use voice values if valid, otherwise keep existing
    const newMonetary = parsedMonetary !== null ? parsedMonetary : task.monetaryValue;
    const newRevenue = parsedRevenue !== null ? parsedRevenue : task.revenuePotential;
    const newUrgency = parsedUrgency !== null ? parsedUrgency : task.urgency;
    const newStrategic = parsedStrategic !== null ? parsedStrategic : task.strategicValue;
    const newDueDate = parsedDueDate !== null ? parsedDueDate : task.dueDate;

    const { score, reason } = await calculatePriorityAI({
      title: task.title,
      description: task.description,
      monetaryValue: newMonetary,
      revenuePotential: newRevenue,
      urgency: newUrgency,
      strategicValue: newStrategic,
      dueDate: newDueDate,
    });

    // Cap description length to prevent unbounded growth from multiple voice notes
    const MAX_DESCRIPTION_LENGTH = 2000;
    const voiceAppend = `Voice note: ${transcription}`;
    let notes: string;
    if (!task.description) {
      notes = voiceAppend;
    } else if (task.description.length + voiceAppend.length + 2 > MAX_DESCRIPTION_LENGTH) {
      notes = task.description; // Don't append if it would exceed cap
    } else {
      notes = `${task.description}\n\n${voiceAppend}`;
    }

    const [updated] = await db
      .update(tasks)
      .set({
        monetaryValue: newMonetary,
        revenuePotential: newRevenue,
        urgency: newUrgency,
        strategicValue: newStrategic,
        description: notes,
        dueDate: newDueDate,
        priorityScore: score,
        priorityReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
      .returning();

    logger.info('Task updated via voice', { taskId, score });
    return NextResponse.json({ task: updated, transcription, metadata });
  } catch (err) {
    logger.error('POST /api/tasks/:id/voice failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
