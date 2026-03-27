import OpenAI from 'openai';
import { db } from '@/lib/db';
import { tasks, priorityOverrides, categoryBoosts } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export interface PriorityInput {
  title?: string;
  description?: string | null;
  monetaryValue?: number | null;
  revenuePotential?: number | null;
  revenueType?: string | null;    // 'onetime' | 'mrr' | 'arr'
  urgency?: number | null;       // 1-10
  strategicValue?: number | null; // 1-10
  userManualBoost?: number;       // 0-10
  dueDate?: Date | null;
}

export interface PriorityResult {
  score: number;
  reason: string;
}

const REPRIORITIZE_PROMPT = `You are a CEO's task prioritization engine. You will receive a JSON array of ALL the user's active top-level tasks. Score each task 0-100 RELATIVE to the others in the list.

RANKING PRINCIPLES:
1. MONETARY VALUE is the primary factor. The task with the highest dollar amount (monetary_value or revenue_potential) should get the highest score. Spread scores proportionally — if one task is worth 75x more than another, that must be clearly reflected.
   REVENUE TYPE matters: revenue_potential is already adjusted for type. MRR (monthly recurring) is annualized (×12), ARR (annual recurring) is valued at 3× one-time. These multiplied values appear in revenue_potential, so use them directly.
2. URGENCY & DUE DATES are the tiebreaker. Among tasks with similar monetary value, overdue or imminent tasks rank higher.
3. EFFORT is the final tiebreaker. Among tasks with similar value and urgency, quicker/easier tasks rank slightly higher (faster ROI).
4. MANUAL OVERRIDES must be respected. If a task has a "manual_priority" field, use that exact score — do NOT change it. The user explicitly set it.
5. Recurring tasks should not be penalized for being recurring. Treat each instance on its own merits.
6. CATEGORY CONTEXT: Tasks may have a "category" field (e.g. "Temporal", "Personal"). Use this as context for understanding the task. Do NOT adjust scores based on category — category boosts are applied separately by the system.

SCORING RULES:
- Scores must be RELATIVE — spread them across the 0-100 range based on the current list
- The most important task should score 90-100, but ONLY if it has significant monetary value, urgency, or strategic importance
- The least important should score 10-30
- A task with NO monetary value, NO urgency, and NO strategic value should score 20-40 regardless of how few tasks exist
- If there is only ONE task, do NOT automatically give it 90-100. Score it based on its actual attributes.
- Differentiate clearly: avoid giving similar scores to very different tasks
- If two tasks differ by more than 5x in monetary value, the higher-value task MUST score higher. No exceptions.
- Today's date is {today}

EXAMPLE: Given "Contract worth $1,000,000" and "Task worth $12,000", the $1M task MUST score at least 20 points higher. A task worth 10x more should score at least 15 points higher than the lower-value task.

{overrideContext}

Return ONLY a JSON array: [{ "id": number, "score": number, "reason": "one sentence" }]`;

/**
 * Post-AI correction: enforce that higher monetary value => higher score.
 *
 * Algorithm: bottom-up sweep from the lowest-dollar task to the highest.
 * For each pair (lower-dollar, higher-dollar) we ensure the higher-dollar
 * task's score is strictly above the lower-dollar task's score by at least
 * `minGap`. This is transitive because we sweep upward, accumulating a
 * monotonically increasing floor.
 *
 * Manual overrides are excluded from correction.
 */
