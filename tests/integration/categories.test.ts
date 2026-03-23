import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession } from '../helpers/db';

// Mock OpenAI for priority scoring
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(({ messages }: { messages: Array<{ role: string; content: string }> }) => {
          const userMsg = messages[messages.length - 1]?.content ?? '';
          try {
            const parsed = JSON.parse(userMsg);
            if (Array.isArray(parsed)) {
              const scores = parsed.map((t: { id: number }, i: number) => ({
                id: t.id,
                score: 90 - i * 10,
                reason: 'Test priority',
              }));
              return Promise.resolve({ choices: [{ message: { content: JSON.stringify(scores) } }] });
            }
          } catch { /* not JSON array */ }
          return Promise.resolve({ choices: [{ message: { content: '{"score": 50, "reason": "Default"}' } }] });
        }),
      },
    };
  },
}));

const { GET, POST, DELETE } = await import('../../src/app/api/categories/route');
const { POST: CreateTask } = await import('../../src/app/api/tasks/route');

let testUserId: number;

beforeAll(async () => {
  const { userId } = await createTestUser('categories');
  testUserId = userId;
  mockSession(userId);
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('POST /api/categories', () => {
  it('creates a category boost', async () => {
    const req = new NextRequest('http://localhost/api/categories', {
      method: 'POST',
      body: JSON.stringify({ category: 'Temporal', boost: 15 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.category).toBe('Temporal');
    expect(data.boost).toBe(15);
  });

  it('upserts when same category posted again', async () => {
    const req = new NextRequest('http://localhost/api/categories', {
      method: 'POST',
      body: JSON.stringify({ category: 'Temporal', boost: 20 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.boost).toBe(20);
  });

  it('trims category name', async () => {
    const req = new NextRequest('http://localhost/api/categories', {
      method: 'POST',
      body: JSON.stringify({ category: '  Marketing  ', boost: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.category).toBe('Marketing');
  });

  it('rejects empty category', async () => {
    const req = new NextRequest('http://localhost/api/categories', {
      method: 'POST',
      body: JSON.stringify({ category: '  ', boost: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('clamps boost to [-50, 50]', async () => {
    const req = new NextRequest('http://localhost/api/categories', {
      method: 'POST',
      body: JSON.stringify({ category: 'Clamped', boost: 100 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.boost).toBe(50);
  });
});

describe('GET /api/categories', () => {
  it('returns all category boosts for the user', async () => {
    const req = new NextRequest('http://localhost/api/categories', { method: 'GET' });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data.find((b: { category: string }) => b.category === 'Temporal')).toBeDefined();
  });
});

describe('DELETE /api/categories', () => {
  it('deletes a category boost', async () => {
    const req = new NextRequest('http://localhost/api/categories?category=Marketing', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(200);

    // Verify it's gone
    const getRes = await GET();
    const data = await getRes.json();
    expect(data.find((b: { category: string }) => b.category === 'Marketing')).toBeUndefined();
  });

  it('trims category param on delete', async () => {
    // Create one
    const createReq = new NextRequest('http://localhost/api/categories', {
      method: 'POST',
      body: JSON.stringify({ category: 'ToDelete', boost: 5 }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(createReq);

    // Delete with whitespace
    const req = new NextRequest('http://localhost/api/categories?category=%20ToDelete%20', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });
});

describe('Category boost affects task priority', () => {
  it('task with boosted category gets higher score', async () => {
    // Ensure Temporal has a boost
    const boostReq = new NextRequest('http://localhost/api/categories', {
      method: 'POST',
      body: JSON.stringify({ category: 'Temporal', boost: 20 }),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(boostReq);

    // Create two tasks with same properties but different categories
    const task1Req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Regular task', monetaryValue: 1000 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const task1Res = await CreateTask(task1Req);
    const task1 = await task1Res.json();

    const task2Req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Temporal task', monetaryValue: 1000, category: 'Temporal' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const task2Res = await CreateTask(task2Req);
    const task2 = await task2Res.json();

    // Temporal task should have a higher priority score
    expect(task2.priorityScore).toBeGreaterThan(task1.priorityScore);
  });
});
