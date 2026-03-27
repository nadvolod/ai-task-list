/**
 * Real OpenAI API tests for batch_update intent classification.
 * Validates that GPT-4o-mini correctly classifies multi-task voice
 * commands into batch_update with the right per-task updates.
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
    // The AI may extract Michael as assignee or mention him in description
    const hasAssignee = investor.updates.assignee && /michael/i.test(investor.updates.assignee);
    const hasMichaelInDesc = investor.updates.description && /michael/i.test(investor.updates.description);
    expect(hasAssignee || hasMichaelInDesc).toBe(true);

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
