/**
 * Integration tests for voice-command batch_update intent.
 * Exercises the full POST /api/voice-command pipeline with mocked OpenAI
 * against a real PostgreSQL database.
 *
 * Coverage:
 * - Happy path: 5-task batch matching the user's exact voice command scenario
 * - Sort order: tasks returned sorted by priorityScore DESC after batch
 * - updatedAt timestamps: verify all touched tasks have fresh timestamps
 * - Due date exact value: verify ISO date persisted correctly
 * - Status changes in batch: one task set to 'doing' within a batch
 * - Mixed operations: status + subtasks + priority + description in one batch
 * - Subtask creation with correct parentId, order, sourceType
 * - Blank subtask titles filtered out
 * - Partial matches: found tasks updated, missing tasks reported
 * - All-miss batch: zero matches handled gracefully
 * - Priority override history: entries written to priorityOverrides table
 * - Urgency/strategic_value clamping: out-of-range values clamped to 1-10
 * - Description + assignee + category in single update
 * - Single reprioritization: reprioritizeAllTasks called once, not N times
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession, getTestDb } from '../helpers/db';
import * as schema from '../../src/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

// Shared variable to control which intent the mock returns
let nextIntentResponse = '{"intent":"unknown","raw_text":"fallback"}';

// Track reprioritization calls
let reprioritizeCallCount = 0;

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(({ messages }: { messages: Array<{ role: string; content: string }> }) => {
          const systemMsg = messages[0]?.content ?? '';

          if (systemMsg.includes('voice command router')) {
            return Promise.resolve({
              choices: [{ message: { content: nextIntentResponse } }],
            });
          }

          if (systemMsg.includes('prioritization')) {
            reprioritizeCallCount++;
            const userMsg = messages[messages.length - 1]?.content ?? '';
            try {
              const parsed = JSON.parse(userMsg);
              if (Array.isArray(parsed)) {
                const scores = parsed.map((t: { id: number; manual_priority?: number }, i: number) => ({
                  id: t.id,
                  score: t.manual_priority ?? (90 - i * 10),
                  reason: 'Test priority',
                }));
                return Promise.resolve({
                  choices: [{ message: { content: JSON.stringify(scores) } }],
                });
              }
            } catch { /* not JSON array */ }
          }

          return Promise.resolve({
            choices: [{ message: { content: '{"score": 50, "reason": "Default"}' } }],
          });
        }),
      },
    };
    audio = {
      transcriptions: {
        create: vi.fn().mockResolvedValue('batch update transcription'),
      },
      speech: {
        create: vi.fn().mockResolvedValue({
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        }),
      },
    };
  },
}));

const { POST } = await import('../../src/app/api/voice-command/route');
const { POST: CreateTask, GET: GetTasks } = await import('../../src/app/api/tasks/route');

let testUserId: number;