export function enforceMonetaryOrdering(
  scored: Array<{ id: number; score: number; reason: string }>,
  taskDetails: Array<{ id: number; monetaryValue: number | null; revenuePotential: number | null; manualPriorityScore: number | null }>
): Array<{ id: number; score: number; reason: string }> {
  const scoreMap = new Map(scored.map(s => [s.id, { ...s }]));

  // Build list of tasks that have monetary value and no manual override
  const withMoney = taskDetails
    .filter(t => t.manualPriorityScore == null)
    .map(t => ({
      id: t.id,
      dollars: Math.max(t.monetaryValue ?? 0, t.revenuePotential ?? 0),
    }))
    .filter(t => t.dollars > 0)
    .sort((a, b) => a.dollars - b.dollars); // lowest first for bottom-up sweep

  if (withMoney.length < 2) return scored;

  // Bottom-up: ensure each higher-dollar task scores above the one below it
  for (let i = 1; i < withMoney.length; i++) {
    const lowerDollar = withMoney[i - 1];
    const higherDollar = withMoney[i];

    // Skip equal dollar amounts — keep AI ordering
    if (higherDollar.dollars === lowerDollar.dollars) continue;

    const lowerEntry = scoreMap.get(lowerDollar.id);
    const higherEntry = scoreMap.get(higherDollar.id);
    if (!lowerEntry || !higherEntry) continue;

    const valueRatio = higherDollar.dollars / lowerDollar.dollars;
    const minGap = valueRatio > 5 ? 5 : 2;

    if (higherEntry.score - lowerEntry.score < minGap) {
      // Try raising the higher-dollar task
      const raised = Math.min(100, lowerEntry.score + minGap);
      if (raised - lowerEntry.score >= minGap) {
        logger.info('Monetary ordering correction applied', {
          taskId: higherDollar.id, before: higherEntry.score, after: raised,
          higherDollars: higherDollar.dollars, lowerDollars: lowerDollar.dollars,
        });
        higherEntry.score = raised;
        higherEntry.reason += ' (score adjusted: monetary value is primary factor)';
      } else {
        // Near cap — lower the lower-dollar task instead
        const lowered = Math.max(0, higherEntry.score - minGap);
        if (lowered < lowerEntry.score) {
          logger.info('Monetary ordering correction applied', {
            taskId: lowerDollar.id, before: lowerEntry.score, after: lowered,
            reason: 'lowered to maintain gap near score cap',
          });
          lowerEntry.score = lowered;
          lowerEntry.reason += ' (score adjusted: higher-value task takes priority)';
        }
        // Also raise if still needed
        if (higherEntry.score <= lowerEntry.score) {
          higherEntry.score = Math.min(100, lowerEntry.score + minGap);
        }
      }
    }
  }

  return scored.map(s => scoreMap.get(s.id) ?? s);
}

/**
 * Re-rank ALL active tasks for a user relative to each other.
 * Only scores top-level tasks (not subtasks). Subtasks inherit parent's score.
 */
