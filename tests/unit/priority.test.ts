import { describe, it, expect } from 'vitest';
import { calculatePriorityFallback } from '../../src/lib/priority';

describe('calculatePriorityFallback', () => {
  it('returns score 0 for empty input', () => {
    const result = calculatePriorityFallback({});
    expect(result.score).toBe(0);
    expect(result.reason).toContain('Lower priority');
  });

  it('clamps negative monetaryValue to 0', () => {
    const result = calculatePriorityFallback({ monetaryValue: -1000 });
    expect(result.score).toBe(0);
  });

  it('clamps negative revenuePotential to 0', () => {
    const result = calculatePriorityFallback({ revenuePotential: -500 });
    expect(result.score).toBe(0);
  });

  it('scores high for large monetary value', () => {
    const result = calculatePriorityFallback({ monetaryValue: 10000 });
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.reason).toContain('$10,000');
  });

  it('scores high for revenue potential', () => {
    const result = calculatePriorityFallback({ revenuePotential: 5000 });
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.reason).toContain('revenue');
  });

  it('caps score at 100', () => {
    const result = calculatePriorityFallback({
      monetaryValue: 100000,
      revenuePotential: 100000,
      urgency: 10,
      strategicValue: 10,
      userManualBoost: 10,
    });
    expect(result.score).toBe(100);
  });

  it('includes urgency in reason when >= 7', () => {
    const result = calculatePriorityFallback({ urgency: 8 });
    expect(result.reason).toContain('urgent');
  });

  it('includes strategic value in reason when >= 7', () => {
    const result = calculatePriorityFallback({ strategicValue: 9 });
    expect(result.reason).toContain('strategic');
  });

  it('clamps urgency to 0-10 range', () => {
    const high = calculatePriorityFallback({ urgency: 15 });
    const capped = calculatePriorityFallback({ urgency: 10 });
    expect(high.score).toBe(capped.score);

    const low = calculatePriorityFallback({ urgency: -5 });
    const zero = calculatePriorityFallback({ urgency: 0 });
    expect(low.score).toBe(zero.score);
  });

  it('adds manual boost correctly', () => {
    const without = calculatePriorityFallback({ urgency: 5 });
    const with5 = calculatePriorityFallback({ urgency: 5, userManualBoost: 5 });
    expect(with5.score).toBe(without.score + 10);
  });

  it('produces known score for known input', () => {
    // monetaryValue=1000 -> mvNorm=1 -> 1*3.5 = 3.5
    // urgency=9 -> 9*2.0 = 18
    // total = 21.5 -> round = 22
    const result = calculatePriorityFallback({ monetaryValue: 1000, urgency: 9 });
    expect(result.score).toBe(22);
  });

  // Due date tests
  it('boosts score for overdue tasks (+25)', () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: yesterday });
    expect(withDue.score).toBe(without.score + 25);
    expect(withDue.reason).toContain('overdue');
  });

  it('boosts score for tasks due today (+20)', () => {
    // Use a date ~12 hours from now to ensure Math.round gives 0 days
    const today = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: today });
    expect(withDue.score).toBe(without.score + 20);
    expect(withDue.reason).toContain('due today');
  });

  it('boosts score for tasks due within 3 days (+10)', () => {
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: inTwoDays });
    expect(withDue.score).toBe(without.score + 10);
    expect(withDue.reason).toContain('due in');
  });

  it('boosts score for tasks due within 7 days (+5)', () => {
    const inSixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: inSixDays });
    expect(withDue.score).toBe(without.score + 5);
    expect(withDue.reason).toContain('due this week');
  });

  it('does not boost score for tasks due far in the future', () => {
    const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: inThirtyDays });
    expect(withDue.score).toBe(without.score);
  });

  it('caps score at 100 even with due date boost', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = calculatePriorityFallback({
      monetaryValue: 100000,
      revenuePotential: 100000,
      urgency: 10,
      strategicValue: 10,
      userManualBoost: 10,
      dueDate: yesterday,
    });
    expect(result.score).toBe(100);
  });

  it('handles null dueDate without boost', () => {
    const result = calculatePriorityFallback({ urgency: 5, dueDate: null });
    const resultNoDue = calculatePriorityFallback({ urgency: 5 });
    expect(result.score).toBe(resultNoDue.score);
  });
});