beforeAll(async () => {
  const user = await createTestUser('voice-batch');
  testUserId = user.userId;
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

function createAudioRequest() {
  const formData = new FormData();
  formData.append('audio', new Blob([new ArrayBuffer(100)], { type: 'audio/webm' }), 'test.webm');
  formData.append('speak', 'false');
  return new NextRequest('http://localhost/api/voice-command', {
    method: 'POST',
    body: formData,
  });
}

async function createTask(title: string): Promise<number> {
  mockSession(testUserId);
  const req = new NextRequest('http://localhost/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title }),
    headers: { 'Content-Type': 'application/json' },
  });
  const res = await CreateTask(req);
  const task = await res.json();
  return task.id;
}

// ─── Happy path: full 5-task voice command scenario ─────────────────────────

describe('Voice command: batch_update — full voice command scenario', () => {
  const taskIds: number[] = [];

  beforeAll(async () => {
    mockSession(testUserId);
    taskIds.push(await createTask('Flagler sale agreement'));
    taskIds.push(await createTask("Art's WHO contract"));
    taskIds.push(await createTask('Tricentis webinar promotion'));
    taskIds.push(await createTask('Flagler Insurance payment'));
    taskIds.push(await createTask("Tony Robbins' contract with Natalia"));
  });

  beforeEach(() => {
    mockSession(testUserId);
    reprioritizeCallCount = 0;
  });

  it('batch updates all 5 tasks and verifies DB state for each', async () => {
    const beforeTime = new Date();

    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'Flagler sale',
          updates: {
            description: 'Emailed Dexter revisions to the agreement. Waiting for his updates.',
          },
        },
        {
          task_query: "Art's WHO contract",
          updates: {
            priority_override: 95,
            priority_reason: 'Waiting on my signature to move forward — I am a blocker',
            description: 'Needs my signature to move forward. I am the blocker.',
          },
        },
        {
          task_query: 'Tricentis webinar',
          updates: {
            priority_override: 85,
            priority_reason: 'Has a due date April 16, needs promoting',
            due_date: '2026-04-16',
            description: 'Need to start promoting. Due date is April 16.',
          },
        },
        {
          task_query: 'Flagler Insurance',
          updates: {
            description: 'Waiting on next payment to make sure latest insurance was applied.',
          },
        },
        {
          task_query: "Tony Robbins' contract",
          updates: {
            description: 'Sent an email. Waiting to get back from Natalia.',
          },
        },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Response shape
    expect(data.intent).toBe('batch_update');
    expect(data.action).toBe('batch_updated');
    expect(data.tasksUpdated).toBeDefined();
    expect(data.tasksUpdated.length).toBe(5);
    expect(data.spokenResponse).toContain('Updated 5 tasks');

    // Verify each task in DB
    const db = getTestDb();

    // Flagler sale — description
    const [flaglerSale] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIds[0]));
    expect(flaglerSale.description).toContain('Dexter');
    expect(flaglerSale.description).toContain('revisions');

    // Art's WHO — priority override + description
    const [artWho] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIds[1]));
    expect(artWho.manualPriorityScore).toBe(95);
    expect(artWho.manualPriorityReason).toContain('signature');
    expect(artWho.description).toContain('blocker');

    // Tricentis — priority + due date (exact value) + description
    const [tricentis] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIds[2]));
    expect(tricentis.manualPriorityScore).toBe(85);
    expect(tricentis.dueDate).toBeTruthy();
    const dueDateStr = new Date(tricentis.dueDate!).toISOString().split('T')[0];
    expect(dueDateStr).toBe('2026-04-16');
    expect(tricentis.description).toContain('promoting');

    // Flagler Insurance — description
    const [flaglerIns] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIds[3]));
    expect(flaglerIns.description).toContain('insurance');

    // Tony Robbins — description
    const [tonyRobbins] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIds[4]));
    expect(tonyRobbins.description).toContain('Natalia');

    // updatedAt timestamps: all 5 tasks should have updatedAt >= beforeTime
    for (const id of taskIds) {
      const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
      expect(new Date(t.updatedAt).getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    }
  });

  it('returns tasks list sorted by priorityScore DESC from GET /api/tasks', async () => {
    mockSession(testUserId);
    const req = new NextRequest('http://localhost/api/tasks', { method: 'GET' });
    const res = await GetTasks(req);
    expect(res.status).toBe(200);
    const allTasks = await res.json();

    // Verify descending sort
    for (let i = 1; i < allTasks.length; i++) {
      expect(allTasks[i - 1].priorityScore).toBeGreaterThanOrEqual(allTasks[i].priorityScore);
    }
  });

  it('calls reprioritizeAllTasks exactly once for a batch of 3 updates', async () => {
    reprioritizeCallCount = 0;

    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        { task_query: 'Flagler sale', updates: { urgency: 5 } },
        { task_query: "Art's WHO contract", updates: { urgency: 9 } },
        { task_query: 'Tricentis webinar', updates: { urgency: 8 } },
      ],
    });

    const req = createAudioRequest();
    await POST(req);

    expect(reprioritizeCallCount).toBe(1);
  });
});

// ─── Status changes within a batch ──────────────────────────────────────────

describe('Voice command: batch_update — status changes', () => {
  let taskIdA: number;
  let taskIdB: number;

  beforeAll(async () => {
    mockSession(testUserId);
    taskIdA = await createTask('Contract negotiation alpha');
    taskIdB = await createTask('Contract negotiation beta');
  });

  beforeEach(() => mockSession(testUserId));

  it('changes task status to doing within a batch', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'negotiation alpha',
          updates: { status: 'doing', description: 'Started working on it' },
        },
        {
          task_query: 'negotiation beta',
          updates: { description: 'Waiting on counterparty' },
        },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasksUpdated.length).toBe(2);

    const db = getTestDb();
    const [taskA] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIdA));
    expect(taskA.status).toBe('doing');
    expect(taskA.description).toContain('Started');

    const [taskB] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIdB));
    expect(taskB.status).toBe('todo'); // unchanged
    expect(taskB.description).toContain('counterparty');
  });
});

