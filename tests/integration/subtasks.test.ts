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
const { GET, POST } = await import('../../src/app/api/tasks/route');
const { PATCH, DELETE } = await import('../../src/app/api/tasks/[id]/route');

let testUserId: number;

beforeAll(async () => {
  const { userId } = await createTestUser('subtask');
  testUserId = userId;
  mockSession(userId);
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('Subtasks', () => {
  let parentTaskId: number;

  it('creates a parent task', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Parent Task' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe('Parent Task');
    expect(data.parentId).toBeNull();
    parentTaskId = data.id;
  });

  it('creates a subtask under the parent', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Subtask 1', parentId: parentTaskId }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe('Subtask 1');
    expect(data.parentId).toBe(parentTaskId);
    expect(data.subtaskOrder).toBe(0);
  });

  it('creates a second subtask with correct order', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Subtask 2', parentId: parentTaskId }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.subtaskOrder).toBe(1);
  });

  it('rejects nesting more than one level deep', async () => {
    const listReq = new NextRequest('http://localhost/api/tasks', { method: 'GET' });
    const listRes = await GET(listReq);
    const allTasks = await listRes.json();
    const subtask = allTasks.find((t: { parentId: number | null }) => t.parentId === parentTaskId);

    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Nested Subtask', parentId: subtask.id }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('one level');
  });

  it('rejects invalid parentId', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Orphan', parentId: 999999 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns flat list with parentId field', async () => {
    const req = new NextRequest('http://localhost/api/tasks', { method: 'GET' });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    const parent = data.find((t: { id: number }) => t.id === parentTaskId);
    expect(parent.parentId).toBeNull();
    const children = data.filter((t: { parentId: number | null }) => t.parentId === parentTaskId);
    expect(children.length).toBe(2);
  });

  it('completing parent cascades to subtasks', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${parentTaskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(parentTaskId) }) });
    expect(res.status).toBe(200);

    const listReq = new NextRequest('http://localhost/api/tasks', { method: 'GET' });
    const listRes = await GET(listReq);
    const allTasks = await listRes.json();
    const children = allTasks.filter((t: { parentId: number | null }) => t.parentId === parentTaskId);
    expect(children.every((c: { status: string }) => c.status === 'done')).toBe(true);
  });

  it('deleting parent cascades to subtasks', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${parentTaskId}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: String(parentTaskId) }) });
    expect(res.status).toBe(200);

    const listReq = new NextRequest('http://localhost/api/tasks', { method: 'GET' });
    const listRes = await GET(listReq);
    const allTasks = await listRes.json();
    const children = allTasks.filter((t: { parentId: number | null }) => t.parentId === parentTaskId);
    expect(children.length).toBe(0);
  });
});
