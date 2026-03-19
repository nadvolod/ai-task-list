import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks, taskEvents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { transcribeAudio, parseVoiceCommand } from '@/lib/ai';
import { calculatePriorityAI } from '@/lib/priority';
import { logger } from '@/lib/logger';
import type { VoiceCommandAction } from '@/lib/ai';

const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB

interface ActionResult {
  type: string;
  taskId?: number;
  taskTitle?: string;
  status: 'success' | 'error';
  error?: string;
  result?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    logger.info('POST /api/voice-command', { userId });

    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (audioFile.size > MAX_AUDIO_SIZE) {
      return NextResponse.json({ error: 'Audio file too large (max 10MB)' }, { status: 400 });
    }

    // Transcribe audio
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const transcription = await transcribeAudio(buffer, audioFile.name || 'recording.webm');
    logger.info('Voice command transcribed', { userId, transcription: transcription.substring(0, 100) });

    if (!transcription.trim()) {
      return NextResponse.json({
        transcription: '',
        actions: [],
        summary: "I didn't catch that. Please try again.",
      });
    }

    // Fetch user's current tasks for context
    const userTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .orderBy(desc(tasks.priorityScore));

    // Parse voice command with AI
    const commandResult = await parseVoiceCommand(transcription, userTasks);
    logger.info('Voice command parsed', {
      userId,
      actionCount: commandResult.actions.length,
      types: commandResult.actions.map(a => a.type),
    });

    // Execute each action
    const actionResults: ActionResult[] = [];
    let queryResponse: string | undefined;

    for (const action of commandResult.actions) {
      try {
        const result = await executeAction(action, userId);
        actionResults.push(result);
        if (action.type === 'query' && action.queryResponse) {
          queryResponse = action.queryResponse;
        }
      } catch (err) {
        actionResults.push({
          type: action.type,
          taskId: action.taskId,
          taskTitle: action.taskTitle,
          status: 'error',
          error: (err as Error).message,
        });
      }
    }

    logger.info('Voice command executed', {
      userId,
      results: actionResults.map(r => ({ type: r.type, status: r.status })),
    });

    return NextResponse.json({
      transcription: commandResult.transcription,
      actions: actionResults,
      summary: commandResult.summary,
      queryResponse,
    });
  } catch (err) {
    logger.error('POST /api/voice-command failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function executeAction(action: VoiceCommandAction, userId: number): Promise<ActionResult> {
  const base = { type: action.type, taskTitle: action.taskTitle };

  switch (action.type) {
    case 'add_task': {
      const title = action.fields?.title || action.taskTitle;
      if (!title) {
        return { ...base, status: 'error', error: 'No task title provided' };
      }

      const { score, reason } = await calculatePriorityAI({
        title,
        description: action.fields?.description,
        monetaryValue: action.fields?.monetaryValue,
        revenuePotential: action.fields?.revenuePotential,
        urgency: action.fields?.urgency,
        strategicValue: action.fields?.strategicValue,
      });

      const [created] = await db.insert(tasks).values({
        userId,
        title,
        description: action.fields?.description ?? null,
        sourceType: 'voice_command',
        monetaryValue: action.fields?.monetaryValue ?? null,
        revenuePotential: action.fields?.revenuePotential ?? null,
        urgency: action.fields?.urgency ?? null,
        strategicValue: action.fields?.strategicValue ?? null,
        priorityScore: score,
        priorityReason: reason,
      }).returning();

      await db.insert(taskEvents).values({
        taskId: created.id,
        eventType: 'voice_command',
        rawInput: `Added via voice: ${title}`,
        parsedOutput: action,
      });

      return {
        ...base,
        taskId: created.id,
        taskTitle: title,
        status: 'success',
        result: { id: created.id, title, priorityScore: score, priorityReason: reason },
      };
    }

    case 'mark_done':
    case 'mark_undone': {
      if (!action.taskId) {
        return { ...base, status: 'error', error: 'Could not identify which task to update' };
      }

      const newStatus = action.type === 'mark_done' ? 'done' : 'todo';
      const [updated] = await db
        .update(tasks)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(and(eq(tasks.id, action.taskId), eq(tasks.userId, userId)))
        .returning();

      if (!updated) {
        return { ...base, taskId: action.taskId, status: 'error', error: 'Task not found' };
      }

      await db.insert(taskEvents).values({
        taskId: action.taskId,
        eventType: 'voice_command',
        rawInput: `${action.type === 'mark_done' ? 'Marked done' : 'Reopened'} via voice`,
        parsedOutput: action,
      });

      return {
        ...base,
        taskId: action.taskId,
        taskTitle: updated.title,
        status: 'success',
        result: { id: updated.id, title: updated.title, status: newStatus },
      };
    }

    case 'update_task':
    case 'reprioritize': {
      if (!action.taskId) {
        return { ...base, status: 'error', error: 'Could not identify which task to update' };
      }

      // Fetch current task
      const [existing] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, action.taskId), eq(tasks.userId, userId)))
        .limit(1);

      if (!existing) {
        return { ...base, taskId: action.taskId, status: 'error', error: 'Task not found' };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (action.fields?.description) updates.description = action.fields.description;
      if (action.fields?.monetaryValue !== undefined) updates.monetaryValue = action.fields.monetaryValue;
      if (action.fields?.revenuePotential !== undefined) updates.revenuePotential = action.fields.revenuePotential;
      if (action.fields?.urgency !== undefined) updates.urgency = action.fields.urgency;
      if (action.fields?.strategicValue !== undefined) updates.strategicValue = action.fields.strategicValue;

      // Recalculate priority with merged values
      const { score, reason } = await calculatePriorityAI({
        title: existing.title,
        description: (updates.description as string) ?? existing.description,
        monetaryValue: (updates.monetaryValue as number) ?? existing.monetaryValue,
        revenuePotential: (updates.revenuePotential as number) ?? existing.revenuePotential,
        urgency: (updates.urgency as number) ?? existing.urgency,
        strategicValue: (updates.strategicValue as number) ?? existing.strategicValue,
      });

      updates.priorityScore = score;
      updates.priorityReason = reason;

      const [updated] = await db
        .update(tasks)
        .set(updates)
        .where(and(eq(tasks.id, action.taskId), eq(tasks.userId, userId)))
        .returning();

      await db.insert(taskEvents).values({
        taskId: action.taskId,
        eventType: 'voice_command',
        rawInput: `Updated via voice`,
        parsedOutput: action,
      });

      return {
        ...base,
        taskId: action.taskId,
        taskTitle: updated.title,
        status: 'success',
        result: { id: updated.id, title: updated.title, priorityScore: score, priorityReason: reason },
      };
    }

    case 'delete_task': {
      if (!action.taskId) {
        return { ...base, status: 'error', error: 'Could not identify which task to delete' };
      }

      const [deleted] = await db
        .delete(tasks)
        .where(and(eq(tasks.id, action.taskId), eq(tasks.userId, userId)))
        .returning();

      if (!deleted) {
        return { ...base, taskId: action.taskId, status: 'error', error: 'Task not found' };
      }

      return {
        ...base,
        taskId: action.taskId,
        taskTitle: deleted.title,
        status: 'success',
        result: { id: deleted.id, title: deleted.title },
      };
    }

    case 'query': {
      return {
        ...base,
        status: 'success',
        result: { response: action.queryResponse },
      };
    }

    default:
      return { ...base, status: 'error', error: `Unknown action type: ${action.type}` };
  }
}
