import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks, taskEvents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { transcribeAndClassifyIntent, generateSpeech, type VoiceIntent } from '@/lib/ai';
import { reprioritizeAllTasks } from '@/lib/priority';
import { spawnNextRecurringInstance } from '@/lib/task-operations';
import { priorityOverrides } from '@/lib/db/schema';
import { logger } from '@/lib/logger';

interface TaskRow {
  id: number;
  title: string;
  status: string;
  priorityScore: number;
  priorityReason: string | null;
  monetaryValue: number | null;
  revenuePotential: number | null;
  urgency: number | null;
  strategicValue: number | null;
  dueDate: Date | null;
  description: string | null;
  parentId: number | null;
  category: string | null;
  recurrenceRule: string | null;
  recurrenceDays: string | null;
  recurrenceEndDate: Date | null;
  recurrenceParentId: number | null;
  recurrenceActive: string | null;
  assignee: string | null;
  manualPriorityScore: number | null;
  manualPriorityReason: string | null;
}

function fuzzyMatch(query: string, tasks: TaskRow[]): TaskRow | null {
  const q = query.toLowerCase();
  // Exact substring match first
  const exact = tasks.find(t => t.title.toLowerCase().includes(q));
  if (exact) return exact;
  // Word overlap match
  const queryWords = q.split(/\s+/).filter(w => w.length > 2);
  let bestMatch: TaskRow | null = null;
  let bestScore = 0;
  for (const task of tasks) {
    const titleLower = task.title.toLowerCase();
    const score = queryWords.filter(w => titleLower.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = task;
    }
  }
  return bestScore > 0 ? bestMatch : null;
}

