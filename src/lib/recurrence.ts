export type RecurrenceRule = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface RecurrenceConfig {
  rule: RecurrenceRule;
  days?: number[];       // ISO weekdays 1-7 (Mon-Sun), for weekly/biweekly
  endDate?: Date | null;
  active?: boolean | string | null; // DB stores as text 'true'/'false'
}

/**
 * Compute the next due date based on recurrence config.
 * If the task is overdue, skips forward to the next future occurrence.
 */
export function computeNextDueDate(
  currentDueDate: Date | null,
  config: RecurrenceConfig
): Date {
  const base = currentDueDate ? new Date(currentDueDate) : new Date();
  const now = new Date();

  switch (config.rule) {
    case 'daily': {
      const next = new Date(base);
      next.setDate(next.getDate() + 1);
      // Skip forward if still in the past
      while (next < now) next.setDate(next.getDate() + 1);
      return next;
    }

    case 'weekly': {
      if (config.days && config.days.length > 0) {
        return findNextMatchingDay(base, config.days, 7, now);
      }
      const next = new Date(base);
      next.setDate(next.getDate() + 7);
      while (next < now) next.setDate(next.getDate() + 7);
      return next;
    }

    case 'biweekly': {
      if (config.days && config.days.length > 0) {
        return findNextMatchingDay(base, config.days, 14, now);
      }
      const next = new Date(base);
      next.setDate(next.getDate() + 14);
      while (next < now) next.setDate(next.getDate() + 14);
      return next;
    }

    case 'monthly': {
      const targetDay = base.getDate();
      let year = base.getFullYear();
      let month = base.getMonth() + 1; // 0-indexed, move to next month
      if (month > 11) { month = 0; year++; }
      // new Date(year, month+1, 0) gives last day of `month` (0-indexed)
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const day = Math.min(targetDay, daysInMonth);
      const next = new Date(base);
      next.setFullYear(year);
      next.setDate(1); // avoid overflow when setting month
      next.setMonth(month);
      next.setDate(day);
      while (next < now) {
        month++;
        if (month > 11) { month = 0; year++; }
        const dim = new Date(year, month + 1, 0).getDate();
        next.setFullYear(year);
        next.setDate(1);
        next.setMonth(month);
        next.setDate(Math.min(targetDay, dim));
      }
      return next;
    }

    default:
      return new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Find the next matching weekday after base date, cycling through the given days.
 */
function findNextMatchingDay(
  base: Date,
  days: number[],
  cycleDays: number,
  now: Date
): Date {
  const sorted = [...days].sort((a, b) => a - b);
  const candidate = new Date(base);
  candidate.setDate(candidate.getDate() + 1); // Start from the day after base

  // Try the next `cycleDays` days to find a match
  for (let i = 0; i < cycleDays; i++) {
    const dow = candidate.getDay() === 0 ? 7 : candidate.getDay(); // Convert to ISO (1=Mon, 7=Sun)
    if (sorted.includes(dow) && candidate >= now) {
      return candidate;
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  // If all candidates are in the past, skip forward by cycle length and retry
  const next = new Date(base);
  next.setDate(next.getDate() + cycleDays);
  while (next < now) next.setDate(next.getDate() + cycleDays);
  // From here, find the next matching day
  for (let i = 0; i < cycleDays; i++) {
    const dow = next.getDay() === 0 ? 7 : next.getDay();
    if (sorted.includes(dow)) return next;
    next.setDate(next.getDate() + 1);
  }

  return next;
}

/**
 * Check whether a new instance should be created when the current one is completed.
 */
export function shouldCreateNextInstance(
  config: RecurrenceConfig,
  currentDueDate: Date | null
): boolean {
  // Normalize: treat null/undefined/true/'true' as active; false/'false' as inactive
  const isActive = config.active == null || config.active === true || config.active === 'true';
  if (!isActive) return false;

  if (config.endDate) {
    const nextDue = computeNextDueDate(currentDueDate, config);
    if (nextDue > new Date(config.endDate)) return false;
  }

  return true;
}

/**
 * Format recurrence metadata into a human-readable label.
 */
export function formatRecurrenceLabel(rule: string | null, days: string | null): string {
  if (!rule) return '';

  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  switch (rule) {
    case 'daily':
      return 'Daily';
    case 'weekly': {
      if (days) {
        const dayList = days.split(',').map(d => dayNames[parseInt(d)] || '').filter(Boolean);
        if (dayList.length === 1) return `Every ${dayList[0]}`;
        return `Every ${dayList.join(', ')}`;
      }
      return 'Weekly';
    }
    case 'biweekly': {
      if (days) {
        const dayList = days.split(',').map(d => dayNames[parseInt(d)] || '').filter(Boolean);
        return `Every 2 weeks (${dayList.join(', ')})`;
      }
      return 'Every 2 weeks';
    }
    case 'monthly':
      return 'Monthly';
    default:
      return rule;
  }
}