// ─── Mixed operations in single batch ───────────────────────────────────────

describe('Voice command: batch_update — mixed operations', () => {
  let taskIdX: number;
  let taskIdY: number;
  let taskIdZ: number;

  beforeAll(async () => {
    mockSession(testUserId);
    taskIdX = await createTask('Mixed ops task Xavier');
    taskIdY = await createTask('Mixed ops task Yankee');
    taskIdZ = await createTask('Mixed ops task Zulu');
  });

  beforeEach(() => mockSession(testUserId));

  it('applies status + subtasks + priority + description across different tasks in one batch', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'Xavier',
          updates: { status: 'doing', description: 'In progress now' },
        },
        {
          task_query: 'Yankee',
          updates: { priority_override: 92, priority_reason: 'CEO blocked' },
          subtasks: [
            { title: 'Get CEO approval' },
            { title: 'File paperwork' },
          ],
        },
        {
          task_query: 'Zulu',
          updates: {
            due_date: '2026-05-01',
            urgency: 9,
            strategic_value: 8,
            description: 'Critical deadline approaching',
          },
        },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasksUpdated.length).toBe(3);

    const db = getTestDb();

    // Xavier: status change
    const [x] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIdX));
    expect(x.status).toBe('doing');

    // Yankee: priority + subtasks
    const [y] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIdY));
    expect(y.manualPriorityScore).toBe(92);
    const ySubs = await db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.parentId, taskIdY), eq(schema.tasks.userId, testUserId)));
    expect(ySubs.length).toBe(2);
    expect(ySubs.map(s => s.title)).toContain('Get CEO approval');
    expect(ySubs.map(s => s.title)).toContain('File paperwork');

    // Zulu: due date + urgency + strategic value
    const [z] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskIdZ));
    expect(new Date(z.dueDate!).toISOString().split('T')[0]).toBe('2026-05-01');
    expect(z.urgency).toBe(9);
    expect(z.strategicValue).toBe(8);
    expect(z.description).toContain('deadline');
  });
});

// ─── Subtask creation ───────────────────────────────────────────────────────

describe('Voice command: batch_update — subtask creation', () => {
  let parentTaskId: number;

  beforeAll(async () => {
    mockSession(testUserId);
    parentTaskId = await createTask('Subtask parent zeppelin');
  });

  beforeEach(() => mockSession(testUserId));

  it('creates subtasks with correct parentId, order, sourceType, and description', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'zeppelin',
          updates: { description: 'Emailed revisions, waiting for response.' },
          subtasks: [
            { title: "Wait for Dexter's updates", description: 'Sent revisions to agreement' },
            { title: 'Review updated agreement' },
          ],
        },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe('batch_updated');

    const db = getTestDb();
    const subtasks = await db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.parentId, parentTaskId), eq(schema.tasks.userId, testUserId)));

    expect(subtasks.length).toBe(2);
    expect(subtasks[0].title).toBe("Wait for Dexter's updates");
    expect(subtasks[0].description).toContain('revisions');
    expect(subtasks[0].subtaskOrder).toBe(0);
    expect(subtasks[0].sourceType).toBe('voice_context');
    expect(subtasks[0].parentId).toBe(parentTaskId);
    expect(subtasks[1].title).toBe('Review updated agreement');
    expect(subtasks[1].subtaskOrder).toBe(1);
  });

  it('filters out subtasks with blank titles', async () => {
    const blankParent = await createTask('Blank subtask parent quokka');

    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'quokka',
          updates: { description: 'Testing blank subtask filtering' },
          subtasks: [
            { title: 'Valid subtask' },
            { title: '' },
            { title: '   ' },
            { title: 'Another valid one' },
          ],
        },
      ],
    });

    const req = createAudioRequest();
    await POST(req);

    const db = getTestDb();
    const subtasks = await db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.parentId, blankParent), eq(schema.tasks.userId, testUserId)));

    // Only the 2 valid subtasks should be created
    expect(subtasks.length).toBe(2);
    expect(subtasks[0].title).toBe('Valid subtask');
    expect(subtasks[1].title).toBe('Another valid one');
  });
});

// ─── Partial matches ────────────────────────────────────────────────────────

