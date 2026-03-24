import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, and, desc, isNull, inArray, ne } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import OpenAI from 'openai';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = auth.userId;
    logger.info('GET /api/focus', { userId });

    // Efficient DB query: fetch only top-level active tasks (todo + doing), ordered by priority, limited
    const topTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), ne(tasks.status, 'done'), isNull(tasks.parentId)))
      .orderBy(desc(tasks.priorityScore))
      .limit(5);

    if (topTasks.length === 0) {
      return NextResponse.json({ tasks: [], summary: 'No pending tasks. Enjoy your free time!' });
    }

    // Fetch subtasks only for the focus tasks (all statuses for progress count)
    const focusIds = topTasks.slice(0, 3).map(t => t.id);
    const subtasksForFocus = focusIds.length > 0
      ? await db.select().from(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.parentId, focusIds)))
      : [];

    const focusTasks = topTasks.slice(0, 3).map(t => {
      const children = subtasksForFocus.filter(c => c.parentId === t.id);
      const subtaskTotal = children.length;
      const subtaskDone = children.filter(c => c.status === 'done').length;
      return {
        ...t,
        subtaskTotal,
        subtaskDone,
        subtaskProgress: subtaskTotal > 0 ? `${subtaskDone}/${subtaskTotal} done` : null,
      };
    });

    let summary: string;
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const taskList = topTasks.map((t, i) => {
        const parts = [`${i + 1}. "${t.title}" (score: ${Math.round(t.priorityScore)})`];
        if (t.monetaryValue) parts.push(`$${t.monetaryValue.toLocaleString()} at stake`);
        if (t.revenuePotential) parts.push(`$${t.revenuePotential.toLocaleString()} potential`);
        if (t.dueDate) {
          const diffDays = Math.round((new Date(t.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) parts.push('OVERDUE');
          else if (diffDays === 0) parts.push('due today');
          else parts.push(`due in ${diffDays} days`);
        }
        return parts.join(' - ');
      }).join('\n');

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 100,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: 'You write a 1-sentence executive briefing for a busy CEO. Be direct, mention dollar amounts and deadlines. No fluff.',
          },
          {
            role: 'user',
            content: `Top tasks:\n${taskList}`,
          },
        ],
      });

      summary = response.choices[0]?.message?.content ?? 'Focus on your highest-priority items.';
    } catch {
      const totalValue = topTasks.reduce((sum, t) => sum + (t.monetaryValue ?? 0) + (t.revenuePotential ?? 0), 0);
      summary = totalValue > 0
        ? `You have ${topTasks.length} pending tasks worth $${totalValue.toLocaleString()} total.`
        : `You have ${topTasks.length} pending tasks to tackle.`;
    }

    return NextResponse.json({ tasks: focusTasks, summary });
  } catch (err) {
    logger.error('GET /api/focus failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
