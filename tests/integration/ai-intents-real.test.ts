/**
 * Real OpenAI API tests for intent classification with new fields.
 * Validates that GPT-4o-mini correctly classifies utterances for:
 * - assignee updates
 * - priority overrides with reason
 * - recurrence rules
 *
 * Uses the production classifyTextIntent() function from ai.ts
 * to ensure tests always match the actual prompt.
 *
 * These tests call the REAL OpenAI API — no mocks.
 * Requires OPENAI_API_KEY in .env.local and CI secrets.
 * Tests FAIL if the key is missing — never skip.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { classifyTextIntent } from '../../src/lib/ai';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function classifyText(text: string, taskTitles: string[]): Promise<any> {
  return classifyTextIntent(text, taskTitles);
}

const existingTasks = [
  'Budget review report',
  'Nexus tutorial release',
  'Team standup meeting',
  'Q3 revenue forecast',
  'Client onboarding presentation',
];

describe('Real OpenAI intent classification — assignee', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required. Set it in .env.local or CI secrets.');
    }
  });
  it('classifies "assign the budget review to Sarah" as update_task with assignee', async () => {
    const intent = await classifyText(
      'assign the budget review to Sarah',
      existingTasks
    );

    expect(intent.intent).toBe('update_task');
    expect(intent.task_query.toLowerCase()).toContain('budget');
    expect(intent.updates).toBeDefined();
    expect(intent.updates.assignee).toBe('Sarah');
  }, 30_000);

  it('classifies "John is now responsible for the Q3 forecast" as update_task with assignee', async () => {
    const intent = await classifyText(
      'John is now responsible for the Q3 forecast',
      existingTasks
    );

    expect(intent.intent).toBe('update_task');
    expect(intent.task_query.toLowerCase()).toContain('q3');
    expect(intent.updates).toBeDefined();
    expect(intent.updates.assignee).toMatch(/john/i);
  }, 30_000);
});

describe('Real OpenAI intent classification — priority override', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required. Set it in .env.local or CI secrets.');
    }
  });
  it('classifies "make the Nexus tutorial my top priority because the VP asked for it" correctly', async () => {
    const intent = await classifyText(
      'make the Nexus tutorial my top priority because the VP asked for it',
      existingTasks
    );

    expect(intent.intent).toBe('update_task');
    expect(intent.task_query.toLowerCase()).toContain('nexus');
    expect(intent.updates).toBeDefined();
    expect(intent.updates.priority_override).toBeGreaterThanOrEqual(90);
    expect(intent.updates.priority_reason).toBeTruthy();
    expect(intent.updates.priority_reason.toLowerCase()).toContain('vp');
  }, 30_000);

  it('classifies "the client presentation should be higher priority, the meeting is tomorrow" correctly', async () => {
    const intent = await classifyText(
      'the client presentation should be higher priority, the meeting is tomorrow',
      existingTasks
    );

    // The enhanced prompt may classify this as batch_update (client + meeting)
    // or update_task (client only). Both are valid interpretations.
    expect(['update_task', 'batch_update']).toContain(intent.intent);

    if (intent.intent === 'update_task') {
      expect(intent.task_query.toLowerCase()).toContain('client');
      expect(intent.updates).toBeDefined();
      expect(intent.updates.priority_override).toBeGreaterThanOrEqual(70);
      expect(intent.updates.priority_reason).toBeTruthy();
    } else {
      // batch_update: at least one entry should reference the client presentation
      const clientUpdate = intent.updates.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (u: any) => u.task_query?.toLowerCase().includes('client')
      );
      expect(clientUpdate).toBeDefined();
      expect(clientUpdate.updates.priority_override).toBeGreaterThanOrEqual(70);
    }
  }, 30_000);
});

describe('Real OpenAI intent classification — recurrence', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required. Set it in .env.local or CI secrets.');
    }
  });
  it('classifies "make the standup recurring every Monday" as update_task with recurrence', async () => {
    const intent = await classifyText(
      'make the standup recurring every Monday',
      existingTasks
    );

    expect(intent.intent).toBe('update_task');
    expect(intent.task_query.toLowerCase()).toContain('standup');
    expect(intent.updates).toBeDefined();
    expect(intent.updates.recurrence_rule).toBe('weekly');
    expect(intent.updates.recurrence_days).toContain('1');
  }, 30_000);

  it('classifies "the budget review should happen every month" as update_task with monthly recurrence', async () => {
    const intent = await classifyText(
      'the budget review should happen every month',
      existingTasks
    );

    expect(intent.intent).toBe('update_task');
    expect(intent.task_query.toLowerCase()).toContain('budget');
    expect(intent.updates).toBeDefined();
    expect(intent.updates.recurrence_rule).toBe('monthly');
  }, 30_000);
});

describe('Real OpenAI intent classification — start_task', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required. Set it in .env.local or CI secrets.');
    }
  });

  it('classifies "I\'m working on the budget review" as start_task', async () => {
    const intent = await classifyText(
      "I'm working on the budget review",
      existingTasks
    );

    expect(intent.intent).toBe('start_task');
    expect(intent.task_query.toLowerCase()).toContain('budget');
  }, 30_000);

  it('classifies "I started the Q3 forecast" as start_task', async () => {
    const intent = await classifyText(
      'I started the Q3 forecast',
      existingTasks
    );

    expect(intent.intent).toBe('start_task');
    expect(intent.task_query.toLowerCase()).toContain('q3');
  }, 30_000);
});
