import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import OpenAI from 'openai';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(session.user.id);
    logger.info('GET /api/focus', { userId });

    const topTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'todo')))
      .orderBy(desc(tasks.priorityScore))
      .limit(5);

    if (topTasks.length === 0) {
      return NextResponse.json({ tasks: [], summary: 'No pending tasks. Enjoy your free time!' });
    }

    const focusTasks = topTasks.slice(0, 3);

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
