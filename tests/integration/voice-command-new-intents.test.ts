/**
 * Tests for voice-command route handling new intent fields:
 * - assignee updates
 * - priority override with reason tracking
 * - recurrence rule updates
 * Uses mocked OpenAI to control exact intent classification.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession, getTestDb } from '../helpers/db';
import * as schema from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';

// Shared variable to control which intent the mock returns
let nextIntentResponse = '{"intent":"create_tasks","tasks":[{"title":"Fallback task"}]}';

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(({ messages }: { messages: Array<{ role: string; content: string }> }) => {
          const systemMsg = messages[0]?.content ?? '';

          // Intent classification — return whatever nextIntentResponse is set to
          if (systemMsg.includes('voice command router')) {
            return Promise.resolve({
              choices: [{ message: { content: nextIntentResponse } }],
            });
          }

          // Batch reprioritization
          if (systemMsg.includes('prioritization')) {
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
        create: vi.fn().mockResolvedValue('test transcription'),
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
const { POST: CreateTask } = await import('../../src/app/api/tasks/route');

let testUserId: number;

beforeAll(async () => {
  const user = await createTestUser('voice-new-intents');
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

describe('Voice command: assign task to person', () => {
  let taskId: number;

  beforeAll(async () => {
    mockSession(testUserId);
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Budget review report' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await CreateTask(req);
    const task = await res.json();
    taskId = task.id;
  });

  beforeEach(() => mockSession(testUserId));

  it('assigns a person to a task via voice', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'update_task',
      task_query: 'budget review',
      updates: { assignee: 'Sarah' },
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.intent).toBe('update_task');
    expect(data.action).toBe('updated');
    expect(data.spokenResponse).toContain('Sarah');
    expect(data.taskUpdated).toBeDefined();
    expect(data.taskUpdated.assignee).toBe('Sarah');
  });

  it('persists assignee in database', async () => {
    const db = getTestDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    expect(task.assignee).toBe('Sarah');
  });
});

describe('Voice command: manual priority override', () => {
  let taskId: number;

  beforeAll(async () => {
    mockSession(testUserId);
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Nexus tutorial release' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await CreateTask(req);
    const task = await res.json();
    taskId = task.id;
  });

  beforeEach(() => mockSession(testUserId));

  it('sets manual priority override via voice', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'update_task',
      task_query: 'nexus tutorial',
      updates: { priority_override: 95, priority_reason: 'VP requested urgently' },
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.intent).toBe('update_task');
    expect(data.action).toBe('updated');
    expect(data.spokenResponse).toContain('priority');
    expect(data.taskUpdated).toBeDefined();
    expect(data.taskUpdated.manualPriorityScore).toBe(95);
    expect(data.taskUpdated.manualPriorityReason).toBe('VP requested urgently');
  });

  it('records priority override in history table', async () => {
    const db = getTestDb();
    const overrides = await db.select().from(schema.priorityOverrides)
      .where(eq(schema.priorityOverrides.taskId, taskId));
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    const latest = overrides[overrides.length - 1];
    expect(latest.newScore).toBe(95);
    expect(latest.reason).toBe('VP requested urgently');
    expect(latest.source).toBe('voice');
  });
});

describe('Voice command: set recurrence rule', () => {
  beforeAll(async () => {
    mockSession(testUserId);
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Team standup meeting' }),
      headers: { 'Content-Type': 'application/json' },
    });
    await CreateTask(req);
  });

  beforeEach(() => mockSession(testUserId));

  it('sets recurrence on a task via voice', async () => {
    nextIntentResponse = JSON.stringify({
      intent: 'update_task',
      task_query: 'standup',
      updates: { recurrence_rule: 'weekly', recurrence_days: '1' },
    });

    const req = createAudioRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.intent).toBe('update_task');
    expect(data.action).toBe('updated');
    expect(data.spokenResponse).toContain('recurring');
    expect(data.taskUpdated).toBeDefined();
    expect(data.taskUpdated.recurrenceRule).toBe('weekly');
    expect(data.taskUpdated.recurrenceDays).toBe('1');
  });
});
