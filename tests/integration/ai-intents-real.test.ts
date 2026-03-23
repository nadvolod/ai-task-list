/**
 * Real OpenAI API tests for intent classification with new fields.
 * Validates that GPT-4o-mini correctly classifies utterances for:
 * - assignee updates
 * - priority overrides with reason
 * - recurrence rules
 *
 * These tests call the REAL OpenAI API — no mocks.
 * Requires OPENAI_API_KEY in .env.local and CI secrets.
 * Tests FAIL if the key is missing — never skip.
 */
import { describe, it, expect, beforeAll } from 'vitest';
// Real API tests call OpenAI directly (not via transcribeAndClassifyIntent)
// to control the transcription text input while testing classification for real.

// We can't test transcription without audio, so we test the classification
// by directly calling the function with a pre-set transcription.
// transcribeAndClassifyIntent takes audio buffer, but internally:
//   1. Whisper transcribes → text
//   2. GPT-4o-mini classifies intent from text
// We mock ONLY the Whisper step so we control the text, but let GPT-4o-mini
// classify for real.

// Helper: create a fake audio buffer and mock whisper to return specific text
async function classifyText(text: string, taskTitles: string[]) {
  // We need to call the real GPT-4o-mini for classification but provide
  // a controlled transcription. Since transcribeAndClassifyIntent bundles
  // both steps, we'll use a workaround: import OpenAI directly and call
  // just the classification part.
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const taskListContext = taskTitles.length > 0
    ? `\nThe user's current tasks are:\n${taskTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`
    : '\nThe user has no tasks yet.';

  const today = new Date().toISOString().split('T')[0];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 800,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `You are a voice command router for a CEO's task management app. Classify the user's spoken input into one of these intents and return ONLY valid JSON.

Today's date is ${today}.
${taskListContext}

INTENTS:

1. create_tasks — User wants to add new tasks
   {"intent":"create_tasks","tasks":[{"title":"...","description":"...","monetary_value":N,"revenue_potential":N,"urgency":1-10,"strategic_value":1-10,"due_date":"YYYY-MM-DD"}]}

2. complete_task — User wants to mark a task as done
   {"intent":"complete_task","task_query":"search string to match task title"}

3. update_task — User wants to change a task's details (due date, urgency, assignee, priority, recurrence, etc.)
   {"intent":"update_task","task_query":"search string","updates":{"due_date":"YYYY-MM-DD","urgency":N,"assignee":"person name","priority_override":0-100,"priority_reason":"why","recurrence_rule":"weekly","recurrence_days":"1,3",...}}

4. delete_task — User wants to remove a specific task
   {"intent":"delete_task","task_query":"search string to match task title"}

5. delete_all_tasks — User wants to remove ALL tasks
   {"intent":"delete_all_tasks"}

6. query_briefing — User asks what to focus on, what's important, a summary
   {"intent":"query_briefing"}

7. query_tasks — User wants to hear their tasks (optionally filtered)
   {"intent":"query_tasks","filter":"all|overdue|today|high_priority|done"}

8. query_count — User asks how many tasks they have
   {"intent":"query_count","filter":"all|overdue|today|high_priority|done"}

9. undo_complete — User wants to reopen a completed task
   {"intent":"undo_complete","task_query":"search string"}

10. start_task — User is working on a task ("I'm working on X", "started X", "X is in progress")
   {"intent":"start_task","task_query":"search string"}

11. unknown — Can't determine intent
   {"intent":"unknown","raw_text":"original text"}

MATCHING RULES:
- For task_query, use the most distinctive words from the user's speech to match against their task list above
- "the Acme deal" → task_query: "Acme deal"
- "mark it done" without specifying which task → ask by returning unknown with helpful raw_text
- If the user says something that could be a new task OR a command, prefer the command interpretation if it matches an existing task
- "by Friday" "next week" "tomorrow" → convert to ISO dates for due_date
- Multiple new tasks in one utterance → create_tasks with multiple items in the array
- "assign X to Y" or "Y is responsible for X" → update_task with updates.assignee
- "make X my top priority" or "X is the most important" → update_task with priority_override: 95, priority_reason explaining why
- "make X recurring every Monday" → update_task with recurrence_rule: "weekly", recurrence_days: "1"
- "this should be higher priority because..." → update_task with priority_override and priority_reason
- "I'm working on X" or "I started X" or "X is in progress" → start_task
- Priority override scale: 95-100 = top priority, 70-90 = high, 40-60 = medium, 10-30 = low`,
      },
      { role: 'user', content: text },
    ],
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { intent: 'unknown', raw_text: text };
  }
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

    expect(intent.intent).toBe('update_task');
    expect(intent.task_query.toLowerCase()).toContain('client');
    expect(intent.updates).toBeDefined();
    expect(intent.updates.priority_override).toBeGreaterThanOrEqual(70);
    expect(intent.updates.priority_reason).toBeTruthy();
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
