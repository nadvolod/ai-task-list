import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession, mockNoSession } from '../helpers/db';

// Mock OpenAI
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(({ messages }) => {
          const systemMsg = messages[0]?.content ?? '';
          if (systemMsg.includes('executive briefing')) {
            return Promise.resolve({
              choices: [{ message: { content: 'Focus on your highest-priority items today.' } }],
            });
          }
          // Priority scoring
          return Promise.resolve({
            choices: [{ message: { content: '{"score": 60, "reason": "Test priority"}' } }],
          });
        }),
      },
    };
  },
}));

const { GET } = await import('../../src/app/api/focus/route');
const { POST: CreateTask } = await import('../../src/app/api/tasks/route');

let testUserId: number;

beforeAll(async () => {
  const user = await createTestUser('focus-test');
  testUserId = user.userId;
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('GET /api/focus', () => {
  beforeEach(() => mockSession(testUserId));

  it('returns 401 when not authenticated', async () => {
    mockNoSession();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns empty summary when no tasks', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks).toBeDefined();
    expect(data.summary).toBeDefined();
  });

  it('returns focus tasks and summary when tasks exist', async () => {
    // Create some tasks
    for (const title of ['Focus task 1', 'Focus task 2', 'Focus task 3']) {
      const req = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title }),
        headers: { 'Content-Type': 'application/json' },
      });
      await CreateTask(req);
    }

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks.length).toBeLessThanOrEqual(3);
    expect(data.summary).toBeDefined();
    expect(typeof data.summary).toBe('string');
    expect(data.summary.length).toBeGreaterThan(0);
  });

  it('returns at most 3 focus tasks even with many tasks', async () => {
    // Create more tasks
    for (const title of ['Extra task A', 'Extra task B', 'Extra task C', 'Extra task D']) {
      const req = new NextRequest('http://localhost/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title }),
        headers: { 'Content-Type': 'application/json' },
      });
      await CreateTask(req);
    }

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks.length).toBeLessThanOrEqual(3);
  });

  it('includes summary string in response', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeDefined();
    expect(typeof data.summary).toBe('string');
  });
});
