import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession } from '../helpers/db';

// Mock OpenAI to avoid real API calls for priority scoring
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(async (opts: { messages: Array<{ role: string; content: string }> }) => {
          const userMsg = opts.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
          try {
            const parsed = JSON.parse(userMsg);
            if (Array.isArray(parsed)) {
              const scores = parsed.map((t: { id: number }, i: number) => ({
                id: t.id,
                score: 90 - i * 10,
                reason: 'Test priority',
              }));
              return { choices: [{ message: { content: JSON.stringify(scores) } }] };
            }
          } catch { /* not JSON array */ }
          return { choices: [{ message: { content: '{"score": 50, "reason": "Test priority"}' } }] };
        }),
      },
    };
  },
}));

// Import route handlers after mocks are set up
const { POST } = await import('../../src/app/api/tasks/route');
const { PATCH } = await import('../../src/app/api/tasks/[id]/route');

let testUserId: number;

beforeAll(async () => {
  const { userId } = await createTestUser('recurring');
  testUserId = userId;
  mockSession(userId);
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('Recurring Tasks', () => {
  let recurringTaskId: number;

  it('creates a recurring task with weekly rule', async () => {
    const nextMonday = new Date();
    nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));

    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Weekly Standup',
        recurrenceRule: 'weekly',
        recurrenceDays: '1',
        dueDate: nextMonday.toISOString(),
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.recurrenceRule).toBe('weekly');
    expect(data.recurrenceDays).toBe('1');
    recurringTaskId = data.id;
  });

  it('completing a recurring task spawns next instance', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${recurringTaskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(recurringTaskId) }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.nextInstance).toBeDefined();
    expect(data.nextInstance.title).toBe('Weekly Standup');
    expect(data.nextInstance.recurrenceRule).toBe('weekly');
    expect(data.nextInstance.recurrenceParentId).toBe(recurringTaskId);
    expect(data.nextInstance.status).toBe('todo');
    expect(data.nextInstance.dueDate).toBeTruthy();
  });

  it('creates a task with assignee field', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Delegated Task', assignee: 'Sarah' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.assignee).toBe('Sarah');
  });

  it('updates assignee via PATCH', async () => {
    const createReq = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Reassign Me' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const createRes = await POST(createReq);
    const task = await createRes.json();

    const req = new NextRequest(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ assignee: 'John' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(task.id) }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assignee).toBe('John');
  });

  it('sets manual priority override', async () => {
    const createReq = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Priority Override Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const createRes = await POST(createReq);
    const task = await createRes.json();

    const req = new NextRequest(`http://localhost/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        manualPriorityScore: 95,
        manualPriorityReason: 'CEO requested urgently',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(task.id) }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.manualPriorityScore).toBe(95);
    expect(data.manualPriorityReason).toBe('CEO requested urgently');
    // The actual priorityScore should reflect the manual override
    expect(data.priorityScore).toBe(95);
  });
});