export async function reprioritizeAllTasks(userId: number): Promise<void> {
  // Fetch ALL tasks (including done) for subtask progress, then filter for todo
  const allTasksIncludingDone = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId));

  const allTodoTasks = allTasksIncludingDone.filter(t => t.status !== 'done');
  if (allTodoTasks.length === 0) return;

  // Separate top-level tasks from subtasks (only todo for scoring)
  const topLevel = allTodoTasks.filter(t => t.parentId === null);
  const subtasks = allTodoTasks.filter(t => t.parentId !== null);

  if (topLevel.length === 0) return;

  if (topLevel.length === 1) {
    const score = topLevel[0].manualPriorityScore ?? 50;
    await db.update(tasks)
      .set({ priorityScore: score, priorityReason: topLevel[0].manualPriorityReason ?? 'Only active task.', updatedAt: new Date() })
      .where(eq(tasks.id, topLevel[0].id));
    for (const sub of subtasks.filter(s => s.parentId === topLevel[0].id)) {
      await db.update(tasks)
        .set({ priorityScore: score, priorityReason: 'Inherited from parent task.', updatedAt: new Date() })
        .where(eq(tasks.id, sub.id));
    }
    return;
  }

  // Count subtask progress for context (using ALL tasks including done)
  const subtaskProgress: Record<number, string> = {};
  for (const parent of topLevel) {
    const children = allTasksIncludingDone.filter(t => t.parentId === parent.id);
    if (children.length > 0) {
      const done = children.filter(c => c.status === 'done').length;
      subtaskProgress[parent.id] = `${done}/${children.length} subtasks done`;
    }
  }

  // Fetch category boosts for this user
  const boosts = await db.select().from(categoryBoosts)
    .where(eq(categoryBoosts.userId, userId));
  const boostMap: Record<string, number> = {};
  for (const b of boosts) {
    boostMap[b.category] = b.boost;
  }

  // Fetch recent priority overrides for context
  const recentOverrides = await db.select().from(priorityOverrides)
    .where(eq(priorityOverrides.userId, userId))
    .orderBy(desc(priorityOverrides.createdAt))
    .limit(10);

  let overrideContext = '';
  if (recentOverrides.length > 0) {
    const overrideLines = recentOverrides.map(o => {
      const taskTitle = topLevel.find(t => t.id === o.taskId)?.title ?? `Task #${o.taskId}`;
      const daysAgo = Math.round((Date.now() - new Date(o.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      return `- "${taskTitle}" was manually set to ${o.newScore} because "${o.reason}" (${daysAgo} days ago)`;
    });
    overrideContext = `USER OVERRIDE HISTORY (respect these preferences):\n${overrideLines.join('\n')}`;
  }

  const taskList = topLevel.map(t => {
    // Apply MRR/ARR multipliers for effective comparison value
    let effectiveRevenue = t.revenuePotential ?? 0;
    const revenueType = (t as Record<string, unknown>).revenueType as string | null;
    if (revenueType === 'mrr') effectiveRevenue *= 12; // Monthly → annualized
    else if (revenueType === 'arr') effectiveRevenue *= 3; // ARR worth 3x one-time
    return {
    id: t.id,
    title: t.title,
    description: t.description,
    monetary_value: t.monetaryValue,
    revenue_potential: effectiveRevenue > 0 ? effectiveRevenue : t.revenuePotential,
    revenue_type: revenueType ?? 'onetime',
    urgency: t.urgency,
    strategic_value: t.strategicValue,
    due_date: t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : null,
    recurring: t.recurrenceRule ?? undefined,
    assignee: t.assignee ?? undefined,
    category: t.category ?? undefined,
    category_boost: t.category ? (boostMap[t.category] ?? 0) : undefined,
    subtask_progress: subtaskProgress[t.id] ?? undefined,
    manual_priority: t.manualPriorityScore ?? undefined,
  };
  });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const today = new Date().toISOString().split('T')[0];
    const prompt = REPRIORITIZE_PROMPT
      .replace('{today}', today)
      .replace('{overrideContext}', overrideContext);

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      temperature: 0.2,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify(taskList) },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '[]';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const rawParsed: Array<{ id: number; score: number; reason: string }> = JSON.parse(jsonMatch?.[0] ?? '[]');

    // Post-AI correction: enforce monetary value ordering
    let parsed: Array<{ id: number; score: number; reason: string }>;
    try {
      parsed = enforceMonetaryOrdering(rawParsed, topLevel);
    } catch (err) {
      logger.error('enforceMonetaryOrdering failed, using uncorrected scores', { error: (err as Error).message });
      parsed = rawParsed;
    }

    // Update each top-level task
    const now = new Date();
    for (const item of parsed) {
      const task = topLevel.find(t => t.id === item.id);
      // If task has manual override, use that instead
      let baseScore = task?.manualPriorityScore != null
        ? task.manualPriorityScore
        : Math.min(Math.max(Math.round(item.score ?? 0), 0), 100);
      // Apply category boost server-side (only when no manual override)
      if (task?.category && task.manualPriorityScore == null && boostMap[task.category] != null) {
        baseScore = Math.min(100, Math.max(0, baseScore + boostMap[task.category]));
      }
      const score = baseScore;
      const reason = task?.manualPriorityReason ?? item.reason ?? 'Priority assessed by AI.';
      await db.update(tasks)
        .set({ priorityScore: score, priorityReason: reason, updatedAt: now })
        .where(and(eq(tasks.id, item.id), eq(tasks.userId, userId)));

      // Inherit score to subtasks
      for (const sub of subtasks.filter(s => s.parentId === item.id)) {
        await db.update(tasks)
          .set({ priorityScore: score, priorityReason: 'Inherited from parent task.', updatedAt: now })
          .where(eq(tasks.id, sub.id));
      }
    }
  } catch (err) {
    console.error('AI batch reprioritization failed, using fallback:', err);
    // Fallback: score each top-level task individually using local formula
    const fallbackScored: Array<{ id: number; score: number; reason: string }> = [];
    for (const task of topLevel) {
      if (task.manualPriorityScore != null) {
        fallbackScored.push({ id: task.id, score: task.manualPriorityScore, reason: task.manualPriorityReason ?? 'Manual override.' });
      } else {
        const { score: baseScore, reason } = calculatePriorityFallback({
          title: task.title,
          description: task.description,
          monetaryValue: task.monetaryValue,
          revenuePotential: task.revenuePotential,
          urgency: task.urgency,
          strategicValue: task.strategicValue,
          dueDate: task.dueDate,
        });
        const categoryBoost = task.category ? (boostMap[task.category] ?? 0) : 0;
        const score = Math.min(100, Math.max(0, baseScore + categoryBoost));
        fallbackScored.push({ id: task.id, score, reason });
      }
    }

    // Apply monetary ordering correction to fallback scores too
    const correctedFallback = enforceMonetaryOrdering(fallbackScored, topLevel);

    for (const item of correctedFallback) {
      await db.update(tasks)
        .set({ priorityScore: item.score, priorityReason: item.reason, updatedAt: new Date() })
        .where(eq(tasks.id, item.id));
      // Inherit to subtasks
      for (const sub of subtasks.filter(s => s.parentId === item.id)) {
        await db.update(tasks)
          .set({ priorityScore: item.score, priorityReason: 'Inherited from parent task.', updatedAt: new Date() })
          .where(eq(tasks.id, sub.id));
      }
    }
  }
}

