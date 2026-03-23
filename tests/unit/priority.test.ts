import { describe, it, expect } from 'vitest';
import { calculatePriorityFallback, enforceMonetaryOrdering } from '../../src/lib/priority';

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

  it('$75K task scores higher than $1K task', () => {
    const low = calculatePriorityFallback({ monetaryValue: 1000 });
    const high = calculatePriorityFallback({ monetaryValue: 75000 });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('$500K task scores higher than $75K task', () => {
    const mid = calculatePriorityFallback({ monetaryValue: 75000 });
    const high = calculatePriorityFallback({ monetaryValue: 500000 });
    expect(high.score).toBeGreaterThan(mid.score);
  });

  it('uses log scale — $10K is not 10x $1K in score', () => {
    const k1 = calculatePriorityFallback({ monetaryValue: 1000 });
    const k10 = calculatePriorityFallback({ monetaryValue: 10000 });
    // Log scale: $10K should not be 10x the score of $1K
    expect(k10.score).toBeLessThan(k1.score * 3);
    expect(k10.score).toBeGreaterThan(k1.score);
  });

  // Due date tests
  it('boosts score for overdue tasks (+15)', () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: yesterday });
    expect(withDue.score).toBe(without.score + 15);
    expect(withDue.reason).toContain('overdue');
  });

  it('boosts score for tasks due today (+12)', () => {
    const today = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: today });
    expect(withDue.score).toBe(without.score + 12);
    expect(withDue.reason).toContain('due today');
  });

  it('boosts score for tasks due within 3 days (+8)', () => {
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: inTwoDays });
    expect(withDue.score).toBe(without.score + 8);
    expect(withDue.reason).toContain('due in');
  });

  it('boosts score for tasks due within 7 days (+4)', () => {
    const inSixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const without = calculatePriorityFallback({ urgency: 5 });
    const withDue = calculatePriorityFallback({ urgency: 5, dueDate: inSixDays });
    expect(withDue.score).toBe(without.score + 4);
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

  it('$1M task scores higher than $78K task (fallback)', () => {
    const million = calculatePriorityFallback({ monetaryValue: 1000000 });
    const seventy8k = calculatePriorityFallback({ monetaryValue: 78000 });
    expect(million.score).toBeGreaterThan(seventy8k.score);
  });

  it('$1M > $78K > $12K ordering in fallback', () => {
    const million = calculatePriorityFallback({ monetaryValue: 1000000 });
    const seventy8k = calculatePriorityFallback({ monetaryValue: 78000 });
    const twelve = calculatePriorityFallback({ monetaryValue: 12000 });
    expect(million.score).toBeGreaterThan(seventy8k.score);
    expect(seventy8k.score).toBeGreaterThan(twelve.score);
  });

  it('monetary value gets 60% weight (up from 50%)', () => {
    // log10(1000000) = 6, * 12 = 72, capped at 60
    const million = calculatePriorityFallback({ monetaryValue: 1000000 });
    expect(million.score).toBe(60);
  });
});

describe('enforceMonetaryOrdering', () => {
  it('$1M task scores higher than $78K task after correction', () => {
    const scored = [
      { id: 1, score: 60, reason: 'low' },
      { id: 2, score: 100, reason: 'high' },
    ];
    const details = [
      { id: 1, monetaryValue: 1000000, revenuePotential: null, manualPriorityScore: null },
      { id: 2, monetaryValue: 78000, revenuePotential: null, manualPriorityScore: null },
    ];
    const result = enforceMonetaryOrdering(scored, details);
    const task1 = result.find(r => r.id === 1)!;
    const task2 = result.find(r => r.id === 2)!;
    expect(task1.score).toBeGreaterThanOrEqual(task2.score);
  });

  it('$78K task scores higher than $12K task after correction', () => {
    const scored = [
      { id: 1, score: 50, reason: 'a' },
      { id: 2, score: 90, reason: 'b' },
    ];
    const details = [
      { id: 1, monetaryValue: 78000, revenuePotential: null, manualPriorityScore: null },
      { id: 2, monetaryValue: 12000, revenuePotential: null, manualPriorityScore: null },
    ];
    const result = enforceMonetaryOrdering(scored, details);
    const task1 = result.find(r => r.id === 1)!;
    const task2 = result.find(r => r.id === 2)!;
    expect(task1.score).toBeGreaterThanOrEqual(task2.score);
  });

  it('preserves manual overrides (does not change them)', () => {
    const scored = [
      { id: 1, score: 30, reason: 'low' },
      { id: 2, score: 80, reason: 'manual' },
    ];
    const details = [
      { id: 1, monetaryValue: 1000000, revenuePotential: null, manualPriorityScore: null },
      { id: 2, monetaryValue: 100, revenuePotential: null, manualPriorityScore: 80 },
    ];
    const result = enforceMonetaryOrdering(scored, details);
    // Task 2 has manual override, should not be in monetary ordering
    // Task 1 has $1M with no one to compare against (task 2 is excluded)
    const task2 = result.find(r => r.id === 2)!;
    expect(task2.score).toBe(80); // unchanged
  });

  it('no-op when no monetary values present', () => {
    const scored = [
      { id: 1, score: 50, reason: 'a' },
      { id: 2, score: 80, reason: 'b' },
    ];
    const details = [
      { id: 1, monetaryValue: null, revenuePotential: null, manualPriorityScore: null },
      { id: 2, monetaryValue: null, revenuePotential: null, manualPriorityScore: null },
    ];
    const result = enforceMonetaryOrdering(scored, details);
    expect(result).toEqual(scored);
  });

  it('handles empty task list gracefully', () => {
    const result = enforceMonetaryOrdering([], []);
    expect(result).toEqual([]);
  });

  it('tasks with equal monetary values keep AI ordering', () => {
    const scored = [
      { id: 1, score: 70, reason: 'a' },
      { id: 2, score: 80, reason: 'b' },
    ];
    const details = [
      { id: 1, monetaryValue: 50000, revenuePotential: null, manualPriorityScore: null },
      { id: 2, monetaryValue: 50000, revenuePotential: null, manualPriorityScore: null },
    ];
    const result = enforceMonetaryOrdering(scored, details);
    // Same monetary value, AI ordering preserved
    const task1 = result.find(r => r.id === 1)!;
    const task2 = result.find(r => r.id === 2)!;
    expect(task1.score).toBe(70);
    expect(task2.score).toBe(80);
  });

  it('enforces minimum 5-point gap for >5x value ratio', () => {
    const scored = [
      { id: 1, score: 82, reason: 'a' },
      { id: 2, score: 80, reason: 'b' },
    ];
    const details = [
      { id: 1, monetaryValue: 1000000, revenuePotential: null, manualPriorityScore: null },
      { id: 2, monetaryValue: 10000, revenuePotential: null, manualPriorityScore: null },
    ];
    const result = enforceMonetaryOrdering(scored, details);
    const task1 = result.find(r => r.id === 1)!;
    const task2 = result.find(r => r.id === 2)!;
    expect(task1.score - task2.score).toBeGreaterThanOrEqual(5);
  });
});
