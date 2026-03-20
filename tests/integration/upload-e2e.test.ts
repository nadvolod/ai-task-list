/**
 * End-to-end tests for the upload flow.
 * Hits real Gemini API for image extraction and real OpenAI API for priority scoring.
 * No AI mocks — only auth is mocked (as required by the test harness).
 * Requires GOOGLE_API_KEY and OPENAI_API_KEY in .env.local.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession, mockNoSession, getTestDb } from '../helpers/db';
import { tasks, uploads } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

const { POST } = await import('../../src/app/api/upload/route');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'test-tasks.png');

let testUserId: number;

beforeAll(async () => {
  const user = await createTestUser('upload-e2e');
  testUserId = user.userId;
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('POST /api/upload (e2e — real AI APIs)', () => {
  beforeEach(() => mockSession(testUserId));

  it('extracts tasks from image and creates them in the database with AI priority scores', async () => {
    const imageBuffer = fs.readFileSync(FIXTURE_PATH);
    const file = new File([imageBuffer], 'todo-list.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);

    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();

    // Verify response structure
    expect(data.uploadId).toBeDefined();
    expect(data.tasks).toBeDefined();
    expect(Array.isArray(data.tasks)).toBe(true);

    // Should extract multiple tasks from the test image (has 5 items)
    expect(data.tasks.length).toBeGreaterThanOrEqual(3);

    // Verify each task has real AI-generated priority scores
    for (const task of data.tasks) {
      expect(task.id).toBeDefined();
      expect(task.userId).toBe(testUserId);
      expect(task.title).toBeTruthy();
      expect(task.sourceType).toBe('image_upload');
      expect(task.confidence).toBeGreaterThanOrEqual(0.5);
      expect(task.confidence).toBeLessThanOrEqual(1.0);
      // Priority score should be a real number from GPT-4o-mini, not a hardcoded mock
      expect(typeof task.priorityScore).toBe('number');
      expect(task.priorityScore).toBeGreaterThanOrEqual(0);
      expect(task.priorityScore).toBeLessThanOrEqual(100);
      expect(task.priorityReason).toBeTruthy();
    }

    // Verify data persisted to database
    const db = getTestDb();
    const dbTasks = await db.select().from(tasks).where(eq(tasks.userId, testUserId));
    expect(dbTasks.length).toBe(data.tasks.length);

    const [upload] = await db.select().from(uploads).where(eq(uploads.userId, testUserId));
    expect(upload).toBeDefined();
    expect(upload.extractedText).toBeTruthy();
    expect(upload.extractedText!.length).toBeGreaterThan(0);
  }, 60_000);

  it('returns 401 when not authenticated', async () => {
    mockNoSession();
    const imageBuffer = fs.readFileSync(FIXTURE_PATH);
    const file = new File([imageBuffer], 'todo-list.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', file);

    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
