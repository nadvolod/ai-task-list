import { describe, it, expect } from 'vitest';
import {
  computeNextDueDate,
  shouldCreateNextInstance,
  formatRecurrenceLabel,
  type RecurrenceConfig,
} from '../../src/lib/recurrence';

/** Helper: extract YYYY-MM-DD from a Date in UTC */
function toUTCDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

describe('computeNextDueDate', () => {
  it('daily: returns next day', () => {
    const base = new Date('2026-03-23T10:00:00Z');
    const config: RecurrenceConfig = { rule: 'daily' };
    const next = computeNextDueDate(base, config);
    expect(next.getUTCDate()).toBe(24);
  });

  it('daily: skips forward if overdue', () => {
    const past = new Date('2026-01-01T10:00:00Z');
    const config: RecurrenceConfig = { rule: 'daily' };
    const next = computeNextDueDate(past, config);
    expect(next.getTime()).toBeGreaterThanOrEqual(Date.now());
  });

  it('weekly: adds 7 days when no specific days given', () => {
    const base = new Date('2026-03-23T10:00:00Z'); // Monday
    const config: RecurrenceConfig = { rule: 'weekly' };
    const next = computeNextDueDate(base, config);
    expect(next.getUTCDate()).toBe(30);
  });

  it('weekly: finds next matching weekday', () => {
    const base = new Date('2026-03-23T10:00:00Z'); // Monday UTC
    const config: RecurrenceConfig = { rule: 'weekly', days: [3] }; // Wednesday
    const next = computeNextDueDate(base, config);
    // Next Wednesday after Monday March 23 = March 25
    expect(next.getUTCDate()).toBe(25);
    const dow = next.getUTCDay() === 0 ? 7 : next.getUTCDay(); // ISO day
    expect(dow).toBe(3); // Wednesday
  });

  it('biweekly: adds 14 days when no specific days', () => {
    const base = new Date('2026-03-23T10:00:00Z');
    const config: RecurrenceConfig = { rule: 'biweekly' };
    const next = computeNextDueDate(base, config);
    expect(next.getUTCDate()).toBe(6); // April 6
  });

  it('monthly: same day next month', () => {
    const base = new Date('2026-03-15T10:00:00Z');
    const config: RecurrenceConfig = { rule: 'monthly' };
    const next = computeNextDueDate(base, config);
    expect(toUTCDateString(next)).toMatch(/^2026-04-15/);
  });

  it('monthly: handles month with fewer days (Jan 31 → Feb 28)', () => {
    // Use a future date so the skip-forward-to-now logic doesn't advance past February
    const base = new Date('2027-01-31T10:00:00Z');
    const config: RecurrenceConfig = { rule: 'monthly' };
    const next = computeNextDueDate(base, config);
    expect(toUTCDateString(next)).toBe('2027-02-28');
  });

  it('uses today when currentDueDate is null', () => {
    const config: RecurrenceConfig = { rule: 'daily' };
    const next = computeNextDueDate(null, config);
    expect(next.getTime()).toBeGreaterThanOrEqual(Date.now());
  });
});

describe('shouldCreateNextInstance', () => {
  it('returns true for active config with no end date', () => {
    const config: RecurrenceConfig = { rule: 'weekly', active: true };
    expect(shouldCreateNextInstance(config, new Date())).toBe(true);
  });

  it('returns false when active is false', () => {
    const config: RecurrenceConfig = { rule: 'weekly', active: false };
    expect(shouldCreateNextInstance(config, new Date())).toBe(false);
  });

  it('returns false when active is string "false" (DB text column)', () => {
    const config: RecurrenceConfig = { rule: 'weekly', active: 'false' };
    expect(shouldCreateNextInstance(config, new Date())).toBe(false);
  });

  it('returns true when active is string "true"', () => {
    const config: RecurrenceConfig = { rule: 'weekly', active: 'true' };
    expect(shouldCreateNextInstance(config, new Date())).toBe(true);
  });

  it('returns true when active is null (default)', () => {
    const config: RecurrenceConfig = { rule: 'weekly', active: null };
    expect(shouldCreateNextInstance(config, new Date())).toBe(true);
  });

  it('returns false when end date is in the past', () => {
    const config: RecurrenceConfig = {
      rule: 'daily',
      active: true,
      endDate: new Date('2020-01-01'),
    };
    expect(shouldCreateNextInstance(config, new Date('2020-01-01'))).toBe(false);
  });

  it('returns true when end date is in the future', () => {
    const config: RecurrenceConfig = {
      rule: 'daily',
      active: true,
      endDate: new Date('2030-12-31'),
    };
    expect(shouldCreateNextInstance(config, new Date())).toBe(true);
  });
});

describe('formatRecurrenceLabel', () => {
  it('returns empty string for null rule', () => {
    expect(formatRecurrenceLabel(null, null)).toBe('');
  });

  it('formats daily', () => {
    expect(formatRecurrenceLabel('daily', null)).toBe('Daily');
  });

  it('formats weekly without days', () => {
    expect(formatRecurrenceLabel('weekly', null)).toBe('Weekly');
  });

  it('formats weekly with single day', () => {
    expect(formatRecurrenceLabel('weekly', '1')).toBe('Every Mon');
  });

  it('formats weekly with multiple days', () => {
    expect(formatRecurrenceLabel('weekly', '1,3,5')).toBe('Every Mon, Wed, Fri');
  });

  it('formats biweekly', () => {
    expect(formatRecurrenceLabel('biweekly', null)).toBe('Every 2 weeks');
  });

  it('formats biweekly with days', () => {
    expect(formatRecurrenceLabel('biweekly', '1')).toBe('Every 2 weeks (Mon)');
  });

  it('formats monthly', () => {
    expect(formatRecurrenceLabel('monthly', null)).toBe('Monthly');
  });
});
