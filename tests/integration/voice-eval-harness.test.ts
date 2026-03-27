/**
 * Voice-to-task evaluation harness.
 * Reads gold dataset from tests/fixtures/voice-gold-dataset.jsonl,
 * classifies each utterance via real OpenAI API, and scores field-by-field.
 *
 * This is the foundation for measuring whether prompt changes help or hurt.
 *
 * These tests call the REAL OpenAI API — no mocks.
 * Requires OPENAI_API_KEY in .env.local and CI secrets.
 * Tests FAIL if the key is missing — never skip.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { classifyTextIntent } from '../../src/lib/ai';
import { readFileSync } from 'fs';
import { join } from 'path';

// --- Types ---

interface GoldExpectedTask {
  title_contains?: string;
  due_date_iso?: string;
  assignee_contains?: string;
  expected_subtasks?: string[];
  urgency_min?: number;
  urgency_max?: number;
  monetary_value_min?: number;
  category_contains?: string;
}

interface GoldExpectedOutput {
  task_count?: number;
  tasks?: GoldExpectedTask[];
  task_query_contains?: string;
  update_count?: number;
  updates?: Array<{
    task_query_contains?: string;
    assignee_contains?: string;
    due_date_iso?: string;
    priority_override_max?: number;
  }>;
  [key: string]: unknown;
}

interface GoldTestCase {
  id: string;
  scenario_bucket: string;
  raw_utterance: string;
  context: {
    current_date: string;
    timezone: string;
    existing_tasks: string[];
  };
  expected_intent: string;
  expected_output: GoldExpectedOutput;
  should_clarify: boolean;
  notes: string;
}

interface EvalResult {
  id: string;
  bucket: string;
  intent_match: boolean;
  task_count_match: boolean;
  title_score: number;
  due_date_score: number;
  owner_score: number;
  subtask_score: number;
  priority_score: number;
  overall_score: number;
}

// --- Scoring weights (from issue #22) ---
const WEIGHTS = {
  intent: 0.25,
  title: 0.15,
  due_date: 0.15,
  owner: 0.15,
  subtasks: 0.10,
  task_count: 0.10,
  priority: 0.10,
};

// --- Evaluators ---

function intentMatch(expected: string, actual: string): boolean {
  return expected === actual;
}

function taskCountMatch(expected: number | undefined, actual: number): boolean {
  if (expected === undefined) return true;
  return expected === actual;
}

function titleScore(expectedTasks: GoldExpectedTask[] | undefined, actualTasks: unknown[]): number {
  if (!expectedTasks || expectedTasks.length === 0) return 1;
  let matched = 0;
  for (const exp of expectedTasks) {
    if (!exp.title_contains) { matched++; continue; }
    const needle = exp.title_contains.toLowerCase();
    const found = actualTasks.some((t: unknown) => {
      const task = t as Record<string, unknown>;
      const title = String(task.title ?? '').toLowerCase();
      return title.includes(needle);
    });
    if (found) matched++;
  }
  return matched / expectedTasks.length;
}

function dueDateScore(expectedTasks: GoldExpectedTask[] | undefined, actualTasks: unknown[]): number {
  if (!expectedTasks) return 1;
  const tasksWithDates = expectedTasks.filter(t => t.due_date_iso);
  if (tasksWithDates.length === 0) return 1;
  let matched = 0;
  for (const exp of tasksWithDates) {
    const found = actualTasks.some((t: unknown) => {
      const task = t as Record<string, unknown>;
      return String(task.due_date ?? '') === exp.due_date_iso;
    });
    if (found) matched++;
  }
  return matched / tasksWithDates.length;
}

function ownerScore(expectedTasks: GoldExpectedTask[] | undefined, actualTasks: unknown[]): number {
  if (!expectedTasks) return 1;
  const tasksWithOwners = expectedTasks.filter(t => t.assignee_contains);
  if (tasksWithOwners.length === 0) return 1;
  let matched = 0;
  for (const exp of tasksWithOwners) {
    const needle = exp.assignee_contains!.toLowerCase();
    const found = actualTasks.some((t: unknown) => {
      const task = t as Record<string, unknown>;
      const assignee = String(task.assignee ?? '').toLowerCase();
      return assignee.includes(needle);
    });
    if (found) matched++;
  }
  return matched / tasksWithOwners.length;
}

function subtaskScore(expectedTasks: GoldExpectedTask[] | undefined, actualTasks: unknown[]): number {
  if (!expectedTasks) return 1;
  const tasksWithSubtasks = expectedTasks.filter(t => t.expected_subtasks && t.expected_subtasks.length > 0);
  if (tasksWithSubtasks.length === 0) return 1;

  let totalF1 = 0;
  for (const exp of tasksWithSubtasks) {
    const expectedSubs = exp.expected_subtasks!.map(s => s.toLowerCase());
    // Find the actual task that best matches this expected task
    let bestF1 = 0;
    for (const t of actualTasks) {
      const task = t as Record<string, unknown>;
      const actualSubs = (task.subtasks as Array<Record<string, unknown>> | undefined)
        ?.map(s => String(s.title ?? s).toLowerCase()) ?? [];
      if (actualSubs.length === 0) continue;

      // Compute F1 using containment matching
      let tp = 0;
      for (const es of expectedSubs) {
        if (actualSubs.some(as => as.includes(es) || es.includes(as))) tp++;
      }
      const precision = actualSubs.length > 0 ? tp / actualSubs.length : 0;
      const recall = expectedSubs.length > 0 ? tp / expectedSubs.length : 0;
      const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
      bestF1 = Math.max(bestF1, f1);
    }
    totalF1 += bestF1;
  }
  return totalF1 / tasksWithSubtasks.length;
}

function priorityScore(expectedTasks: GoldExpectedTask[] | undefined, actualTasks: unknown[]): number {
  if (!expectedTasks) return 1;
  const tasksWithPriority = expectedTasks.filter(t =>
    t.urgency_min !== undefined || t.urgency_max !== undefined || t.monetary_value_min !== undefined
  );
  if (tasksWithPriority.length === 0) return 1;
  let matched = 0;
  for (const exp of tasksWithPriority) {
    const found = actualTasks.some((t: unknown) => {
      const task = t as Record<string, unknown>;
      const urgency = Number(task.urgency ?? 0);
      const monetaryValue = Number(task.monetary_value ?? 0);
      let passes = true;
      if (exp.urgency_min !== undefined) passes = passes && urgency >= exp.urgency_min;
      if (exp.urgency_max !== undefined) passes = passes && urgency <= exp.urgency_max;
      if (exp.monetary_value_min !== undefined) passes = passes && monetaryValue >= exp.monetary_value_min;
      return passes;
    });
    if (found) matched++;
  }
  return matched / tasksWithPriority.length;
}

function categoryScore(expectedTasks: GoldExpectedTask[] | undefined, actualTasks: unknown[]): number {
  if (!expectedTasks) return 1;
  const tasksWithCategory = expectedTasks.filter(t => t.category_contains);
  if (tasksWithCategory.length === 0) return 1;
  let matched = 0;
  for (const exp of tasksWithCategory) {
    const needle = exp.category_contains!.toLowerCase();
    const found = actualTasks.some((t: unknown) => {
      const task = t as Record<string, unknown>;
      const category = String(task.category ?? '').toLowerCase();
      return category.includes(needle);
    });
    if (found) matched++;
  }
  return matched / tasksWithCategory.length;
}

// --- Evaluate update intents ---

function evaluateUpdateIntent(gold: GoldTestCase, actual: Record<string, unknown>): EvalResult {
  const result: EvalResult = {
    id: gold.id,
    bucket: gold.scenario_bucket,
    intent_match: intentMatch(gold.expected_intent, String(actual.intent)),
    task_count_match: true,
    title_score: 1,
    due_date_score: 1,
    owner_score: 1,
    subtask_score: 1,
    priority_score: 1,
    overall_score: 0,
  };

  const exp = gold.expected_output;

  // Check task_query
  if (exp.task_query_contains) {
    const needle = exp.task_query_contains.toLowerCase();
    const taskQuery = String(actual.task_query ?? '').toLowerCase();
    result.title_score = taskQuery.includes(needle) ? 1 : 0;
  }

  // Check updates fields
  const actualUpdates = (actual.updates ?? {}) as Record<string, unknown>;
  const expUpdates = exp.updates?.[0] ?? (exp as Record<string, unknown>).updates as Record<string, unknown> | undefined;

  if (expUpdates && typeof expUpdates === 'object' && !Array.isArray(expUpdates)) {
    if ('assignee_contains' in expUpdates) {
      const needle = String(expUpdates.assignee_contains).toLowerCase();
      const assignee = String(actualUpdates.assignee ?? '').toLowerCase();
      result.owner_score = assignee.includes(needle) ? 1 : 0;
    }
    if ('due_date_iso' in expUpdates) {
      result.due_date_score = String(actualUpdates.due_date ?? '') === String(expUpdates.due_date_iso) ? 1 : 0;
    }
    if ('priority_override_max' in expUpdates) {
      const maxVal = Number(expUpdates.priority_override_max);
      const actual_po = Number(actualUpdates.priority_override ?? 100);
      result.priority_score = actual_po <= maxVal ? 1 : 0;
    }
  }

  result.overall_score = computeOverall(result);
  return result;
}

// --- Evaluate batch_update intents ---

function evaluateBatchIntent(gold: GoldTestCase, actual: Record<string, unknown>): EvalResult {
  const result: EvalResult = {
    id: gold.id,
    bucket: gold.scenario_bucket,
    intent_match: intentMatch(gold.expected_intent, String(actual.intent)),
    task_count_match: true,
    title_score: 1,
    due_date_score: 1,
    owner_score: 1,
    subtask_score: 1,
    priority_score: 1,
    overall_score: 0,
  };

  const expUpdates = gold.expected_output.updates ?? [];
  const actualUpdates = (actual.updates ?? []) as Array<Record<string, unknown>>;

  if (gold.expected_output.update_count !== undefined) {
    result.task_count_match = actualUpdates.length === gold.expected_output.update_count;
  }

  let ownerMatches = 0;
  let ownerTotal = 0;
  let titleMatches = 0;

  for (const exp of expUpdates) {
    if (exp.task_query_contains) {
      const needle = String(exp.task_query_contains).toLowerCase();
      const found = actualUpdates.some(u =>
        String(u.task_query ?? '').toLowerCase().includes(needle)
      );
      if (found) titleMatches++;
    }
    if (exp.assignee_contains) {
      ownerTotal++;
      const needle = String(exp.assignee_contains).toLowerCase();
      const found = actualUpdates.some(u => {
        const updates = (u.updates ?? {}) as Record<string, unknown>;
        return String(updates.assignee ?? '').toLowerCase().includes(needle);
      });
      if (found) ownerMatches++;
    }
  }

  const queryTotal = expUpdates.filter(u => u.task_query_contains).length;
  result.title_score = queryTotal > 0 ? titleMatches / queryTotal : 1;
  result.owner_score = ownerTotal > 0 ? ownerMatches / ownerTotal : 1;

  result.overall_score = computeOverall(result);
  return result;
}

// --- Compute weighted overall ---

function computeOverall(r: EvalResult): number {
  return (
    (r.intent_match ? 1 : 0) * WEIGHTS.intent +
    r.title_score * WEIGHTS.title +
    r.due_date_score * WEIGHTS.due_date +
    r.owner_score * WEIGHTS.owner +
    r.subtask_score * WEIGHTS.subtasks +
    (r.task_count_match ? 1 : 0) * WEIGHTS.task_count +
    r.priority_score * WEIGHTS.priority
  );
}

// --- Main evaluation ---

function evaluateCase(gold: GoldTestCase, actual: Record<string, unknown>): EvalResult {
  if (gold.expected_intent === 'update_task') {
    return evaluateUpdateIntent(gold, actual);
  }
  if (gold.expected_intent === 'batch_update') {
    return evaluateBatchIntent(gold, actual);
  }

  // Simple intents: complete_task, start_task, delete_task, unknown
  if (['complete_task', 'start_task', 'delete_task', 'unknown'].includes(gold.expected_intent)) {
    const result: EvalResult = {
      id: gold.id,
      bucket: gold.scenario_bucket,
      intent_match: intentMatch(gold.expected_intent, String(actual.intent)),
      task_count_match: true,
      title_score: 1,
      due_date_score: 1,
      owner_score: 1,
      subtask_score: 1,
      priority_score: 1,
      overall_score: 0,
    };

    // Check task_query for intents that reference a task
    if (gold.expected_output.task_query_contains) {
      const needle = gold.expected_output.task_query_contains.toLowerCase();
      const taskQuery = String(actual.task_query ?? '').toLowerCase();
      result.title_score = taskQuery.includes(needle) ? 1 : 0;
    }

    result.overall_score = computeOverall(result);
    return result;
  }

  // create_tasks
  const result: EvalResult = {
    id: gold.id,
    bucket: gold.scenario_bucket,
    intent_match: intentMatch(gold.expected_intent, String(actual.intent)),
    task_count_match: true,
    title_score: 1,
    due_date_score: 1,
    owner_score: 1,
    subtask_score: 1,
    priority_score: 1,
    overall_score: 0,
  };

  const actualTasks = (actual.tasks ?? []) as unknown[];
  const exp = gold.expected_output;

  result.task_count_match = taskCountMatch(exp.task_count, actualTasks.length);
  result.title_score = titleScore(exp.tasks, actualTasks);
  result.due_date_score = dueDateScore(exp.tasks, actualTasks);
  result.owner_score = ownerScore(exp.tasks, actualTasks);
  result.subtask_score = subtaskScore(exp.tasks, actualTasks);

  // Combine priority and category into priority_score
  const pScore = priorityScore(exp.tasks, actualTasks);
  const cScore = categoryScore(exp.tasks, actualTasks);
  const hasPriority = exp.tasks?.some(t => t.urgency_min !== undefined || t.urgency_max !== undefined || t.monetary_value_min !== undefined);
  const hasCategory = exp.tasks?.some(t => t.category_contains);
  if (hasPriority && hasCategory) {
    result.priority_score = (pScore + cScore) / 2;
  } else if (hasCategory) {
    result.priority_score = cScore;
  } else {
    result.priority_score = pScore;
  }

  result.overall_score = computeOverall(result);
  return result;
}

// --- Load dataset ---

function loadGoldDataset(): GoldTestCase[] {
  const raw = readFileSync(
    join(__dirname, '../fixtures/voice-gold-dataset.jsonl'),
    'utf-8'
  );
  return raw.trim().split('\n').map(line => JSON.parse(line));
}

// --- Tests ---

describe('Voice-to-task evaluation harness', () => {
  let goldCases: GoldTestCase[];

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required. Set it in .env.local or CI secrets.');
    }
    goldCases = loadGoldDataset();
  });

  it('gold dataset loads correctly', () => {
    expect(goldCases.length).toBeGreaterThanOrEqual(30);
    for (const c of goldCases) {
      expect(c.id).toBeTruthy();
      expect(c.scenario_bucket).toBeTruthy();
      expect(c.raw_utterance).toBeTruthy();
      expect(c.expected_intent).toBeTruthy();
    }
  });

  it('evaluates all gold cases and reports scores', async () => {
    const results: EvalResult[] = [];

    for (const gold of goldCases) {
      const actual = await classifyTextIntent(
        gold.raw_utterance,
        gold.context.existing_tasks,
        gold.context.current_date
      ) as unknown as Record<string, unknown>;

      const result = evaluateCase(gold, actual);
      results.push(result);
    }

    // Log per-case results
    console.log('\n=== Voice Eval Results ===');
    console.log(
      'ID'.padEnd(20),
      'Bucket'.padEnd(25),
      'Intent'.padEnd(8),
      'Count'.padEnd(7),
      'Title'.padEnd(7),
      'Date'.padEnd(7),
      'Owner'.padEnd(7),
      'Subs'.padEnd(7),
      'Pri'.padEnd(7),
      'Overall'
    );
    console.log('-'.repeat(110));

    for (const r of results) {
      console.log(
        r.id.padEnd(20),
        r.bucket.padEnd(25),
        (r.intent_match ? 'PASS' : 'FAIL').padEnd(8),
        (r.task_count_match ? 'PASS' : 'FAIL').padEnd(7),
        r.title_score.toFixed(2).padEnd(7),
        r.due_date_score.toFixed(2).padEnd(7),
        r.owner_score.toFixed(2).padEnd(7),
        r.subtask_score.toFixed(2).padEnd(7),
        r.priority_score.toFixed(2).padEnd(7),
        r.overall_score.toFixed(2)
      );
    }

    // Log per-bucket aggregates
    const buckets = [...new Set(results.map(r => r.bucket))];
    console.log('\n=== Per-Bucket Aggregates ===');
    for (const bucket of buckets) {
      const bucketResults = results.filter(r => r.bucket === bucket);
      const avgScore = bucketResults.reduce((sum, r) => sum + r.overall_score, 0) / bucketResults.length;
      const intentRate = bucketResults.filter(r => r.intent_match).length / bucketResults.length;
      console.log(`  ${bucket}: avg=${avgScore.toFixed(2)}, intent_rate=${(intentRate * 100).toFixed(0)}%, n=${bucketResults.length}`);
    }

    // Log overall aggregate
    const overallAvg = results.reduce((sum, r) => sum + r.overall_score, 0) / results.length;
    const intentRate = results.filter(r => r.intent_match).length / results.length;
    console.log(`\n  OVERALL: avg=${overallAvg.toFixed(2)}, intent_rate=${(intentRate * 100).toFixed(0)}%, n=${results.length}`);

    // Assertions — tightened from baseline (PR 1 scored 0.96 avg, 100% intent)
    expect(overallAvg).toBeGreaterThanOrEqual(0.7);
    expect(intentRate).toBeGreaterThanOrEqual(0.8);

    // Each case should score above minimum
    for (const r of results) {
      expect(r.overall_score, `Case ${r.id} scored too low`).toBeGreaterThanOrEqual(0.25);
    }
  }, 300_000);
});