/**
 * Local fallback priority scoring (no AI needed).
 * Uses log-scale monetary weighting so higher dollar values always rank higher.
 */
export function calculatePriorityFallback(input: PriorityInput): PriorityResult {
  const reasons: string[] = [];
  let score = 0;

  // Monetary value dominates — log scale so $75K >> $1K (max ~60 points)
  // Apply MRR/ARR multipliers: MRR×12 (annualized), ARR×3 (3x one-time value)
  const mv = Math.max(input.monetaryValue ?? 0, 0);
  let rp = Math.max(input.revenuePotential ?? 0, 0);
  if (input.revenueType === 'mrr') rp *= 12;
  else if (input.revenueType === 'arr') rp *= 3;
  const maxDollar = Math.max(mv, rp);
  if (maxDollar > 0) {
    score += Math.min(Math.log10(maxDollar) * 12, 60);
    if (mv > 0) reasons.push(`protects or involves $${mv.toLocaleString()}`);
    if (rp > 0) reasons.push(`could generate $${rp.toLocaleString()} in revenue`);
  }

  // Urgency (max 20 points)
  const urgNorm = Math.max(Math.min(input.urgency ?? 0, 10), 0);
  score += urgNorm * 2.0;
  if (urgNorm >= 7) reasons.push('marked as urgent');

  // Strategic value (max 15 points)
  const stNorm = Math.max(Math.min(input.strategicValue ?? 0, 10), 0);
  score += stNorm * 1.5;
  if (stNorm >= 7) reasons.push('high strategic value');

  // Manual boost (max 20 points)
  const boostNorm = Math.max(Math.min(input.userManualBoost ?? 0, 10), 0);
  score += boostNorm * 2;

  // Deadline proximity boost (max 15 points)
  if (input.dueDate) {
    const now = new Date();
    const diffMs = new Date(input.dueDate).getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) { score += 15; reasons.push('overdue'); }
    else if (diffDays === 0) { score += 12; reasons.push('due today'); }
    else if (diffDays <= 3) { score += 8; reasons.push(`due in ${diffDays} day${diffDays > 1 ? 's' : ''}`); }
    else if (diffDays <= 7) { score += 4; reasons.push('due this week'); }
  }

  score = Math.min(Math.round(score), 100);

  let reason: string;
  if (reasons.length === 0) {
    reason = 'Lower priority: no clear financial or strategic upside identified.';
  } else {
    reason = `Higher priority because it ${reasons.join(', and ')}.`;
  }

  return { score, reason };
}
