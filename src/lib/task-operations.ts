import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { computeNextDueDate, shouldCreateNextInstance, type RecurrenceConfig } from '@/lib/recurrence';

/**
 * When a recurring task is completed, spawn the next instance.
 * Returns the new task or null.
 */
export async function spawnNextRecurringInstance(
  current: typeof tasks.$inferSelect
): Promise<typeof tasks.$inferSelect | null> {
  if (!current.recurrenceRule) return null;

  const config: RecurrenceConfig = {
    rule: current.recurrenceRule as RecurrenceConfig['rule'],
    days: current.recurrenceDays ? current.recurrenceDays.split(',').map(Number) : undefined,
    endDate: current.recurrenceEndDate ?? undefined,
    active: current.recurrenceActive !== 'false',
  };

  if (!shouldCreateNextInstance(config, current.dueDate)) return null;

  const nextDue = computeNextDueDate(current.dueDate, config);
  const recurrenceParentId = current.recurrenceParentId ?? current.id;

  const [newTask] = await db.insert(tasks).values({
    userId: current.userId,
    title: current.title,
    description: current.description,
    sourceType: current.sourceType,
    monetaryValue: current.monetaryValue,
    revenuePotential: current.revenuePotential,
    urgency: current.urgency,
    strategicValue: current.strategicValue,
    assignee: current.assignee,
    parentId: current.parentId,
    recurrenceRule: current.recurrenceRule,
    recurrenceDays: current.recurrenceDays,
    recurrenceEndDate: current.recurrenceEndDate,
    recurrenceParentId,
    recurrenceActive: current.recurrenceActive,
    dueDate: nextDue,
  }).returning();

  return newTask;
}
