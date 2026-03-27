import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { tasks, taskEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { transcribeAndCreateTasks } from '@/lib/ai';
import { reprioritizeAllTasks } from '@/lib/priority';
import { logger } from '@/lib/logger';
import { defaultAssigneeFromEmail, normalizeAssignee } from '@/lib/assignee';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = auth.userId;

    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 });

    logger.info('POST /api/voice-capture', { userId });

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { transcription, tasks: parsedTasks } = await transcribeAndCreateTasks(
      buffer,
      audioFile.name || 'audio.webm'
    );

    logger.info('Voice captured', { userId, transcription: transcription.substring(0, 100), taskCount: parsedTasks.length });

    const createdTasks = [];

    for (const parsed of parsedTasks) {
      if (!parsed.title || parsed.title.trim().length === 0) continue;

      let dueDate: Date | null = null;
      if (parsed.due_date) {
        const d = new Date(parsed.due_date);
        if (!isNaN(d.getTime())) dueDate = d;
      }

      const monetaryValue = typeof parsed.monetary_value === 'number' && parsed.monetary_value >= 0 ? parsed.monetary_value : null;
      const revenuePotential = typeof parsed.revenue_potential === 'number' && parsed.revenue_potential >= 0 ? parsed.revenue_potential : null;
      const urgency = typeof parsed.urgency === 'number' ? Math.max(1, Math.min(10, Math.round(parsed.urgency))) : null;
      const strategicValue = typeof parsed.strategic_value === 'number' ? Math.max(1, Math.min(10, Math.round(parsed.strategic_value))) : null;

      const [task] = await db
        .insert(tasks)
        .values({
          userId,
          title: parsed.title.trim(),
          description: parsed.description || null,
          sourceType: 'voice_context',
          monetaryValue,
          revenuePotential,
          urgency,
          strategicValue,
          dueDate,
          recurrenceRule: parsed.recurrence_rule ?? null,
          recurrenceDays: parsed.recurrence_days ?? null,
          assignee: normalizeAssignee(parsed.assignee) ?? defaultAssigneeFromEmail(auth.email),
          category: parsed.category ?? null,
          project: parsed.project ?? null,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        })
        .returning();

      await db.insert(taskEvents).values({
        taskId: task.id,
        eventType: 'voice_note',
        rawInput: transcription,
        parsedOutput: parsed,
      });

      // Create subtasks if present
      if (parsed.subtasks && parsed.subtasks.length > 0) {
        for (let i = 0; i < parsed.subtasks.length; i++) {
          const sub = parsed.subtasks[i];
          if (!sub.title?.trim()) continue;
          await db.insert(tasks).values({
            userId,
            title: sub.title.trim(),
            description: sub.description || null,
            sourceType: 'voice_context',
            parentId: task.id,
            subtaskOrder: i,
          });
        }
      }

      createdTasks.push(task);
    }

    // Re-rank all tasks relative to each other
    if (createdTasks.length > 0) {
      await reprioritizeAllTasks(userId);
    }

    // Re-fetch to get updated scores
    const updatedTasks = [];
    for (const t of createdTasks) {
      const [refreshed] = await db.select().from(tasks).where(eq(tasks.id, t.id));
      updatedTasks.push(refreshed);
    }

    logger.info('Voice tasks created', { userId, count: updatedTasks.length });
    return NextResponse.json({ tasks: updatedTasks, transcription }, { status: 201 });
  } catch (err) {
    logger.error('POST /api/voice-capture failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
