import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestUser, cleanupTestUser, mockSession, mockNoSession } from '../helpers/db';

// Mock Google Generative AI for image extraction
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: vi.fn().mockResolvedValue({
          response: {
            text: () => JSON.stringify({
              raw_text: 'Buy groceries\nCall dentist',
              tasks: [
                { title: 'Buy groceries', confidence: 0.95 },
                { title: 'Call dentist', confidence: 0.88 },
              ],
            }),
          },
        }),
      };
    }
  },
}));

// Mock OpenAI for priority scoring (still uses GPT-4o-mini)
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({ score: 30, reason: 'Test priority' }),
            },
          }],
        }),
      },
    };
  },
}));

const { POST } = await import('../../src/app/api/upload/route');

let testUserId: number;

beforeAll(async () => {
  const user = await createTestUser('upload-test');
  testUserId = user.userId;
});

afterAll(async () => {
  await cleanupTestUser(testUserId);
});

describe('POST /api/upload', () => {
  beforeEach(() => mockSession(testUserId));

  it('returns 400 when no file is provided', async () => {
    const formData = new FormData();
    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('No file');
  });

  it('returns 400 for unsupported file type', async () => {
    const formData = new FormData();
    const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' });
    formData.append('file', file);
    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unsupported file type');
  });

  it('returns 400 for oversized file', async () => {
    const formData = new FormData();
    // Create a file that exceeds 10MB
    const largeContent = new Uint8Array(11 * 1024 * 1024);
    const file = new File([largeContent], 'huge.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('too large');
  });

  it('returns 401 when not authenticated', async () => {
    mockNoSession();
    const formData = new FormData();
    const file = new File(['image data'], 'test.jpg', { type: 'image/jpeg' });
    formData.append('file', file);
    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('extracts tasks from a valid image', async () => {
    const formData = new FormData();
    const file = new File(['fake image data'], 'tasks.png', { type: 'image/png' });
    formData.append('file', file);
    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.uploadId).toBeDefined();
    expect(data.tasks).toBeDefined();
    expect(data.tasks.length).toBeGreaterThan(0);
  });
});
