import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession, mockNoSession } from '../helpers/db';

// Mock OpenAI to avoid real API calls for priority scoring
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"score": 50, "reason": "Test priority"}' } }],
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
  const user = await createTestUser('tasks-test');
  testUserId = user.userId;
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('GET /api/tasks', () => {
  beforeEach(() => mockSession(testUserId));

  it('returns empty array when no tasks exist', async () => {
    const req = new NextRequest('http://localhost/api/tasks');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    mockNoSession();
    const req = new NextRequest('http://localhost/api/tasks');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/tasks', () => {
  beforeEach(() => mockSession(testUserId));

  it('creates a task with valid data', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Integration test task', monetaryValue: 500, urgency: 7 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe('Integration test task');
    expect(data.id).toBeDefined();
    expect(data.priorityScore).toBeDefined();
    expect(data.priorityReason).toBeDefined();
  });

  it('rejects empty title with 400', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: '' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Title');
  });

  it('rejects missing title with 400', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ monetaryValue: 100 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects negative monetaryValue with 400', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', monetaryValue: -100 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('monetaryValue');
  });

  it('rejects urgency out of range with 400', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', urgency: 15 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('urgency');
  });

  it('returns 401 when not authenticated', async () => {
    mockNoSession();
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates a task with a due date', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Task with due date', dueDate: '2026-04-15' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe('Task with due date');
    expect(data.dueDate).toBeDefined();
  });

  it('rejects invalid due date with 400', async () => {
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', dueDate: 'not-a-date' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('dueDate');
  });
});

describe('PATCH /api/tasks/:id', () => {
  let taskId: number;

  beforeAll(async () => {
    mockSession(testUserId);
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Task to update' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    taskId = data.id;
  });

  beforeEach(() => mockSession(testUserId));

  it('updates a task', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated title', urgency: 9 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(taskId) }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe('Updated title');
  });

  it('updates a task with due date', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dueDate: '2026-05-01' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(taskId) }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.dueDate).toBeDefined();
  });

  it('clears a due date with null', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dueDate: null }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(taskId) }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.dueDate).toBeNull();
  });

  it('rejects invalid due date in PATCH', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dueDate: 'garbage' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(taskId) }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric ID', async () => {
    const req = new NextRequest('http://localhost/api/tasks/abc', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'abc' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent task', async () => {
    const req = new NextRequest('http://localhost/api/tasks/999999', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: '999999' }) });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tasks/:id', () => {
  let taskId: number;

  beforeAll(async () => {
    mockSession(testUserId);
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Task to delete' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const data = await res.json();
    taskId = data.id;
  });

  beforeEach(() => mockSession(testUserId));

  it('deletes a task', async () => {
    const req = new NextRequest(`http://localhost/api/tasks/${taskId}`, { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: String(taskId) }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('returns 400 for non-numeric ID', async () => {
    const req = new NextRequest('http://localhost/api/tasks/xyz', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'xyz' }) });
    expect(res.status).toBe(400);
  });
});