describe('Voice command: batch_update — partial matches', () => {
  beforeAll(async () => {
    mockSession(testUserId);
    await createTask('Real verifiable xylophone');
  });

  beforeEach(() => mockSession(testUserId));

  it('updates found tasks and reports not-found ones in spokenResponse', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'verifiable xylophone',
          updates: { description: 'Updated successfully' },
        },
        {
          task_query: 'zxyqwv phantom zzz',
          updates: { description: 'Should not be applied' },
        },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.action).toBe('batch_updated');
    expect(data.tasksUpdated.length).toBe(1);
    expect(data.spokenResponse).toContain('Updated 1 task');
    expect(data.spokenResponse).toContain('Could not find');
    expect(data.spokenResponse).toContain('zxyqwv');
  });
});

// ─── All-miss batch ─────────────────────────────────────────────────────────

describe('Voice command: batch_update — zero matches', () => {
  beforeEach(() => mockSession(testUserId));

  it('handles batch with no matching tasks gracefully', async () => {
    reprioritizeCallCount = 0;

    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        { task_query: 'zxyqwv aabbcc zzz', updates: { description: 'nope' } },
        { task_query: 'mmnnpp qqrrss zzz', updates: { description: 'nope' } },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.action).toBe('batch_updated');
    expect(data.tasksUpdated.length).toBe(0);
    expect(data.spokenResponse).toContain('Updated 0 tasks');
    expect(data.spokenResponse).toContain('Could not find');

    // Should NOT call reprioritize when nothing was updated
    expect(reprioritizeCallCount).toBe(0);
  });
});

// ─── Priority override history ──────────────────────────────────────────────

describe('Voice command: batch_update — priority override history', () => {
  let taskId1: number;
  let taskId2: number;

  beforeAll(async () => {
    mockSession(testUserId);
    taskId1 = await createTask('Override history alpha');
    taskId2 = await createTask('Override history bravo');
  });

  beforeEach(() => mockSession(testUserId));

  it('records priority overrides in priorityOverrides table for each task', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'history alpha',
          updates: { priority_override: 95, priority_reason: 'Top priority - blocker' },
        },
        {
          task_query: 'history bravo',
          updates: { priority_override: 80, priority_reason: 'Has deadline' },
        },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);

    const db = getTestDb();

    const overrides1 = await db.select().from(schema.priorityOverrides)
      .where(eq(schema.priorityOverrides.taskId, taskId1));
    expect(overrides1.length).toBeGreaterThanOrEqual(1);
    const latest1 = overrides1[overrides1.length - 1];
    expect(latest1.newScore).toBe(95);
    expect(latest1.reason).toBe('Top priority - blocker');
    expect(latest1.source).toBe('voice');

    const overrides2 = await db.select().from(schema.priorityOverrides)
      .where(eq(schema.priorityOverrides.taskId, taskId2));
    expect(overrides2.length).toBeGreaterThanOrEqual(1);
    const latest2 = overrides2[overrides2.length - 1];
    expect(latest2.newScore).toBe(80);
    expect(latest2.reason).toBe('Has deadline');
    expect(latest2.source).toBe('voice');
  });
});

// ─── Field clamping and multi-field updates ─────────────────────────────────

describe('Voice command: batch_update — field clamping & multi-field', () => {
  let taskId: number;

  beforeAll(async () => {
    mockSession(testUserId);
    taskId = await createTask('Clamping edge case narwhal');
  });

  beforeEach(() => mockSession(testUserId));

  it('clamps urgency and strategic_value to 1-10 range', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'narwhal',
          updates: { urgency: 15, strategic_value: -3 },
        },
      ],
    });

    const req = createAudioRequest();
    await POST(req);

    const db = getTestDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    expect(task.urgency).toBe(10); // clamped from 15
    expect(task.strategicValue).toBe(1); // clamped from -3
  });

  it('sets description, assignee, and category in a single update', async () => {
    const multiFieldId = await createTask('Multi field platypus');

    nextIntentResponse = JSON.stringify({
      intent: 'batch_update',
      updates: [
        {
          task_query: 'platypus',
          updates: {
            description: 'Assigned and categorized',
            assignee: 'Sarah',
            category: 'Legal',
          },
        },
      ],
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasksUpdated.length).toBe(1);

    const db = getTestDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, multiFieldId));
    expect(task.description).toBe('Assigned and categorized');
    expect(task.assignee).toBe('Sarah');
    expect(task.category).toBe('Legal');
  });
});
