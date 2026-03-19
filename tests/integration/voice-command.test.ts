import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession, mockNoSession, getTestDb } from '../helpers/db';
import * as schema from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';

// NO OpenAI mock — these tests use real API calls
// Import route and AI function directly (no mocks)
const { POST } = await import('../../src/app/api/voice-command/route');
const { parseVoiceCommand } = await import('../../src/lib/ai');

let testUserId: number;
let testTaskIds: number[] = [];

beforeAll(async () => {
  const user = await createTestUser('voice-cmd-test');
  testUserId = user.userId;

  // Create some test tasks for the voice command to reference
  const db = getTestDb();
  const [task1] = await db.insert(schema.tasks).values({
    userId: testUserId,
    title: 'Buy groceries from the store',
    sourceType: 'manual',
    priorityScore: 25,
    urgency: 3,
  }).returning();

  const [task2] = await db.insert(schema.tasks).values({
    userId: testUserId,
    title: 'Send invoice to client for $5000',
    sourceType: 'manual',
    priorityScore: 70,
    monetaryValue: 5000,
    urgency: 8,
  }).returning();

  const [task3] = await db.insert(schema.tasks).values({
    userId: testUserId,
    title: 'Schedule dentist appointment',
    sourceType: 'manual',
    priorityScore: 15,
    urgency: 2,
  }).returning();

  testTaskIds = [task1.id, task2.id, task3.id];
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('POST /api/voice-command', () => {
  beforeEach(() => mockSession(testUserId));

  it('returns 401 when not authenticated', async () => {
    mockNoSession();
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
    formData.append('audio', blob, 'test.webm');

    const req = new NextRequest('http://localhost/api/voice-command', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when no audio file is provided', async () => {
    const req = new NextRequest('http://localhost/api/voice-command', {
      method: 'POST',
      body: new FormData(),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('No audio');
  });

  it('returns 400 when audio file exceeds 10MB', async () => {
    const largeBlob = new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', largeBlob, 'large.webm');

    const req = new NextRequest('http://localhost/api/voice-command', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('too large');
  });
});

// Test parseVoiceCommand with real OpenAI (text parsing, no audio)
describe('parseVoiceCommand with real OpenAI', () => {
  const testTasks = [
    { id: 999001, title: 'Buy groceries from the store', status: 'todo', priorityScore: 25, monetaryValue: null, revenuePotential: null, urgency: 3, strategicValue: null },
    { id: 999002, title: 'Send invoice to client for $5000', status: 'todo', priorityScore: 70, monetaryValue: 5000, revenuePotential: null, urgency: 8, strategicValue: null },
    { id: 999003, title: 'Schedule dentist appointment', status: 'done', priorityScore: 15, monetaryValue: null, revenuePotential: null, urgency: 2, strategicValue: null },
  ];

  it('correctly parses an add task command', async () => {
    const result = await parseVoiceCommand(
      'Add a new task to call the plumber about the leaky faucet, it is urgent',
      testTasks
    );

    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    const addAction = result.actions.find(a => a.type === 'add_task');
    expect(addAction).toBeDefined();
    expect(addAction!.fields?.title).toBeTruthy();
    expect(addAction!.confidence).toBeGreaterThan(0.5);
  }, 30000);

  it('correctly parses a mark done command matching an existing task', async () => {
    const result = await parseVoiceCommand(
      'Mark the groceries task as done',
      testTasks
    );

    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    const doneAction = result.actions.find(a => a.type === 'mark_done');
    expect(doneAction).toBeDefined();
    expect(doneAction!.taskId).toBe(999001);
    expect(doneAction!.confidence).toBeGreaterThan(0.5);
  }, 30000);

  it('correctly parses a query command', async () => {
    const result = await parseVoiceCommand(
      "What is my highest priority task right now?",
      testTasks
    );

    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    const queryAction = result.actions.find(a => a.type === 'query');
    expect(queryAction).toBeDefined();
    expect(queryAction!.queryResponse).toBeTruthy();
    // Should mention the invoice task since it has highest priority
    expect(queryAction!.queryResponse!.toLowerCase()).toContain('invoice');
  }, 30000);

  it('correctly parses a reprioritize command with monetary value', async () => {
    const result = await parseVoiceCommand(
      'The invoice task is actually worth ten thousand dollars, make it higher priority',
      testTasks
    );

    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    const action = result.actions.find(a => a.type === 'reprioritize' || a.type === 'update_task');
    expect(action).toBeDefined();
    expect(action!.taskId).toBe(999002);
  }, 30000);

  it('handles multi-action commands', async () => {
    const result = await parseVoiceCommand(
      'Add a task to water the plants and mark the dentist appointment as not done',
      testTasks
    );

    expect(result.actions.length).toBeGreaterThanOrEqual(2);
    const addAction = result.actions.find(a => a.type === 'add_task');
    const undoneAction = result.actions.find(a => a.type === 'mark_undone');
    expect(addAction).toBeDefined();
    expect(undoneAction).toBeDefined();
    expect(undoneAction!.taskId).toBe(999003);
  }, 30000);
});
