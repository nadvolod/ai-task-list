/**
 * Real OpenAI API tests for batch_update intent classification.
 * Validates that GPT-4o-mini correctly classifies multi-task voice
 * commands into batch_update with the right per-task updates.
 *
 * These tests call the REAL OpenAI API — no mocks.
 * Requires OPENAI_API_KEY in .env.local and CI secrets.
 * Tests FAIL if the key is missing — never skip.
 */
import { describe, it, expect, beforeAll } from 'vitest';

async function classifyText(text: string, taskTitles: string[]) {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const taskListContext = taskTitles.length > 0
    ? `\nThe user's current tasks are:\n${taskTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`
    : '\nThe user has no tasks yet.';

  const today = new Date().toISOString().split('T')[0];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2000,
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

3. update_task — User wants to change a SINGLE task's details (due date, urgency, assignee, priority, recurrence, etc.)
   {"intent":"update_task","task_query":"search string","updates":{"due_date":"YYYY-MM-DD","urgency":N,"assignee":"person name","priority_override":0-100,"priority_reason":"why","recurrence_rule":"weekly","recurrence_days":"1,3",...}}

4. batch_update — User mentions updates to MULTIPLE existing tasks in one utterance
   {"intent":"batch_update","updates":[
     {"task_query":"search string for task 1","updates":{"description":"context from speech","priority_override":N,"priority_reason":"why",...},"subtasks":[{"title":"actionable follow-up","description":"context"}]},
     {"task_query":"search string for task 2","updates":{"due_date":"YYYY-MM-DD","description":"context",...}}
   ]}
   Use this when the user references 2 or more EXISTING tasks from their task list in one utterance.
   Each entry follows the same update fields as update_task.
   Always include a "description" field summarizing what the user said about that task (status update, what happened, what's pending).
   Add "subtasks" array when the user mentions specific actionable follow-up items for a task.

5. delete_task — User wants to remove a specific task
   {"intent":"delete_task","task_query":"search string to match task title"}

6. delete_all_tasks — User wants to remove ALL tasks
   {"intent":"delete_all_tasks"}

7. query_briefing — User asks what to focus on, what's important, a summary
   {"intent":"query_briefing"}

8. query_tasks — User wants to hear their tasks (optionally filtered)
   {"intent":"query_tasks","filter":"all|overdue|today|high_priority|done"}

9. query_count — User asks how many tasks they have
   {"intent":"query_count","filter":"all|overdue|today|high_priority|done"}

10. undo_complete — User wants to reopen a completed task
   {"intent":"undo_complete","task_query":"search string"}

11. start_task — User is working on a task ("I'm working on X", "started X", "X is in progress")
   {"intent":"start_task","task_query":"search string"}

12. unknown — Can't determine intent
   {"intent":"unknown","raw_text":"original text"}

MATCHING RULES:
- For task_query, use the most distinctive words from the user's speech to match against their task list above
- "the Acme deal" → task_query: "Acme deal"
- "mark it done" without specifying which task → ask by returning unknown with helpful raw_text
- If the user says something that could be a new task OR a command, prefer the command interpretation if it matches an existing task
- "by Friday" "next week" "tomorrow" → convert to ISO dates for due_date
- Multiple new tasks in one utterance → create_tasks with multiple items in the array
- If the user provides status updates on 2 or more EXISTING tasks in one utterance → batch_update. Each task's updates should include a "description" summarizing what the user said, plus priority_override/due_date/status if mentioned. Example: "On the Flagler sale, I emailed revisions. For Art's contract, make it top priority." → batch_update with 2 entries.
- "assign X to Y" or "Y is responsible for X" → update_task with updates.assignee
- "make X my top priority" or "X is the most important" → update_task with priority_override: 95, priority_reason explaining why
- "make X recurring every Monday" → update_task with recurrence_rule: "weekly", recurrence_days: "1"
- "this should be higher priority because..." → update_task with priority_override and priority_reason
- "I'm working on X" or "I started X" or "X is in progress" → start_task
- Priority override scale: 95-100 = top priority, 70-90 = high, 40-60 = medium, 10-30 = low
- ONLY set due_date when the user explicitly mentions a deadline or time constraint. Do NOT infer today's date. "I need to call John" → due_date: null. "Call John by Friday" → due_date: next Friday.
- If no assignee is mentioned, omit the assignee field entirely (the system defaults to the current user)`,
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
  'Flagler sale agreement',
  "Art's WHO contract",
  'Tricentis webinar promotion',
  'Flagler Insurance payment',
  "Tony Robbins' contract with Natalia",
];

describe('Real OpenAI intent classification — batch_update', () => {
  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required. Set it in .env.local or CI secrets.');
    }
  });

  it('classifies the full multi-task voice command as batch_update with all tasks', async () => {
    const text = "On the Flagler sale task, I emailed Dexter a bunch of revisions to the agreement and now we are waiting for his updates. For Art's WHO contract, that needs to become top priority because it is waiting on my signature to move forward. And I am a blocker. The new webinar for Tricentis also needs to be significantly moved up in priority because it has a due date and I need to start promoting it. Because the due date is April 16. And Flagler Insurance is waiting on me and next payment to make sure that the latest insurance was applied. And for a page to Tony Robbins' contract, I sent an email and now just waiting to get back from Natalia.";

    const intent = await classifyText(text, existingTasks);

    expect(intent.intent).toBe('batch_update');
    expect(intent.updates).toBeDefined();
    expect(Array.isArray(intent.updates)).toBe(true);
    expect(intent.updates.length).toBeGreaterThanOrEqual(4); // At least 4 of 5

    // Verify Flagler sale — description should mention Dexter/revisions
    const flaglerSale = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('flagler') && u.task_query.toLowerCase().includes('sale')
    );
    expect(flaglerSale).toBeDefined();
    expect(flaglerSale.updates.description).toBeTruthy();
    expect(flaglerSale.updates.description.toLowerCase()).toMatch(/dexter|revision/);

    // Verify Art's WHO contract — top priority
    const artWho = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('art') || u.task_query.toLowerCase().includes('who')
    );
    expect(artWho).toBeDefined();
    expect(artWho.updates.priority_override).toBeGreaterThanOrEqual(90);
    expect(artWho.updates.description).toBeTruthy();

    // Verify Tricentis webinar — due date and/or priority boost and description
    const tricentis = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('tricentis') || u.task_query.toLowerCase().includes('webinar')
    );
    expect(tricentis).toBeDefined();
    expect(tricentis.updates.description).toBeTruthy();
    // Model must recognize either the date or the priority boost (or both)
    const hasDate = tricentis.updates.due_date && tricentis.updates.due_date.includes('04-16');
    const hasPriority = tricentis.updates.priority_override != null && tricentis.updates.priority_override >= 70;
    expect(hasDate || hasPriority).toBe(true);

    // Verify Flagler Insurance — separate from Flagler sale
    const flaglerIns = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('insurance')
    );
    expect(flaglerIns).toBeDefined();
    expect(flaglerIns.updates.description).toBeTruthy();

    // Verify Tony Robbins — mentions Natalia
    const tony = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('tony') || u.task_query.toLowerCase().includes('robbins')
    );
    expect(tony).toBeDefined();
    expect(tony.updates.description).toBeTruthy();
    expect(tony.updates.description.toLowerCase()).toMatch(/natalia|email/);
  }, 60_000);

  it('classifies a simple 2-task update as batch_update', async () => {
    const text = "The budget review needs to be assigned to Sarah, and the Q3 forecast should be marked as high priority because the board meeting is next week.";
    const tasks = ['Budget review report', 'Q3 revenue forecast', 'Team standup meeting'];

    const intent = await classifyText(text, tasks);

    expect(intent.intent).toBe('batch_update');
    expect(intent.updates).toBeDefined();
    expect(intent.updates.length).toBe(2);

    const budget = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('budget')
    );
    expect(budget).toBeDefined();
    expect(budget.updates.assignee).toMatch(/sarah/i);

    const q3 = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('q3') || u.task_query.toLowerCase().includes('forecast')
    );
    expect(q3).toBeDefined();
    expect(q3.updates.priority_override).toBeGreaterThanOrEqual(70);
  }, 30_000);

  it('single-task update should NOT return batch_update', async () => {
    const text = "Update the Flagler sale agreement description to say we sent the revisions.";

    const intent = await classifyText(text, existingTasks);

    expect(intent.intent).toBe('update_task');
    expect(intent.task_query.toLowerCase()).toContain('flagler');
  }, 30_000);

  it('disambiguates similar task names using context clues', async () => {
    // Both tasks start with "Flagler" — the AI must use "sale" vs "Insurance"
    // context to route each update to the correct task
    const text = "For the Flagler sale, I need to call Dexter about the closing date. And for Flagler Insurance, the next premium payment is due on the 15th so set the due date to April 15.";

    const intent = await classifyText(text, existingTasks);

    expect(intent.intent).toBe('batch_update');
    expect(intent.updates.length).toBe(2);

    const sale = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('sale')
    );
    expect(sale).toBeDefined();
    expect(sale.updates.description?.toLowerCase()).toMatch(/dexter|closing/);

    const insurance = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('insurance')
    );
    expect(insurance).toBeDefined();
    // Should have a due date for April 15
    const hasDate = insurance.updates.due_date && insurance.updates.due_date.includes('04-15');
    const hasDescription = insurance.updates.description?.toLowerCase().includes('premium') ||
                          insurance.updates.description?.toLowerCase().includes('payment');
    expect(hasDate || hasDescription).toBe(true);
  }, 30_000);

  it('handles rambling speech with mixed operations across 3 tasks', async () => {
    // Natural, disorganized speech pattern — status change, assignee, priority
    const tasks = [
      'Website redesign project',
      'Quarterly investor update',
      'New hire onboarding for DevOps',
    ];
    const text = "So the website redesign, I finally got the mockups approved so let's move that to in progress. The investor update needs to go to Michael, he's handling it now. And the DevOps onboarding, that's becoming really urgent, we need that person started by next month so bump it up in priority.";

    const intent = await classifyText(text, tasks);

    expect(intent.intent).toBe('batch_update');
    expect(intent.updates.length).toBeGreaterThanOrEqual(3);

    // Website redesign: status change to doing/in-progress
    const website = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('website') || u.task_query.toLowerCase().includes('redesign')
    );
    expect(website).toBeDefined();
    const hasStatus = website.updates.status === 'doing';
    const hasProgressDesc = website.updates.description?.toLowerCase().includes('approved') ||
                           website.updates.description?.toLowerCase().includes('progress');
    expect(hasStatus || hasProgressDesc).toBe(true);

    // Investor update: assignee
    const investor = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('investor') || u.task_query.toLowerCase().includes('quarterly')
    );
    expect(investor).toBeDefined();
    expect(investor.updates.assignee).toMatch(/michael/i);

    // DevOps onboarding: priority boost
    const devops = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('devops') || u.task_query.toLowerCase().includes('onboarding')
    );
    expect(devops).toBeDefined();
    const hasPriority = devops.updates.priority_override != null && devops.updates.priority_override >= 70;
    const hasUrgency = devops.updates.urgency != null && devops.updates.urgency >= 7;
    expect(hasPriority || hasUrgency).toBe(true);
  }, 30_000);

  it('extracts long multi-sentence context per task and attributes correctly', async () => {
    // One task gets a detailed multi-sentence update, others are brief
    const tasks = [
      'Meridian partnership deal',
      'Office lease renewal',
      'Annual compliance audit',
    ];
    const text = "On the Meridian partnership, we had a really productive call yesterday. They agreed to the revenue share terms we proposed, but they want us to cover the integration costs upfront. I told them we'd review and get back by Friday. For the office lease, just need to sign — it's ready. And the compliance audit is blocked until we get the financial statements from accounting.";

    const intent = await classifyText(text, tasks);

    expect(intent.intent).toBe('batch_update');
    expect(intent.updates.length).toBe(3);

    // Meridian: rich description capturing the negotiation context
    const meridian = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('meridian')
    );
    expect(meridian).toBeDefined();
    expect(meridian.updates.description).toBeTruthy();
    const desc = meridian.updates.description.toLowerCase();
    // Description should capture key business details, not just "updated"
    expect(desc.length).toBeGreaterThan(30);
    const hasRevenue = desc.includes('revenue');
    const hasIntegration = desc.includes('integration');
    const hasTerms = desc.includes('terms');
    expect(hasRevenue || hasIntegration || hasTerms).toBe(true);

    // Office lease: brief update
    const lease = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('lease') || u.task_query.toLowerCase().includes('office')
    );
    expect(lease).toBeDefined();
    expect(lease.updates.description).toBeTruthy();

    // Compliance: blocked status
    const audit = intent.updates.find((u: { task_query: string }) =>
      u.task_query.toLowerCase().includes('compliance') || u.task_query.toLowerCase().includes('audit')
    );
    expect(audit).toBeDefined();
    expect(audit.updates.description).toBeTruthy();
    expect(audit.updates.description.toLowerCase()).toMatch(/block|financial|accounting/);
  }, 30_000);
});