function formatDueDate(d: Date | null): string {
  if (!d) return '';
  const now = new Date();
  const diffDays = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `overdue by ${Math.abs(diffDays)} days`;
  if (diffDays === 0) return 'due today';
  if (diffDays === 1) return 'due tomorrow';
  return `due in ${diffDays} days`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    const speakResponse = formData.get('speak') === 'true';
    if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 });

    logger.info('POST /api/voice-command', { userId });

    // Fetch user's tasks for context
    const userTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .orderBy(desc(tasks.priorityScore));

    const taskTitles = userTasks.map(t => t.title);

    // Transcribe and classify intent
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { transcription, intent } = await transcribeAndClassifyIntent(
      buffer,
      audioFile.name || 'audio.webm',
      taskTitles
    );

    logger.info('Voice command classified', { userId, intent: intent.intent, transcription: transcription.substring(0, 100) });

    // Execute the intent
    const result = await executeIntent(intent, userId, userTasks);

    // Generate TTS if requested
    let speechUrl: string | null = null;
    if (speakResponse && result.spokenResponse) {
      try {
        const speechBuffer = await generateSpeech(result.spokenResponse);
        const base64 = speechBuffer.toString('base64');
        speechUrl = `data:audio/mp3;base64,${base64}`;
      } catch (err) {
        logger.error('TTS generation failed', { error: (err as Error).message });
      }
    }

    return NextResponse.json({
      transcription,
      intent: intent.intent,
      ...result,
      speechUrl,
    });
  } catch (err) {
    logger.error('POST /api/voice-command failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

interface CommandResult {
  action: string;
  spokenResponse: string;
  tasksCreated?: TaskRow[];
  taskUpdated?: TaskRow;
  taskDeleted?: number;
  allTasksDeleted?: boolean;
  tasksList?: TaskRow[];
  count?: number;
  summary?: string;
}

async function executeIntent(
  intent: VoiceIntent,
  userId: number,
  userTasks: TaskRow[]
): Promise<CommandResult> {
  const pendingTasks = userTasks.filter(t => t.status === 'todo');
  const doneTasks = userTasks.filter(t => t.status === 'done');

  switch (intent.intent) {
    case 'create_tasks': {
      const createdTasks: TaskRow[] = [];
      for (const parsed of intent.tasks) {
        if (!parsed.title?.trim()) continue;

        let dueDate: Date | null = null;
        if (parsed.due_date) {
          const d = new Date(parsed.due_date);
          if (!isNaN(d.getTime())) dueDate = d;
        }

        const monetaryValue = typeof parsed.monetary_value === 'number' && parsed.monetary_value >= 0 ? parsed.monetary_value : null;
        const revenuePotential = typeof parsed.revenue_potential === 'number' && parsed.revenue_potential >= 0 ? parsed.revenue_potential : null;
        const urgency = typeof parsed.urgency === 'number' ? Math.max(1, Math.min(10, Math.round(parsed.urgency))) : null;
        const strategicValue = typeof parsed.strategic_value === 'number' ? Math.max(1, Math.min(10, Math.round(parsed.strategic_value))) : null;

        const [task] = await db.insert(tasks).values({
          userId, title: parsed.title.trim(), description: parsed.description || null,
          sourceType: 'voice_context', monetaryValue, revenuePotential, urgency, strategicValue,
          dueDate,
        }).returning();

        await db.insert(taskEvents).values({
          taskId: task.id, eventType: 'voice_note',
          rawInput: JSON.stringify(parsed), parsedOutput: parsed,
        });

        createdTasks.push(task);
      }

      // Re-rank all tasks relative to each other
      if (createdTasks.length > 0) {
        await reprioritizeAllTasks(userId);
      }

      // Re-fetch to get updated scores
      const refreshed: TaskRow[] = [];
      for (const t of createdTasks) {
        const [r] = await db.select().from(tasks).where(eq(tasks.id, t.id));
        refreshed.push(r);
      }

      const count = refreshed.length;
      const titles = refreshed.map(t => t.title).join(', ');
      return {
        action: 'created',
        spokenResponse: count === 1
          ? `Got it. Added "${refreshed[0].title}" with priority score ${Math.round(refreshed[0].priorityScore)}.`
          : `Created ${count} tasks: ${titles}.`,
        tasksCreated: refreshed,
      };
    }

    case 'complete_task': {
      const match = fuzzyMatch(intent.task_query, pendingTasks);
      if (!match) {
        return {
          action: 'not_found',
          spokenResponse: `I couldn't find a pending task matching "${intent.task_query}". You have ${pendingTasks.length} pending tasks.`,
        };
      }

      // Fetch full task record for recurring spawn, scoped to this user
      const [fullTask] = await db.select().from(tasks)
        .where(and(eq(tasks.id, match.id), eq(tasks.userId, userId)));

      const [updated] = await db.update(tasks)
        .set({ status: 'done', updatedAt: new Date() })
        .where(and(eq(tasks.id, match.id), eq(tasks.userId, userId)))
        .returning();

      // Spawn next instance if recurring
      const nextInstance = await spawnNextRecurringInstance(fullTask);

      // Also complete subtasks if this is a parent task
      if (fullTask.parentId === null) {
        await db.update(tasks)
          .set({ status: 'done', updatedAt: new Date() })
          .where(and(eq(tasks.parentId, match.id), eq(tasks.userId, userId)));
      }

      await reprioritizeAllTasks(userId);

      const remaining = pendingTasks.length - 1;
      let spoken = `Done! Marked "${match.title}" as complete. ${remaining} tasks remaining.`;
      if (nextInstance) {
        const nextDue = nextInstance.dueDate ? new Date(nextInstance.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'soon';
        spoken += ` Next occurrence scheduled for ${nextDue}.`;
      }
      return {
        action: 'completed',
        spokenResponse: spoken,
        taskUpdated: updated,
      };
    }

    case 'undo_complete': {
      const match = fuzzyMatch(intent.task_query, doneTasks);
      if (!match) {
        return {
          action: 'not_found',
          spokenResponse: `I couldn't find a completed task matching "${intent.task_query}".`,
        };
      }

      const [updated] = await db.update(tasks)
        .set({ status: 'todo', updatedAt: new Date() })
        .where(and(eq(tasks.id, match.id), eq(tasks.userId, userId)))
        .returning();

      return {
        action: 'reopened',
        spokenResponse: `Reopened "${match.title}". It's back on your list.`,
        taskUpdated: updated,
      };
    }

    case 'update_task': {
      const match = fuzzyMatch(intent.task_query, userTasks);
      if (!match) {
        return {
          action: 'not_found',
          spokenResponse: `I couldn't find a task matching "${intent.task_query}".`,
        };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const changes: string[] = [];

      if (intent.updates.due_date) {
        const d = new Date(intent.updates.due_date);
        if (!isNaN(d.getTime())) {
          updates.dueDate = d;
          changes.push(`due date to ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
        }
      }
      if (intent.updates.urgency != null) {
        updates.urgency = Math.max(1, Math.min(10, Math.round(intent.updates.urgency)));
        changes.push(`urgency to ${updates.urgency}`);
      }
      if (intent.updates.strategic_value != null) {
        updates.strategicValue = Math.max(1, Math.min(10, Math.round(intent.updates.strategic_value)));
        changes.push(`strategic value to ${updates.strategicValue}`);
      }
      if (intent.updates.monetary_value != null) {
        updates.monetaryValue = Math.max(0, intent.updates.monetary_value);
        changes.push(`monetary value to $${(updates.monetaryValue as number).toLocaleString()}`);
      }
      if (intent.updates.revenue_potential != null) {
        updates.revenuePotential = Math.max(0, intent.updates.revenue_potential);
        changes.push(`revenue potential to $${(updates.revenuePotential as number).toLocaleString()}`);
      }
      if (intent.updates.title) {
        updates.title = intent.updates.title;
        changes.push(`title to "${intent.updates.title}"`);
      }
      if (intent.updates.description) {
        updates.description = intent.updates.description;
        changes.push('description');
      }
      if (intent.updates.assignee) {
        updates.assignee = intent.updates.assignee;
        changes.push(`assigned to ${intent.updates.assignee}`);
      }
      if (intent.updates.category) {
        updates.category = intent.updates.category;
        changes.push(`category to "${intent.updates.category}"`);
      }
      if (intent.updates.recurrence_rule) {
        updates.recurrenceRule = intent.updates.recurrence_rule;
        if (intent.updates.recurrence_days) {
          updates.recurrenceDays = intent.updates.recurrence_days;
        }
        changes.push(`set to recurring: ${intent.updates.recurrence_rule}`);
      }
      if (intent.updates.priority_override != null) {
        const score = Math.min(100, Math.max(0, Math.round(intent.updates.priority_override)));
        updates.manualPriorityScore = score;
        updates.manualPriorityReason = intent.updates.priority_reason ?? 'Set via voice command';
        changes.push(`priority manually set to ${score}`);

        // Record in priority override history
        await db.insert(priorityOverrides).values({
          taskId: match.id,
          userId,
          previousScore: match.priorityScore,
          newScore: score,
          reason: intent.updates.priority_reason ?? 'Set via voice command',
          source: 'voice',
        });
      }

      await db.update(tasks)
        .set(updates)
        .where(and(eq(tasks.id, match.id), eq(tasks.userId, userId)));

      // Re-rank all tasks relative to each other
      await reprioritizeAllTasks(userId);

      // Re-fetch to get updated score
      const [updated] = await db.select().from(tasks)
        .where(and(eq(tasks.id, match.id), eq(tasks.userId, userId)));

      return {
        action: 'updated',
        spokenResponse: `Updated "${match.title}": ${changes.join(', ')}. Priority score is now ${Math.round(updated.priorityScore)}.`,
        taskUpdated: updated,
      };
    }

    case 'delete_task': {
      const match = fuzzyMatch(intent.task_query, userTasks);
      if (!match) {
        return {
          action: 'not_found',
          spokenResponse: `I couldn't find a task matching "${intent.task_query}".`,
        };
      }

      await db.delete(tasks).where(and(eq(tasks.id, match.id), eq(tasks.userId, userId)));

      await reprioritizeAllTasks(userId);

      return {
        action: 'deleted',
        spokenResponse: `Deleted "${match.title}".`,
        taskDeleted: match.id,
      };
    }

    case 'delete_all_tasks': {
      const totalCount = userTasks.length;
      if (totalCount === 0) {
        return {
          action: 'deleted_all',
          spokenResponse: 'You have no tasks to delete.',
          allTasksDeleted: true,
        };
      }

      await db.delete(tasks).where(eq(tasks.userId, userId));

      return {
        action: 'deleted_all',
        spokenResponse: `Deleted all ${totalCount} tasks.`,
        allTasksDeleted: true,
      };
    }

    case 'query_briefing': {
      const top3 = pendingTasks.slice(0, 3);
      if (top3.length === 0) {
        return {
          action: 'briefing',
          spokenResponse: 'You have no pending tasks. Enjoy your free time!',
          summary: 'No pending tasks.',
        };
      }

      const totalValue = pendingTasks.reduce((s, t) => s + (t.monetaryValue ?? 0) + (t.revenuePotential ?? 0), 0);
      const overdueCount = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date()).length;

      const taskDescriptions = top3.map((t, i) => {
        const parts = [`${i + 1}. ${t.title}`];
        if (t.dueDate) parts.push(formatDueDate(t.dueDate));
        if (t.monetaryValue) parts.push(`$${t.monetaryValue.toLocaleString()} at stake`);
        return parts.join(', ');
      }).join('. ');

      let summary = `You have ${pendingTasks.length} pending tasks.`;
      if (overdueCount > 0) summary += ` ${overdueCount} are overdue.`;
      if (totalValue > 0) summary += ` Total value: $${totalValue.toLocaleString()}.`;
      summary += ` Top priorities: ${taskDescriptions}.`;

      return {
        action: 'briefing',
        spokenResponse: summary,
        tasksList: top3,
        summary,
      };
    }

    case 'query_tasks': {
      let filtered = pendingTasks;
      let filterLabel = 'pending';

      if (intent.filter === 'overdue') {
        filtered = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date());
        filterLabel = 'overdue';
      } else if (intent.filter === 'today') {
        const today = new Date().toDateString();
        filtered = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate).toDateString() === today);
        filterLabel = 'due today';
      } else if (intent.filter === 'high_priority') {
        filtered = pendingTasks.filter(t => t.priorityScore >= 60);
        filterLabel = 'high priority';
      } else if (intent.filter === 'done') {
        filtered = doneTasks;
        filterLabel = 'completed';
      }

      if (filtered.length === 0) {
        return {
          action: 'query',
          spokenResponse: `You have no ${filterLabel} tasks.`,
          tasksList: [],
          count: 0,
        };
      }

      const maxRead = 5;
      const taskNames = filtered.slice(0, maxRead).map((t, i) => {
        const parts = [`${i + 1}. ${t.title}`];
        if (t.dueDate) parts.push(formatDueDate(t.dueDate));
        return parts.join(', ');
      }).join('. ');

      const moreText = filtered.length > maxRead ? ` And ${filtered.length - maxRead} more.` : '';

      return {
        action: 'query',
        spokenResponse: `You have ${filtered.length} ${filterLabel} tasks. ${taskNames}.${moreText}`,
        tasksList: filtered,
        count: filtered.length,
      };
    }

    case 'query_count': {
      let count: number;
      let filterLabel: string;

      if (intent.filter === 'overdue') {
        count = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date()).length;
        filterLabel = 'overdue';
      } else if (intent.filter === 'today') {
        const today = new Date().toDateString();
        count = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate).toDateString() === today).length;
        filterLabel = 'due today';
      } else if (intent.filter === 'high_priority') {
        count = pendingTasks.filter(t => t.priorityScore >= 60).length;
        filterLabel = 'high priority';
      } else if (intent.filter === 'done') {
        count = doneTasks.length;
        filterLabel = 'completed';
      } else {
        count = pendingTasks.length;
        filterLabel = 'pending';
      }

      return {
        action: 'count',
        spokenResponse: `You have ${count} ${filterLabel} task${count !== 1 ? 's' : ''}.`,
        count,
      };
    }

    case 'unknown':
    default:
      return {
        action: 'unknown',
        spokenResponse: `I didn't understand that. You can say things like "add a task", "mark the budget review as done", "what's overdue?", or "what should I focus on?"`,
      };
  }
}
